// ============================================================
// NETWORK MODULE — WebRTC P2P via PeerJS + Encrypted Messaging
// ============================================================
//
// Guarantees this module provides to the game layer:
//   * Ordered delivery per connection. Outbound messages are encrypted and
//     sent through one serial queue; inbound messages are decrypted through a
//     per-connection serial queue. (AES-GCM via SubtleCrypto is async, so
//     without the queues two messages could be delivered out of order.)
//   * Liveness detection for every role (host AND clients): 5s ping, 12s
//     eviction, plus ICE-state monitoring for fast detection.
//   * Suspension awareness: if our own timers were frozen (mobile tab in
//     background, laptop lid closed) we do NOT evict everyone on wake — we
//     reset liveness and give peers a fresh window to answer.
//   * Signaling auto-reconnect with capped exponential backoff, forever.
//     (Existing data channels keep working while signaling is down.)
//   * Alias IDs: a second PeerJS registration (e.g. TC_ROOM_2) so the current
//     host stays reachable by room code after host migration.

const Network = (() => {
  let peer = null;
  let aliasPeer = null;            // secondary registration for room discovery
  let aliasId = null;
  let aliasRetryTimer = null;
  let connections = new Map();     // peerId -> DataConnection
  let roomKey = null;
  let myPeerId = null;
  let isHost = false;
  let destroyed = false;

  let onMessageCallback = null;
  let onPeerJoinCallback = null;
  let onPeerLeaveCallback = null;
  let onConnectedCallback = null;
  let onDisconnectedCallback = null;
  let onSignalingChangeCallback = null;

  let signalingRetry = 0;
  let signalingRetryTimer = null;

  let heartbeatInterval = null;
  let lastTick = 0;
  const HEARTBEAT_MS = 5000;
  const HEARTBEAT_TIMEOUT_MS = 12000;
  const lastSeen = new Map();      // peerId -> timestamp of last inbound data

  // Serial outbound queue (keeps encrypt+send strictly ordered)
  let outChain = Promise.resolve();

  // Pending outbound connects, so 'peer-unavailable' can fail them fast
  const pendingConnects = new Map(); // peerId -> reject fn

  // Test hook: simulate an OS-level suspension (no traffic in or out)
  let frozen = false;

  // Connect attempts before giving up on the initial broker registration.
  const MAX_CONNECT_ATTEMPTS = 3;

  function buildIceServers() {
    // STUN works for most home networks; TURN relays for symmetric NATs.
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
    return iceServers;
  }

  function buildPeerOpts() {
    const peerOpts = { config: { iceServers: buildIceServers() } };
    // URL param override (tests only) — production uses PeerJS cloud.
    try {
      const params = new URLSearchParams(window.location.search);
      const peerHost = params.get('peerHost');
      if (peerHost) {
        peerOpts.host = peerHost;
        peerOpts.port = Number(params.get('peerPort') || '9000');
        peerOpts.path = params.get('peerPath') || '/';
        peerOpts.secure = params.get('peerSecure') === '1';
      }
    } catch (_) { /* URL params optional */ }
    return peerOpts;
  }

  function setSignalingState(s) {
    if (onSignalingChangeCallback) {
      try { onSignalingChangeCallback(s); } catch (_) {}
    }
  }

  // Extract the peer id from PeerJS's "Could not connect to peer X" error
  function failPendingFromError(err) {
    const m = err && err.message && err.message.match(/peer\s+(\S+)/i);
    if (!m) return;
    const id = m[1];
    const rej = pendingConnects.get(id);
    if (rej) { pendingConnects.delete(id); rej(new Error('peer-unavailable')); }
  }

  function init(customId = null) {
    destroyed = false;
    return new Promise((resolve, reject) => {
      const id = customId || ('TC_' + GameCrypto.generatePlayerId().substring(0, 12));
      const peerOpts = buildPeerOpts();
      console.log(peerOpts.host
        ? `[Network] Using custom PeerJS broker: ${peerOpts.host} ${peerOpts.port} ${peerOpts.path}`
        : '[Network] Connecting via PeerJS cloud (0.peerjs.com)...');

      let attempt = 0;
      let settled = false;
      const tryConnect = () => {
        attempt++;
        if (attempt > 1) console.log(`[Network] Connect attempt ${attempt}/${MAX_CONNECT_ATTEMPTS}...`);
        const p = new Peer(id, peerOpts);
        peer = p;

        const openTimer = setTimeout(() => {
          if (settled || peer !== p) return;
          console.warn('[Network] Broker open timed out on attempt', attempt);
          try { p.destroy(); } catch (_) {}
          retryOrFail(new Error('Could not reach signaling server. Please retry.'));
        }, 12000);

        const retryOrFail = (err) => {
          if (settled) return;
          if (attempt < MAX_CONNECT_ATTEMPTS) {
            setTimeout(tryConnect, 1500 * attempt);
          } else {
            settled = true;
            reject(err);
          }
        };

        p.on('open', (peerId) => {
          clearTimeout(openTimer);
          myPeerId = peerId;
          signalingRetry = 0;
          setSignalingState('connected');
          console.log('[Network] My peer ID:', peerId);
          if (!settled) { settled = true; resolve(peerId); }
        });

        p.on('connection', (conn) => setupConnection(conn));

        p.on('error', (err) => {
          const type = err && err.type;
          if (type === 'peer-unavailable') { failPendingFromError(err); return; }
          console.error('[Network] Peer error:', type, err && err.message);
          if (!settled) {
            const transient = ['network', 'server-error', 'socket-error', 'socket-closed'].includes(type);
            clearTimeout(openTimer);
            try { p.destroy(); } catch (_) {}
            if (transient) retryOrFail(err);
            else { settled = true; reject(err); }
          }
          // After open, PeerJS surfaces signaling trouble via 'disconnected'.
        });

        p.on('disconnected', () => {
          if (destroyed || peer !== p) return;
          console.warn('[Network] Disconnected from signaling');
          scheduleSignalingReconnect(p);
        });

        p.on('close', () => {
          if (peer === p) console.warn('[Network] Peer destroyed');
        });
      };

      tryConnect();
    });
  }

  // Signaling loss does not break existing data channels — it only blocks
  // NEW connections (joins, rejoins, mesh repair). Keep trying forever with
  // capped backoff so a flaky broker never strands a player.
  function scheduleSignalingReconnect(p) {
    if (signalingRetryTimer || destroyed) return;
    signalingRetry++;
    const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(signalingRetry - 1, 5)));
    setSignalingState('reconnecting');
    if (signalingRetry === 4 && onDisconnectedCallback) {
      try { onDisconnectedCallback('signaling_lost'); } catch (_) {}
    }
    signalingRetryTimer = setTimeout(() => {
      signalingRetryTimer = null;
      if (destroyed || peer !== p) return;
      if (p.destroyed) return;
      if (!p.disconnected) { signalingRetry = 0; setSignalingState('connected'); return; }
      try { p.reconnect(); } catch (_) {}
      // If reconnect doesn't land, 'disconnected' fires again → next backoff.
      setTimeout(() => {
        if (!destroyed && peer === p && p.disconnected) scheduleSignalingReconnect(p);
      }, 8000);
    }, delay);
  }

  // A connection accepted on the alias registration belongs to our alias ID
  function myPeerIdFor(conn) {
    return conn._natticeViaAlias ? aliasId : myPeerId;
  }

  function setupConnection(conn) {
    // Idempotent: may be called from several paths for the same connection.
    if (conn._natticeSetup) return;
    conn._natticeSetup = true;
    conn._recvChain = Promise.resolve();

    const announceJoin = () => {
      if (conn._natticeJoined) return;
      conn._natticeJoined = true;
      // Duplicate connection to the same peer (both sides dialed at once, or
      // a re-dial while an old channel lingers). Both ends must pick the SAME
      // survivor or each closes a different one and the pair ends up with
      // nothing: keep the channel dialed by the lexicographically smaller
      // peer ID; if the old one is already dead, the new one wins.
      const prev = connections.get(conn.peer);
      if (prev && prev !== conn) {
        let keepNew = true;
        if (prev.open) {
          const me = myPeerIdFor(conn);
          const dialer = (c) => (c._natticeOutbound ? me : c.peer);
          const preferred = me < conn.peer ? me : conn.peer;
          keepNew = dialer(conn) === preferred || dialer(prev) !== preferred;
        }
        const loser = keepNew ? prev : conn;
        loser._natticeReplaced = true;
        try { loser.close(); } catch (_) {}
        if (!keepNew) return;
      }
      connections.set(conn.peer, conn);
      lastSeen.set(conn.peer, Date.now());
      console.log('[Network] Peer connected:', conn.peer);
      if (onPeerJoinCallback) onPeerJoinCallback(conn.peer);
    };

    conn.on('open', announceJoin);

    conn.on('data', (data) => {
      if (frozen) return;
      if (!conn._natticeJoined) announceJoin();
      lastSeen.set(conn.peer, Date.now());
      // Serialize decrypt+dispatch so messages arrive in send order
      conn._recvChain = conn._recvChain.then(async () => {
        try {
          const decrypted = roomKey ? await GameCrypto.decrypt(data, roomKey) : data;
          const msg = JSON.parse(decrypted);
          if (msg.type === '__PING__') { sendTo(conn.peer, { type: '__PONG__' }); return; }
          if (msg.type === '__PONG__') return;
          if (msg.type === '__BYE__') { try { conn.close(); } catch (_) {} announceClose(); return; }
          if (onMessageCallback) onMessageCallback(conn.peer, msg);
        } catch (e) {
          console.error('[Network] Decrypt/parse/handle failed:', e);
        }
      });
    });

    let closeAnnounced = false;
    const announceClose = () => {
      if (closeAnnounced) return;
      closeAnnounced = true;
      if (conn._natticeReplaced) return;            // superseded by a newer conn
      if (connections.get(conn.peer) !== conn) return;
      connections.delete(conn.peer);
      lastSeen.delete(conn.peer);
      console.log('[Network] Peer disconnected:', conn.peer);
      if (onPeerLeaveCallback) onPeerLeaveCallback(conn.peer);
    };
    conn._announceClose = announceClose;
    conn.on('close', announceClose);

    // ICE monitoring: 'failed'/'closed' are final; 'disconnected' often
    // recovers within a couple of seconds, so give it a grace window.
    const watchIce = () => {
      const pc = conn.peerConnection;
      if (!pc || pc._natticeWatched) return;
      pc._natticeWatched = true;
      pc.addEventListener('iceconnectionstatechange', () => {
        const st = pc.iceConnectionState;
        if (st === 'failed' || st === 'closed') {
          try { conn.close(); } catch (_) {}
          announceClose();
        } else if (st === 'disconnected') {
          setTimeout(() => {
            if (pc.iceConnectionState === 'disconnected') {
              try { conn.close(); } catch (_) {}
              announceClose();
            }
          }, 4000);
        }
      });
    };
    watchIce();
    conn.on('open', watchIce);

    conn.on('error', (err) => {
      console.error('[Network] Conn error:', conn.peer, err && err.type);
    });

    if (conn.open) announceJoin();
  }

  // Heartbeat runs for every role. Each side pings everyone it is connected
  // to; any inbound data counts as proof of life.
  function startHeartbeat() {
    stopHeartbeat();
    lastTick = Date.now();
    heartbeatInterval = setInterval(() => {
      if (frozen) return;
      const now = Date.now();
      const gap = now - lastTick;
      lastTick = now;
      // Our own timers were suspended (background tab / sleep). Evicting now
      // would wrongly blame every peer for OUR absence — reset instead.
      if (gap > HEARTBEAT_MS * 2) {
        console.warn(`[Network] Timer gap ${gap}ms — we were suspended; resetting liveness`);
        resetLiveness();
        return;
      }
      for (const [peerId, conn] of Array.from(connections.entries())) {
        if (conn.open) sendTo(peerId, { type: '__PING__' });
        const last = lastSeen.get(peerId) || 0;
        if (now - last > HEARTBEAT_TIMEOUT_MS) {
          console.warn('[Network] Heartbeat timeout for', peerId);
          try { conn.close(); } catch (_) {}
          if (conn._announceClose) conn._announceClose();
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

  // Give every peer a fresh liveness window (used after we resume)
  function resetLiveness() {
    const now = Date.now();
    for (const id of connections.keys()) lastSeen.set(id, now);
    lastTick = now;
  }

  async function setRoom(roomCode) {
    const salt = 'TrumpCall_' + roomCode;
    roomKey = await GameCrypto.deriveRoomKey(roomCode, salt);
  }

  async function createRoom(roomCode) {
    isHost = true;
    await setRoom(roomCode);
    return { roomCode, peerId: myPeerId };
  }

  // Connect to the host and resolve once the data channel is open.
  async function joinRoom(hostPeerId, roomCode) {
    isHost = false;
    await setRoom(roomCode);
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`[Network] Attempting to connect to host (attempt ${attempt}/3)...`);
      try {
        await connectToPeer(hostPeerId, 12000);
        console.log('[Network] Successfully connected to host');
        if (onConnectedCallback) onConnectedCallback();
        return { roomCode, hostPeerId };
      } catch (e) {
        lastErr = e;
        if (e && e.message === 'peer-unavailable' && attempt >= 2) break;
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
    throw new Error(lastErr && lastErr.message === 'peer-unavailable'
      ? 'Room not found. Check the code and try again.'
      : 'Could not connect to the room. Please retry.');
  }

  function connectToPeer(peerId, timeoutMs = 10000) {
    if (!peer || peerId === myPeerId || peerId === aliasId) return Promise.resolve(null);
    const existing = connections.get(peerId);
    if (existing && existing.open) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      let conn;
      try {
        conn = peer.connect(peerId, { reliable: true, serialization: 'json' });
      } catch (e) { reject(e); return; }
      if (!conn) { reject(new Error('connect failed')); return; }
      conn._natticeOutbound = true;
      setupConnection(conn);
      let done = false;
      const finish = (fn, v) => { if (done) return; done = true; pendingConnects.delete(peerId); clearTimeout(t); fn(v); };
      pendingConnects.set(peerId, (err) => { try { conn.close(); } catch (_) {} finish(reject, err); });
      conn.on('open', () => finish(resolve, conn));
      conn.on('error', (err) => finish(reject, err || new Error('connection error')));
      // Lost a duplicate-resolution race: the surviving channel is just as good
      conn.on('close', () => {
        const live = connections.get(peerId);
        if (live && live.open) finish(resolve, live);
        else finish(reject, new Error('connection closed'));
      });
      const t = setTimeout(() => { try { conn.close(); } catch (_) {} finish(reject, new Error('Connection timeout')); }, timeoutMs);
    });
  }

  // Register an extra, well-known ID (e.g. TC_ROOM_2) that accepts inbound
  // connections on behalf of this peer. Used so joiners and rejoiners can
  // find whoever is host now, by room code alone. Retries while the ID is
  // still held by a stale registration on the broker.
  function claimAlias(id, opts = {}) {
    releaseAlias();
    let reportedTaken = false;
    aliasId = id;
    const peerOpts = buildPeerOpts();
    let tries = 0;
    const attempt = () => {
      if (destroyed || aliasId !== id) return;
      tries++;
      const ap = new Peer(id, peerOpts);
      aliasPeer = ap;
      ap.on('open', () => console.log('[Network] Alias registered:', id));
      ap.on('connection', (conn) => { conn._natticeViaAlias = true; setupConnection(conn); });
      ap.on('error', (err) => {
        if (err && err.type === 'unavailable-id' && tries < 20 && aliasId === id) {
          try { ap.destroy(); } catch (_) {}
          // Someone holds this ID: a stale registration (clears on its own)
          // or a competing host at the same term (caller resolves that).
          if (!reportedTaken && typeof opts.onTaken === 'function') {
            reportedTaken = true;
            try { opts.onTaken(id); } catch (_) {}
          }
          aliasRetryTimer = setTimeout(attempt, 3000);
        } else if (err && err.type !== 'peer-unavailable') {
          console.warn('[Network] Alias error:', err.type);
        }
      });
      ap.on('disconnected', () => {
        if (!destroyed && aliasPeer === ap && !ap.destroyed) {
          setTimeout(() => { try { if (aliasPeer === ap && ap.disconnected) ap.reconnect(); } catch (_) {} }, 3000);
        }
      });
    };
    attempt();
  }

  function releaseAlias() {
    if (aliasRetryTimer) { clearTimeout(aliasRetryTimer); aliasRetryTimer = null; }
    if (aliasPeer) { try { aliasPeer.destroy(); } catch (_) {} }
    aliasPeer = null;
    aliasId = null;
  }

  function enqueueSend(conns, message) {
    const json = JSON.stringify(message);
    outChain = outChain.then(async () => {
      if (frozen) return;
      try {
        const payload = roomKey ? await GameCrypto.encrypt(json, roomKey) : json;
        for (const conn of conns) {
          if (conn && conn.open) {
            try { conn.send(payload); }
            catch (e) { console.error('[Network] send to', conn.peer, 'failed:', e); }
          }
        }
      } catch (e) {
        console.error('[Network] encrypt failed:', e);
      }
    });
    return outChain;
  }

  function sendTo(peerId, message) {
    const conn = connections.get(peerId);
    if (!conn || !conn.open) {
      if (message && message.type !== '__PING__' && message.type !== '__PONG__') {
        console.warn('[Network] No open connection to', peerId, 'for', message.type);
      }
      return Promise.resolve(false);
    }
    return enqueueSend([conn], message).then(() => true);
  }

  function broadcast(message) {
    return enqueueSend(Array.from(connections.values()), message);
  }

  // Fire-and-forget goodbye for unload handlers (cannot await there).
  function sendByeBestEffort() {
    const bye = JSON.stringify({ type: '__BYE__' });
    for (const conn of connections.values()) {
      if (!conn.open) continue;
      try {
        const p = roomKey ? GameCrypto.encrypt(bye, roomKey) : Promise.resolve(bye);
        p.then(cipher => { try { conn.send(cipher); } catch (_) {} });
      } catch (_) { /* best-effort */ }
    }
  }

  function onMessage(cb) { onMessageCallback = cb; }
  function onPeerJoin(cb) { onPeerJoinCallback = cb; }
  function onPeerLeave(cb) { onPeerLeaveCallback = cb; }
  function onConnected(cb) { onConnectedCallback = cb; }
  function onDisconnected(cb) { onDisconnectedCallback = cb; }
  function onSignalingChange(cb) { onSignalingChangeCallback = cb; }

  function getPeerId() { return myPeerId; }
  function getAliasId() { return aliasId; }
  function getIsHost() { return isHost; }
  function getConnectedPeers() { return Array.from(connections.keys()).filter(id => connections.get(id).open); }
  function getPeerCount() { return getConnectedPeers().length; }
  function isConnectedTo(peerId) { const c = connections.get(peerId); return !!(c && c.open); }
  function hasRoomKey() { return !!roomKey; }
  function isReady() { return !!(peer && !peer.destroyed && myPeerId); }

  // Role changes (used by host migration / split-brain resolution)
  function promoteToHost() { isHost = true; startHeartbeat(); }
  function demoteToClient() { isHost = false; releaseAlias(); }

  // Close one connection deliberately (e.g. a stale host we stepped away from)
  function dropPeer(peerId) {
    const conn = connections.get(peerId);
    if (!conn) return;
    try { conn.close(); } catch (_) {}
    if (conn._announceClose) conn._announceClose();
  }

  function destroy() {
    destroyed = true;
    stopHeartbeat();
    if (signalingRetryTimer) { clearTimeout(signalingRetryTimer); signalingRetryTimer = null; }
    releaseAlias();
    const conns = Array.from(connections.values());
    connections.clear();
    lastSeen.clear();
    pendingConnects.clear();
    for (const conn of conns) { try { conn.close(); } catch (_) {} }
    if (peer) { try { peer.destroy(); } catch (_) {} }
    peer = null;
    myPeerId = null;
    isHost = false;
    roomKey = null;
    signalingRetry = 0;
    frozen = false;
    outChain = Promise.resolve();
  }

  // --- Test hook: simulate an OS suspension for `ms` milliseconds ---
  // Drops all inbound/outbound traffic and stops our heartbeat work, the same
  // way iOS/Android freeze a backgrounded tab.
  function __testFreeze(ms) {
    frozen = true;
    setTimeout(() => { frozen = false; }, ms);
  }

  return {
    init, createRoom, joinRoom, setRoom,
    connectToPeer, claimAlias, releaseAlias,
    broadcast, sendTo, sendByeBestEffort,
    onMessage, onPeerJoin, onPeerLeave, onConnected, onDisconnected, onSignalingChange,
    startHeartbeat, stopHeartbeat, resetLiveness,
    getPeerId, getAliasId, getIsHost, getConnectedPeers, getPeerCount, isConnectedTo, hasRoomKey, isReady,
    promoteToHost, demoteToClient, dropPeer,
    destroy,
    __testFreeze,
  };
})();
