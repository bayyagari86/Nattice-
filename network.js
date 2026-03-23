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
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 5;

  function init() {
    return new Promise((resolve, reject) => {
      const id = 'TC_' + GameCrypto.generatePlayerId().substring(0, 12);
      peer = new Peer(id, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
          ]
        }
      });

      peer.on('open', (id) => {
        myPeerId = id;
        console.log('[Network] My peer ID:', id);
        resolve(id);
      });

      peer.on('connection', (conn) => {
        setupConnection(conn);
      });

      peer.on('error', (err) => {
        console.error('[Network] Peer error:', err);
        if (err.type === 'disconnected' && reconnectAttempts < MAX_RECONNECT) {
          reconnectAttempts++;
          setTimeout(() => peer.reconnect(), 2000 * reconnectAttempts);
        }
      });

      peer.on('disconnected', () => {
        console.warn('[Network] Disconnected from signaling');
        if (reconnectAttempts < MAX_RECONNECT) {
          reconnectAttempts++;
          setTimeout(() => peer.reconnect(), 2000);
        }
      });
    });
  }

  function setupConnection(conn) {
    conn.on('open', () => {
      connections.set(conn.peer, conn);
      console.log('[Network] Peer connected:', conn.peer);
      if (onPeerJoinCallback) onPeerJoinCallback(conn.peer);
    });

    conn.on('data', async (data) => {
      try {
        // Promote this connection — it delivered data successfully
        connections.set(conn.peer, conn);
        const decrypted = roomKey ? await GameCrypto.decrypt(data, roomKey) : data;
        const msg = JSON.parse(decrypted);
        if (onMessageCallback) onMessageCallback(conn.peer, msg);
      } catch (e) {
        console.error('[Network] Decrypt/parse failed:', e);
      }
    });

    conn.on('close', () => {
      connections.delete(conn.peer);
      console.log('[Network] Peer disconnected:', conn.peer);
      if (onPeerLeaveCallback) onPeerLeaveCallback(conn.peer);
    });

    conn.on('error', (err) => {
      console.error('[Network] Conn error:', conn.peer, err);
    });

    // If already open (e.g. called after open event), store immediately
    if (conn.open) {
      connections.set(conn.peer, conn);
      console.log('[Network] Peer connected (immediate):', conn.peer);
      if (onPeerJoinCallback) onPeerJoinCallback(conn.peer);
    }
  }

  async function createRoom(roomCode) {
    isHost = true;
    const salt = 'TrumpCall_' + roomCode;
    roomKey = await GameCrypto.deriveRoomKey(roomCode, salt);
    return { roomCode, peerId: myPeerId };
  }

  async function joinRoom(hostPeerId, roomCode) {
    isHost = false;
    const salt = 'TrumpCall_' + roomCode;
    roomKey = await GameCrypto.deriveRoomKey(roomCode, salt);

    return new Promise((resolve, reject) => {
      const conn = peer.connect(hostPeerId, { reliable: true });
      conn.on('open', () => {
        connections.set(hostPeerId, conn);
        setupConnection(conn);
        if (onConnectedCallback) onConnectedCallback(hostPeerId);
        resolve(conn);
      });
      conn.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 15000);
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

  function getPeerId() { return myPeerId; }
  function getIsHost() { return isHost; }
  function getConnectedPeers() { return Array.from(connections.keys()); }
  function getPeerCount() { return connections.size; }

  function destroy() {
    for (const conn of connections.values()) conn.close();
    connections.clear();
    if (peer) peer.destroy();
  }

  return {
    init, createRoom, joinRoom, connectToPeer,
    sendTo, broadcast,
    onMessage, onPeerJoin, onPeerLeave, onConnected,
    getPeerId, getIsHost, getConnectedPeers, getPeerCount,
    destroy,
  };
})();
