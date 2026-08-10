// ============================================================
// NETWORK MODULE — WebRTC P2P via PeerJS + Encrypted Messaging
// ============================================================

const Network = (() => {
  let peer = null;
  let connections = new Map(); // peerId -> DataConnection
  let roomKey = null;
  let myPeerId = null;
  let isHost = false;
  let onMessageCallback = null;
  let onPeerJoinCallback = null;
  let onPeerLeaveCallback = null;
  let onConnectedCallback = null;
  let onDisconnectedCallback = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 5;
  let heartbeatInterval = null;
  const HEARTBEAT_MS = 5000;
  const HEARTBEAT_TIMEOUT_MS = 12000;
  const lastPong = new Map(); // peerId -> timestamp

  // Connect attempts before giving up. PeerJS cloud (0.peerjs.com) is shared
  // infrastructure and occasionally has brief hiccups; retrying with backoff
  // hides those from the player.
  const MAX_CONNECT_ATTEMPTS = 3;

  function init(customId = null) {
    return new Promise((resolve, reject) => {
      const id = customId || ('TC_' + GameCrypto.generatePlayerId().substring(0, 12));

      // Build ICE servers list.
      // STUN is always included — works for ~80% of home networks.
      // TURN (relay) is added when configured via:
      //   1. window.NATTICE_CONFIG.turnServers = [{urls, username, credential}, ...]
      //   2. URL params: ?turnUrl=turn:host:port&turnUser=U&turnCred=C
      // Without TURN, users on symmetric NATs (some corporate/mobile/hotel
      // networks) may not be able to connect. Recommended free tiers:
      // Metered.ca, Twilio, or self-host coturn on a $5 VPS.
      const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ];
      try {
        if (typeof window !== 'undefined' && window.NATTICE_CONFIG && Array.isArray(window.NATTICE_CONFIG.turnServers)) {
          for (const s of window.NATTICE_CONFIG.turnServers) iceServers.push(s);
        }
        const params = new URLSearchParams(window.location.search);
        const turnUrl = params.get('turnUrl');
        if (turnUrl) {
          iceServers.push({
            urls: turnUrl,
            username: params.get('turnUser') || undefined,
            credential: params.get('turnCred') || undefined,
          });
        }
      } catch (_) { /* ICE config optional */ }

      // Development / test hook: allow overriding the PeerJS broker via URL
      // params so a local `peerjs-server` can be used in automated tests.
      // Production builds default to PeerJS cloud unless
      // window.NATTICE_CONFIG.peerHost is set.
      const peerOpts = { config: { iceServers } };
      // URL param override (tests only) — production uses PeerJS cloud.
      try {
        const params = new URLSearchParams(window.location.search);
        const peerHost = params.get('peerHost');
        if (peerHost) {
          peerOpts.host = peerHost;
          peerOpts.port = Number(params.get('peerPort') || '9000');
          peerOpts.path = params.get('peerPath') || '/';
          peerOpts.secure = params.get('peerSecure') === '1';
          console.log('[Network] Using custom PeerJS broker:', peerOpts.host, peerOpts.port, peerOpts.path);
        } else {
          console.log('[Network] Connecting via PeerJS cloud (0.peerjs.com)...');
        }
      } catch (_) { /* URL params optional */ }

      // Retryable connect — PeerJS cloud occasionally errors on first dial.
      // We destroy and re-create the Peer object on each attempt because a
      // failed Peer can't be re-used (its internal socket is dead).
      let attempt = 0;
      const tryConnect = () => {
        attempt++;
        const isRetry = attempt > 1;
        if (isRetry) console.log(`[Network] Connect attempt ${attempt}/${MAX_CONNECT_ATTEMPTS}...`);
        peer = new Peer(id, peerOpts);

        // If we don't open in 12s, retry. PeerJS's own timeout is ~5s but it
        // sometimes silently hangs; belt-and-suspenders here.
        const openTimer = setTimeout(() => {
          console.warn('[Network] Broker open timed out on attempt', attempt);
          try { peer.destroy(); } catch (_) {}
          if (attempt < MAX_CONNECT_ATTEMPTS) {
            setTimeout(tryConnect, 1500 * attempt); // 1.5s, 3s
          } else {
            reject(new Error('Could not reach signaling server after ' + MAX_CONNECT_ATTEMPTS + ' attempts. Please retry.'));
          }
        }, 12000);

        peer.on('open', (peerId) => {
          clearTimeout(openTimer);
          myPeerId = peerId;
          console.log('[Network] My peer ID:', peerId);
          resolve(peerId);
        });

        peer.on('connection', (conn) => {
          setupConnection(conn);
        });

        peer.on('error', (err) => {
          console.error('[Network] Peer error:', err && err.type, err && err.message);
          // If we haven't opened yet, treat transient network errors as retryable.
          const isTransient = err && (err.type === 'network' || err.type === 'server-error' ||
            err.type === 'socket-error' || err.type === 'socket-closed');
          if (!myPeerId && isTransient && attempt < MAX_CONNECT_ATTEMPTS) {
            clearTimeout(openTimer);
            try { peer.destroy(); } catch (_) {}
            setTimeout(tryConnect, 1500 * attempt);
            return;
          }
          // After we've opened successfully, PeerJS auto-handles most transient
          // errors; only signaling-disconnected needs a manual reconnect().
          if (err.type === 'disconnected' && reconnectAttempts < MAX_RECONNECT) {
            reconnectAttempts++;
            setTimeout(() => { try { peer.reconnect(); } catch (_) {} }, 2000 * reconnectAttempts);
          } else if (!myPeerId) {
            reject(err);
          }
          // If we're already open, surface non-fatal errors to the UI but don't reject.
          if (myPeerId && onDisconnectedCallback && err.type === 'peer-unavailable') {
            // Not fatal — just a stale peer ID in a connect attempt. Ignore.
          }
        });

        peer.on('disconnected', () => {
          console.warn('[Network] Disconnected from signaling');
          if (reconnectAttempts < MAX_RECONNECT) {
            reconnectAttempts++;
            setTimeout(() => { try { peer.reconnect(); } catch (_) {} }, 2000);
          } else if (onDisconnectedCallback) {
            onDisconnectedCallback('signaling_lost');
          }
        });

        peer.on('close', () => {
          console.warn('[Network] Peer destroyed');
          stopHeartbeat();
        });
      };

      tryConnect();
    });
  }

  function setupConnection(conn) {
    // Idempotency guard: setupConnection can be called from multiple paths
    // (peer.on('connection'), joinRoom, connectToPeer, promoteSelfToHost's
    // rebuild) and we do NOT want to double-register listeners or double-fire
    // onPeerJoinCallback for the same connection.
    if (conn._natticeSetup) return;
    conn._natticeSetup = true;

    const announceJoin = () => {
      // Guard against multiple announcements (open event AND immediate branch)
      if (conn._natticeJoined) return;
      conn._natticeJoined = true;
      connections.set(conn.peer, conn);
      lastPong.set(conn.peer, Date.now());
      console.log('[Network] Peer connected:', conn.peer);
      if (onPeerJoinCallback) onPeerJoinCallback(conn.peer);
    };

    conn.on('open', announceJoin);

    conn.on('data', async (data) => {
      try {
        // Ensure we've registered the connection even if 'open' didn't fire
        // (PeerJS occasionally delivers data before the open event on
        // symmetric-NAT paths).
        if (!conn._natticeJoined) announceJoin();
        lastPong.set(conn.peer, Date.now());
        const decrypted = roomKey ? await GameCrypto.decrypt(data, roomKey) : data;
        const msg = JSON.parse(decrypted);
        // Handle heartbeat internally
        if (msg.type === '__PING__') {
          sendTo(conn.peer, { type: '__PONG__' });
          return;
        }
        if (msg.type === '__PONG__') return;
        // Graceful leave announcement from peer — treat identically to close
        if (msg.type === '__BYE__') {
          try { conn.close(); } catch (_) {}
          return; // 'close' handler will fire onPeerLeaveCallback
        }
        if (onMessageCallback) onMessageCallback(conn.peer, msg);
      } catch (e) {
        console.error('[Network] Decrypt/parse failed:', e);
      }
    });

    let closeAnnounced = false;
    const announceClose = () => {
      if (closeAnnounced) return;
      closeAnnounced = true;
      connections.delete(conn.peer);
      lastPong.delete(conn.peer);
      console.log('[Network] Peer disconnected:', conn.peer);
      if (onPeerLeaveCallback) onPeerLeaveCallback(conn.peer);
    };
    conn.on('close', announceClose);
    // PeerJS 1.x fires 'iceStateChanged' with 'disconnected' or 'failed'
    // BEFORE 'close' — treat those as a leave too, so we don't wait for
    // the WebRTC teardown grace period.
    if (conn.peerConnection) {
      conn.peerConnection.addEventListener('iceconnectionstatechange', () => {
        const st = conn.peerConnection.iceConnectionState;
        if (st === 'failed' || st === 'closed' || st === 'disconnected') {
          // Give WebRTC one chance to recover from 'disconnected'
          if (st === 'disconnected') {
            setTimeout(() => {
              if (conn.peerConnection && conn.peerConnection.iceConnectionState === 'disconnected') {
                try { conn.close(); } catch (_) {}
                announceClose();
              }
            }, 3000);
          } else {
            try { conn.close(); } catch (_) {}
            announceClose();
          }
        }
      });
    }

    conn.on('error', (err) => {
      console.error('[Network] Conn error:', conn.peer, err);
    });

    // If already open (e.g. called after open event fired), announce now.
    // announceJoin() is idempotent so the 'open' listener above is a no-op.
    if (conn.open) announceJoin();
  }

  // Heartbeat: host pings all clients, detects dead connections
  function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [peerId, conn] of connections) {
        if (conn.open) {
          sendTo(peerId, { type: '__PING__' });
        }
        // Check if peer has gone silent
        const last = lastPong.get(peerId) || 0;
        if (now - last > HEARTBEAT_TIMEOUT_MS) {
          console.warn('[Network] Heartbeat timeout for', peerId);
          conn.close();
          connections.delete(peerId);
          lastPong.delete(peerId);
          if (onPeerLeaveCallback) onPeerLeaveCallback(peerId);
        }
      }
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  async function createRoom(roomCode) {
    isHost = true;
    const salt = 'TrumpCall_' + roomCode;
    roomKey = await GameCrypto.deriveRoomKey(roomCode, salt);
    return { roomCode, peerId: myPeerId };
  }

  async function joinRoom(hostPeerId, roomCode, retryCount = 0) {
    isHost = false;
    const salt = 'TrumpCall_' + roomCode;
    roomKey = await GameCrypto.deriveRoomKey(roomCode, salt);
    
    return new Promise((resolve, reject) => {
      console.log(`[Network] Attempting to connect to host (attempt ${retryCount + 1}/3)...`);
      
      const conn = peer.connect(hostPeerId, { 
        reliable: true,
        serialization: 'json'
      });
      
      setupConnection(conn);
      
      let resolved = false;
      
      conn.on('open', () => {
        if (resolved) return;
        resolved = true;
        console.log('[Network] Successfully connected to host');
        if (onConnectedCallback) onConnectedCallback();
        resolve({ roomCode, hostPeerId });
      });
      
      conn.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        console.error('[Network] Connection error:', err);
        
        // Retry on failure (up to 3 attempts)
        if (retryCount < 2) {
          setTimeout(() => {
            joinRoom(hostPeerId, roomCode, retryCount + 1)
              .then(resolve)
              .catch(reject);
          }, 2000 * (retryCount + 1));
        } else {
          reject(new Error('Failed to connect after 3 attempts. Check Host ID and try again.'));
        }
      });
      
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        console.warn('[Network] Connection timeout');
        
        // Retry on timeout
        if (retryCount < 2) {
          joinRoom(hostPeerId, roomCode, retryCount + 1)
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error('Connection timeout. Host may be offline.'));
        }
      }, 15000);
    });
  }

  async function discoverHost(roomCode) {
    const salt = 'TrumpCall_' + roomCode;
    roomKey = await GameCrypto.deriveRoomKey(roomCode, salt);
    
    return new Promise((resolve, reject) => {
      // Listen for host response
      const originalCallback = onMessageCallback;
      const timeout = setTimeout(() => {
        onMessageCallback = originalCallback;
        reject(new Error('Host discovery timeout - room may not exist'));
      }, 10000);

      onMessageCallback = (fromPeer, msg) => {
        if (msg.type === 'HOST_ANNOUNCE' && msg.roomCode === roomCode) {
          clearTimeout(timeout);
          onMessageCallback = originalCallback;
          resolve(msg.hostPeerId);
        } else if (originalCallback) {
          originalCallback(fromPeer, msg);
        }
      };

      // Broadcast discovery request - try connecting to potential host IDs
      // This is a simplified approach - in production you'd use a signaling server
      reject(new Error('Room discovery not yet implemented - please use host ID'));
    });
  }

  async function connectToPeer(peerId) {
    if (connections.has(peerId) || peerId === myPeerId) return;
    return new Promise((resolve, reject) => {
      const conn = peer.connect(peerId, { reliable: true, serialization: 'json' });
      // Register listeners FIRST (setupConnection is idempotent and safe to
      // call before 'open' — it uses conn.on('open') itself).
      setupConnection(conn);
      let done = false;
      const onOpen = () => { if (done) return; done = true; resolve(conn); };
      conn.on('open', onOpen);
      conn.on('error', (err) => { if (done) return; done = true; reject(err); });
      setTimeout(() => { if (done) return; done = true; reject(new Error('Connection timeout')); }, 10000);
    });
  }

  async function sendTo(peerId, message) {
    const conn = connections.get(peerId);
    if (!conn || !conn.open) {
      // Suppress warning for internal heartbeat noise
      if (message && message.type !== '__PING__' && message.type !== '__PONG__') {
        console.warn('[Network] No open connection to', peerId);
      }
      return;
    }
    try {
      const json = JSON.stringify(message);
      const encrypted = roomKey ? await GameCrypto.encrypt(json, roomKey) : json;
      conn.send(encrypted);
    } catch (e) {
      console.error('[Network] sendTo failed:', peerId, e);
    }
  }

  async function broadcast(message) {
    try {
      const json = JSON.stringify(message);
      const encrypted = roomKey ? await GameCrypto.encrypt(json, roomKey) : json;
      // Snapshot connections to avoid mutation-during-iteration if a send
      // handler triggers a close.
      const conns = Array.from(connections.entries());
      for (const [peerId, conn] of conns) {
        if (conn.open) {
          try { conn.send(encrypted); }
          catch (e) { console.error('[Network] broadcast to', peerId, 'failed:', e); }
        }
      }
    } catch (e) {
      console.error('[Network] broadcast encrypt failed:', e);
    }
  }

  // Send a synchronous best-effort "goodbye" to every connected peer.
  // Used from beforeunload/pagehide handlers where async work may not
  // complete. Falls through the normal encrypted path if possible, but
  // does not await — browsers cut off the tab within milliseconds.
  function sendByeBestEffort() {
    for (const [peerId, conn] of connections) {
      if (!conn.open) continue;
      try {
        // Fire-and-forget: encrypt returns a promise, but we can't await.
        // If encrypt is not ready yet, the peer will still get 'close' from
        // the underlying WebRTC teardown — this is purely an optimization
        // so peers don't have to wait for heartbeat timeout.
        const p = roomKey
          ? GameCrypto.encrypt(JSON.stringify({ type: '__BYE__' }), roomKey)
          : Promise.resolve(JSON.stringify({ type: '__BYE__' }));
        p.then(cipher => { try { conn.send(cipher); } catch (_) {} });
      } catch (_) { /* best-effort */ }
    }
  }

  function onMessage(cb) { onMessageCallback = cb; }
  function onPeerJoin(cb) { onPeerJoinCallback = cb; }
  function onPeerLeave(cb) { onPeerLeaveCallback = cb; }
  function onConnected(cb) { onConnectedCallback = cb; }
  function onDisconnected(cb) { onDisconnectedCallback = cb; }

  function getPeerId() { return myPeerId; }
  function getIsHost() { return isHost; }
  function getConnectedPeers() { return Array.from(connections.keys()); }
  function getPeerCount() { return connections.size; }

  // Promote this peer to host role (used by host-migration).
  // Does NOT re-open a signaling channel or change peerId — clients learn
  // the new host's peerId out-of-band via a HOST_MIGRATED message and route
  // through the existing mesh connections.
  function promoteToHost() {
    isHost = true;
    startHeartbeat();
  }

  function destroy() {
    stopHeartbeat();
    for (const conn of connections.values()) conn.close();
    connections.clear();
    lastPong.clear();
    if (peer) peer.destroy();
  }

  return {
    init, createRoom, joinRoom, discoverHost,
    connectToPeer,
    broadcast, sendTo, sendByeBestEffort,
    onMessage, onPeerJoin, onPeerLeave, onConnected, onDisconnected,
    startHeartbeat, stopHeartbeat,
    getPeerId, getIsHost, getConnectedPeers, getPeerCount,
    promoteToHost,
    destroy,
  };
})();
