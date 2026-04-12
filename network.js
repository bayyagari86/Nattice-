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

  function init(customId = null) {
    return new Promise((resolve, reject) => {
      const id = customId || ('TC_' + GameCrypto.generatePlayerId().substring(0, 12));
      console.log('[Network] Connecting via PeerJS cloud...');

      peer = new Peer(id, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
          ]
        }
      });

      peer.on('open', (peerId) => {
        myPeerId = peerId;
        console.log('[Network] My peer ID:', peerId);
        resolve(peerId);
      });

      peer.on('connection', (conn) => {
        setupConnection(conn);
      });

      peer.on('error', (err) => {
        console.error('[Network] Peer error:', err);
        if (err.type === 'disconnected' && reconnectAttempts < MAX_RECONNECT) {
          reconnectAttempts++;
          setTimeout(() => peer.reconnect(), 2000 * reconnectAttempts);
        } else {
          reject(err);
        }
      });

      peer.on('disconnected', () => {
        console.warn('[Network] Disconnected from signaling');
        if (reconnectAttempts < MAX_RECONNECT) {
          reconnectAttempts++;
          setTimeout(() => peer.reconnect(), 2000);
        } else if (onDisconnectedCallback) {
          onDisconnectedCallback('signaling_lost');
        }
      });

      peer.on('close', () => {
        console.warn('[Network] Peer destroyed');
        stopHeartbeat();
      });
    });
  }

  function setupConnection(conn) {
    conn.on('open', () => {
      connections.set(conn.peer, conn);
      lastPong.set(conn.peer, Date.now());
      console.log('[Network] Peer connected:', conn.peer);
      if (onPeerJoinCallback) onPeerJoinCallback(conn.peer);
    });

    conn.on('data', async (data) => {
      try {
        // Promote this connection — it delivered data successfully
        connections.set(conn.peer, conn);
        lastPong.set(conn.peer, Date.now());
        const decrypted = roomKey ? await GameCrypto.decrypt(data, roomKey) : data;
        const msg = JSON.parse(decrypted);
        // Handle heartbeat internally
        if (msg.type === '__PING__') {
          sendTo(conn.peer, { type: '__PONG__' });
          return;
        }
        if (msg.type === '__PONG__') return;
        if (onMessageCallback) onMessageCallback(conn.peer, msg);
      } catch (e) {
        console.error('[Network] Decrypt/parse failed:', e);
      }
    });

    conn.on('close', () => {
      connections.delete(conn.peer);
      lastPong.delete(conn.peer);
      console.log('[Network] Peer disconnected:', conn.peer);
      if (onPeerLeaveCallback) onPeerLeaveCallback(conn.peer);
    });

    conn.on('error', (err) => {
      console.error('[Network] Conn error:', conn.peer, err);
    });

    // If already open (e.g. called after open event), store immediately
    if (conn.open) {
      connections.set(conn.peer, conn);
      lastPong.set(conn.peer, Date.now());
      console.log('[Network] Peer connected (immediate):', conn.peer);
      if (onPeerJoinCallback) onPeerJoinCallback(conn.peer);
    }
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
      const conn = peer.connect(peerId, { reliable: true });
      conn.on('open', () => {
        connections.set(peerId, conn);
        setupConnection(conn);
        resolve(conn);
      });
      conn.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });
  }

  async function sendTo(peerId, message) {
    const conn = connections.get(peerId);
    if (!conn || !conn.open) {
      console.warn('[Network] No open connection to', peerId);
      return;
    }
    const json = JSON.stringify(message);
    const encrypted = roomKey ? await GameCrypto.encrypt(json, roomKey) : json;
    conn.send(encrypted);
  }

  async function broadcast(message) {
    const json = JSON.stringify(message);
    const encrypted = roomKey ? await GameCrypto.encrypt(json, roomKey) : json;
    for (const [peerId, conn] of connections) {
      if (conn.open) {
        conn.send(encrypted);
      }
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
    broadcast, sendTo,
    onMessage, onPeerJoin, onPeerLeave, onConnected, onDisconnected,
    startHeartbeat, stopHeartbeat,
    getPeerId, getIsHost, getConnectedPeers, getPeerCount,
    destroy,
  };
})();
