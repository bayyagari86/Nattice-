// ============================================================
// GAME CONTROLLER — Orchestrates Engine, Network, and UI
// ============================================================

const Game = (() => {
  let state = null;
  let myPlayerId = null;
  let myPeerId = null;
  let mySeat = -1;
  let myName = '';
  let roomCode = '';
  let peerToSeat = new Map(); // peerId -> seat index
  let seatToPeer = new Map(); // seat -> peerId
  let isSoloMode = false;

  const AI_NAMES = ['Arjun', 'Priya', 'Kiran', 'Meera', 'Ravi'];

  // --- AI Memory: learns from human plays each round ---
  // Tracks per-seat: suit void tendencies, trump usage pattern, joker sightings
  let aiMemory = {
    suitVoids: {},        // seat -> Set of suits they've shown void in
    trumpUsed: {},        // seat -> count of trump cards played
    jokerSeen: {},        // 'BIG_JOKER'/'SMALL_JOKER' -> seat that played it (or null)
    highCardPlayed: {},   // seat -> { suit -> highest rank seen }
    humanLeadPatterns: [],// last 5 lead suits from human (seat 0) — detect tendencies
    opponentTrumpA: {},   // suit -> whether trump Ace has been played
  };

  function resetAiMemory() {
    aiMemory = {
      suitVoids: {}, trumpUsed: {}, jokerSeen: {},
      highCardPlayed: {}, humanLeadPatterns: [], opponentTrumpA: {},
    };
  }

  function updateAiMemoryFromTrick(trick, trump) {
    for (const cp of trick) {
      const { playerIndex: seat, card } = cp;
      const leadSuit = trick[0].card.suit === 'joker' ? null : trick[0].card.suit;

      // Track joker plays
      if (card.id === 'BIG_JOKER' || card.id === 'SMALL_JOKER') {
        aiMemory.jokerSeen[card.id] = seat;
      }

      // Track trump Ace played
      if (card.suit === trump && card.rank === 'A') {
        aiMemory.opponentTrumpA[trump] = true;
      }

      // Track suit voids: player didn't follow suit = void in lead suit
      if (!aiMemory.suitVoids[seat]) aiMemory.suitVoids[seat] = new Set();
      if (leadSuit && card.suit !== leadSuit && card.suit !== 'joker') {
        aiMemory.suitVoids[seat].add(leadSuit);
      }

      // Track trump usage count
      if (card.suit === trump) {
        aiMemory.trumpUsed[seat] = (aiMemory.trumpUsed[seat] || 0) + 1;
      }

      // Track high cards seen per seat/suit
      if (!aiMemory.highCardPlayed[seat]) aiMemory.highCardPlayed[seat] = {};
      if (card.suit && card.suit !== 'joker') {
        const prev = aiMemory.highCardPlayed[seat][card.suit] || 0;
        aiMemory.highCardPlayed[seat][card.suit] = Math.max(prev, Engine.RANK_VALUES[card.rank] || 0);
      }

      // Track human (seat 0) lead patterns
      if (seat === 0 && cp === trick[0] && leadSuit) {
        aiMemory.humanLeadPatterns.push(leadSuit);
        if (aiMemory.humanLeadPatterns.length > 6) aiMemory.humanLeadPatterns.shift();
      }
    }
  }

  // Themed name sets — each set of 5 used together as a lobby persona batch
  // Rotate the ENTIRE set after each full game (62 pts reached)
  const AI_NAME_SETS = [
    // 0 — Classic South Indian
    ['Arjun','Priya','Kiran','Meera','Ravi'],
    // 1 — North Indian Metro
    ['Dev','Aanya','Rohan','Simran','Nikhil'],
    // 2 — Odia Traditional ✨
    ['Biswa','Sasmita','Pradyumna','Sulochana','Tapan'],
    // 3 — Odia Modern ✨
    ['Subha','Lipsa','Debasis','Ankita','Sushant'],
    // 4 — Odia Coastal/Puri vibes ✨
    ['Jagannath','Bidulata','Krushna','Mamata','Bapi'],
    // 5 — Odia Gen Z ✨
    ['Rishav','Priyanka','Siddharth','Barsha','Dibyajyoti'],
    // 6 — Pan-Indian Gen Z
    ['Zara','Ayaan','Myra','Rehan','Tara'],
    // 7 — Bollywood vibes
    ['Raj','Simran','Rahul','Pooja','Kabir'],
    // 8 — Sporty nicknames
    ['Sunny','Bunny','Rocky','Lucky','Pinky'],
    // 9 — South Indian Modern
    ['Aditi','Vikram','Kavya','Siddharth','Divya'],
  ];
  // Per-seat name pools for mid-round rotation (drawn from all sets)
  const AI_NAME_POOL = [
    ['Arjun','Dev','Rohan','Vikram','Biswa','Subha','Rishav','Debasis','Pradyumna','Sushant','Sunny','Raj'],
    ['Priya','Aanya','Ananya','Sasmita','Lipsa','Barsha','Simran','Pooja','Divya','Ankita','Lucky','Meera'],
    ['Kiran','Rahul','Aditya','Krushna','Tapan','Siddharth','Rocky','Kabir','Jagannath','Bapi','Nikhil','Ravi'],
    ['Meera','Simran','Sulochana','Mamata','Bidulata','Priyanka','Tara','Myra','Kavya','Rekha','Geeta','Sneha'],
    ['Ravi','Nikhil','Dibyajyoti','Sushant','Debasis','Rehan','Bunny','Pinky','Suresh','Mohan','Deepak','Gopal'],
  ];
  let aiCurrentSetIdx = 0;
  let aiNameRotateTimer = null;

  function getState() { return state; }
  function getMySeat() { return mySeat; }
  function getMyTeam() { return Engine.getTeam(mySeat); }

  // ===== SINGLE PLAYER (SOLO) MODE =====
  function startSoloGame(playerName) {
    isSoloMode = true;
    myName = playerName;
    myPlayerId = GameCrypto.generatePlayerId();
    mySeat = 0;
    state = Engine.createGameState();

    // Seat player at 0, AI at 1-5
    state.players[0] = { id: myPlayerId, name: myName, seat: 0, peerId: null, connected: true, isAI: false };
    for (let i = 1; i < 6; i++) {
      state.players[i] = {
        id: 'AI_' + i,
        name: AI_NAMES[i - 1],
        seat: i,
        peerId: null,
        connected: true,
        isAI: true,
      };
    }

    UI.showToast('Game started \u2014 you are on Team A with ' + AI_NAMES[1] + ' & ' + AI_NAMES[3]);
    startAINameRotation();
    startNewRound();
  }

  // Rotate AI bot names once between rounds (called at ROUND_END)
  function rotateAINamesBetweenRounds() {
    if (!state || !isSoloMode) return;
    for (let i = 1; i < 6; i++) {
      const pool = AI_NAME_POOL[i - 1];
      const currentName = state.players[i]?.name;
      let newName = currentName;
      let tries = 0;
      while (newName === currentName && tries++ < 20) {
        newName = pool[Math.floor(Math.random() * pool.length)];
      }
      if (state.players[i] && newName !== currentName) {
        state.players[i].name = newName;
      }
    }
  }

  function startAINameRotation() { /* no-op — names now rotate between rounds */ }
  function stopAINameRotation() { /* no-op */ }

  // ============================================================
  // MULTIPLAYER SESSION LAYER
  // ------------------------------------------------------------
  // Authority model: exactly one host per "term". Every message carries the
  // sender's term (_t). A host that sees a higher term steps down and rejoins
  // as a player; a client ignores authority messages from a lower term and
  // tells the sender it is stale. Terms increase only on host migration.
  //
  // Identity: each player holds a random secret; only its SHA-256 hash is
  // stored in the (shared) player table, so whichever device is host can
  // verify a rejoin without ever seeing the secret in advance.
  //
  // Discovery: the original host registers TC_<code>; the host of term N
  // also registers alias TC_<code>_N. Any room member answers ROOM_PROBE with
  // the current host, so joiners/rejoiners find it from the room code alone.
  // ============================================================

  // Test hook: ?testSpeed=0.05 compresses game pacing delays (AI think time,
  // trick pause, round pause) so E2E tests can play whole rounds quickly.
  const SPEED = (() => {
    try {
      const v = parseFloat(new URLSearchParams(window.location.search).get('testSpeed'));
      return v > 0 && v < 1 ? v : 1;
    } catch (_) { return 1; }
  })();
  const d = (ms) => Math.max(20, Math.round(ms * SPEED));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  let turnTimer = null;
  let raiseTimer = null;
  const TURN_TIMEOUT_MS = 45000; // 45s before auto-play
  // Keyed by playerId: { seat, name, playerId, leftAt }
  let disconnectedPlayers = new Map();
  // Authoritative host peerId as seen by clients
  let currentHostPeerId = null;

  // State-sync anti-race: host stamps each state broadcast with a monotonic
  // version; clients ignore updates older than (term, version) already applied.
  let lastAppliedStateVersion = 0;
  let lastAppliedStateTerm = 0;
  let playedCardSeq = new Set(); // 'seat:cardId:seq' strings already applied
  let cardPlaySeqCounter = 0;    // host-side; increments per card played

  let hostTerm = 0;
  let mySecret = null;
  let myTokenHash = null;
  let lastHiddenAt = 0;
  let lastResumeAt = 0;
  let aiTurnToken = 0;
  let roundToken = 0;
  let dealing = false;
  let networkWired = false;
  let pendingPlay = null;        // { cardId, card, at } — client optimistic play
  let migrationInProgress = false;
  let migrationTimer = null;
  let handSync = null;           // host-side, during post-migration hand recovery
  let reconnecting = null;       // in-flight reconnect promise
  let rejoinWaiter = null;
  let unloading = false; // set once the tab starts closing/refreshing
  let authorityWatch = null;
  let savedKnownPeers = [];
  let lastSessionSave = 0;
  const probeListeners = new Set();
  const bannerReasons = new Map();

  // Bump when the wire protocol changes; mismatched peers are told to refresh
  const PROTOCOL_VERSION = 2;
  const SESSION_KEY = 'nattice.session.v1';
  const SESSION_MAX_AGE_MS = 3 * 60 * 60 * 1000;
  const DEALT_PHASES = ['BIDDING', 'TRUMP_SELECT', 'PLAYING', 'RAISE_CHECK'];

  // Messages only the host may send (subject to term checks on clients)
  const HOST_AUTH_TYPES = new Set([
    'SEAT_ASSIGNED', 'SYNC', 'STATE_UPDATE', 'DEAL', 'DEAL_HAND', 'CARD_PLAYED',
    'TRICK_RESULT', 'ROUND_RESULT', 'GAME_OVER', 'RAISE_PROMPT', 'PLAYER_LEFT',
    'PLAYER_REJOINED', 'HOST_CLOSED', 'KICKED', 'PEER_LIST', 'PLAY_REJECTED',
    'REJOIN_REJECTED', 'ERROR', 'HOST_MIGRATED',
  ]);
  // Player actions the host defers while it recovers hands after migration
  const DEFERRABLE_TYPES = new Set([
    'BID', 'TRUMP_SELECT', 'PLAY_CARD', 'RAISE_BID', 'RAISE_COMMIT',
    'EXTEND_TIMER', 'NO_RAISE', 'JOIN_REQUEST', 'REJOIN_REQUEST', 'STATE_REQUEST',
  ]);

  // ---------- messaging ----------
  function stamp(msg) { return Object.assign({}, msg, { _t: hostTerm }); }
  function send(peerId, msg) { return Network.sendTo(peerId, stamp(msg)); }
  function bcast(msg) { return Network.broadcast(stamp(msg)); }

  function sendToHost(msg) {
    const h = getHostPeerId();
    if (!h || !Network.isConnectedTo(h) || migrationInProgress) {
      UI.showToast('Reconnecting to the host — try again in a moment');
      if (!migrationInProgress) reconnectToGame('send-failed');
      return false;
    }
    send(h, msg);
    return true;
  }

  function getHostPeerId() {
    if (Network.getIsHost()) return Network.getPeerId();
    return currentHostPeerId || null;
  }

  function seatToPeerObject() {
    const o = {};
    for (const [s, p] of seatToPeer) o[s] = p;
    return o;
  }

  function seatOfPeer(peerId) {
    if (!peerId || !state || !state.players) return -1;
    for (let s = 0; s < 6; s++) {
      if (state.players[s] && state.players[s].peerId === peerId) return s;
    }
    return -1;
  }

  function aliasFor(term) {
    return term === 0 ? 'TC_' + roomCode : `TC_${roomCode}_${term}`;
  }

  function isRoomMemberPeer(peerId) {
    return seatOfPeer(peerId) >= 0;
  }

  // Peer IDs of other humans in this game (used to find the room again)
  function knownRoomPeers() {
    const ids = new Set(savedKnownPeers);
    if (state && state.players) {
      for (const p of state.players) {
        if (p && p.peerId && !String(p.id).startsWith('AI_')) ids.add(p.peerId);
      }
    }
    if (currentHostPeerId) ids.add(currentHostPeerId);
    ids.delete(myPeerId);
    return Array.from(ids);
  }

  // ---------- connection banner ----------
  function setBanner(reason, text) {
    if (text) bannerReasons.set(reason, text);
    else bannerReasons.delete(reason);
    const first = bannerReasons.size ? Array.from(bannerReasons.values())[0] : null;
    if (typeof UI !== 'undefined' && UI.showConnectionBanner) UI.showConnectionBanner(first);
  }

  // ---------- persistent session (survives refresh / tab kill) ----------
  function saveSession(force = false) {
    if (isSoloMode || !roomCode || !myPlayerId || !mySecret) return;
    const now = Date.now();
    if (!force && now - lastSessionSave < 2000) return;
    lastSessionSave = now;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        roomCode, playerId: myPlayerId, name: myName, secret: mySecret,
        seat: mySeat, hostTerm, knownPeers: knownRoomPeers(), savedAt: now,
      }));
    } catch (_) { /* storage unavailable (private mode) — rejoin by code still works in-page */ }
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
  }

  function getSavedSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.roomCode || !s.playerId || !s.secret || !s.savedAt) return null;
      if (Date.now() - s.savedAt > SESSION_MAX_AGE_MS) { clearSession(); return null; }
      return s;
    } catch (_) { return null; }
  }

  async function initIdentity(name, existing = null) {
    myName = name;
    if (existing) {
      myPlayerId = existing.playerId;
      mySecret = existing.secret;
    } else {
      myPlayerId = GameCrypto.generatePlayerId();
      mySecret = GameCrypto.generateSecret();
    }
    myTokenHash = await GameCrypto.sha256Hex(mySecret);
  }

  function resetSyncCounters() {
    cardPlaySeqCounter = 0;
    lastAppliedStateVersion = 0;
    lastAppliedStateTerm = 0;
    playedCardSeq.clear();
    pendingPlay = null;
  }

  function wireNetwork() {
    Network.onMessage(onNetMessage);
    Network.onPeerLeave(onNetPeerLeave);
    Network.onPeerJoin(onNetPeerJoin);
    Network.onSignalingChange((s) => {
      if (!roomCode || isSoloMode) return;
      setBanner('signaling', s === 'reconnecting' ? 'Network hiccup — reconnecting…' : null);
    });
    Network.startHeartbeat();
    if (!networkWired) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('pageshow', handlePageShow);
      window.addEventListener('online', handleOnline);
      networkWired = true;
    }
  }

  // Initialize a new game as host
  async function hostGame(playerName) {
    await initIdentity(playerName);
    state = Engine.createGameState();
    state.version = 0;
    state.hostPlayerId = myPlayerId;
    hostTerm = 0;
    state.hostTerm = 0;
    roomCode = GameCrypto.generateRoomCode();
    resetSyncCounters();

    // Deterministic peer ID so joiners can find the host by room code only
    await Network.init('TC_' + roomCode);
    myPeerId = Network.getPeerId();
    await Network.createRoom(roomCode);

    mySeat = 0;
    state.players[0] = {
      id: myPlayerId, name: myName, seat: 0, peerId: myPeerId,
      connected: true, tokenHash: myTokenHash,
    };
    peerToSeat.set(myPeerId, 0);
    seatToPeer.set(0, myPeerId);
    currentHostPeerId = myPeerId;

    wireNetwork();
    startAuthorityWatch();
    saveSession(true);
    return roomCode;
  }

  // Join an existing game by room code
  async function joinGame(playerName, code) {
    code = code.trim().toUpperCase();
    await initIdentity(playerName);
    roomCode = code;
    hostTerm = 0;
    resetSyncCounters();
    try {
      await Network.init();
      myPeerId = Network.getPeerId();
      wireNetwork();
      await Network.setRoom(code);
      // Find whoever hosts the room now (may not be the original creator)
      const info = await locateHost(code, [], { fromTerm: 0 });
      hostTerm = info.term;
      currentHostPeerId = info.hostPeerId;
      await Network.connectToPeer(info.hostPeerId, 12000);
      dropProbeConnections(info.hostPeerId);
      console.log('[Game] Joining room', code, '→ host', info.hostPeerId, 'term', info.term);
      send(info.hostPeerId, {
        type: 'JOIN_REQUEST', name: myName, playerId: myPlayerId,
        peerId: myPeerId, tokenHash: myTokenHash, protocol: PROTOCOL_VERSION,
      });
    } catch (e) {
      cleanup();
      throw e;
    }
  }

  // Rejoin the game saved in localStorage (after refresh / crash / tab kill)
  async function resumeSavedSession() {
    const s = getSavedSession();
    if (!s) throw new Error('No saved game to rejoin');
    await initIdentity(s.name, s);
    roomCode = s.roomCode;
    hostTerm = s.hostTerm || 0;
    savedKnownPeers = Array.isArray(s.knownPeers) ? s.knownPeers : [];
    resetSyncCounters();
    try {
      await Network.init();
      myPeerId = Network.getPeerId();
      wireNetwork();
      await Network.setRoom(roomCode);
      const ok = await reconnectToGame('resume-saved', { maxMs: 45000 });
      if (!ok) throw new Error('Could not rejoin — the game may have ended');
    } catch (e) {
      cleanup();
      throw e;
    }
  }

  // ---------- room discovery ----------
  // Probe well-known aliases + known member peers; any member replies with
  // ROOM_INFO {term, hostPeerId}. Pick the highest term seen.
  function locateHost(code, extraPeers = [], opts = {}) {
    const timeoutMs = opts.timeoutMs || 12000;
    const fromTerm = Math.max(0, opts.fromTerm || 0);
    const ids = new Set(['TC_' + code]);
    for (let t = Math.max(1, fromTerm - 1); t <= fromTerm + 4; t++) ids.add(`TC_${code}_${t}`);
    for (const p of extraPeers) if (p) ids.add(p);
    ids.delete(myPeerId);

    return new Promise((resolve, reject) => {
      let best = null;
      let done = false;
      let settleTimer = null;
      let unavailable = 0;
      let failed = 0;
      const finish = () => {
        if (done) return;
        done = true;
        probeListeners.delete(onInfo);
        clearTimeout(hardTimer);
        clearTimeout(settleTimer);
        if (best) { resolve(best); return; }
        const err = new Error('Room not found. Check the code and try again.');
        // The broker told us definitively that none of these IDs exist
        err.allUnavailable = unavailable === ids.size;
        reject(err);
      };
      const onInfo = (fromPeer, msg) => {
        if (msg.roomCode !== code || !msg.hostPeerId || typeof msg.term !== 'number') return;
        if (!best || msg.term > best.term) best = { term: msg.term, hostPeerId: msg.hostPeerId, phase: msg.phase };
        if (!settleTimer) settleTimer = setTimeout(finish, 1200); // brief window for higher terms
      };
      probeListeners.add(onInfo);
      const hardTimer = setTimeout(finish, timeoutMs);
      for (const id of ids) {
        Network.connectToPeer(id, Math.min(8000, timeoutMs)).then((conn) => {
          if (done || !conn) return;
          Network.sendTo(id, { type: 'ROOM_PROBE', roomCode: code, _t: hostTerm });
        }).catch((e) => {
          failed++;
          if (e && e.message === 'peer-unavailable') unavailable++;
          if (failed === ids.size && !best) finish();
        });
      }
    });
  }

  // Close discovery-only connections to aliases (not room members)
  function dropProbeConnections(keepPeerId) {
    setTimeout(() => {
      for (const id of Network.getConnectedPeers()) {
        if (id === keepPeerId) continue;
        if (id.startsWith('TC_' + roomCode) && !isRoomMemberPeer(id)) Network.dropPeer(id);
      }
    }, 1500);
  }

  function roomInfoMessage() {
    const hostId = Network.getIsHost() ? myPeerId : currentHostPeerId;
    return { type: 'ROOM_INFO', roomCode, term: hostTerm, hostPeerId: hostId, phase: state ? state.phase : null };
  }

  // ---------- unified inbound dispatch ----------
  function onNetMessage(fromPeer, msg) {
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'ROOM_PROBE') {
      if (roomCode && msg.roomCode === roomCode && !isSoloMode && !migrationInProgress) {
        const info = roomInfoMessage();
        if (info.hostPeerId) send(fromPeer, info);
      }
      // A prober with a higher term knows about a newer host
      if (state && Network.getIsHost() && typeof msg._t === 'number' && msg._t > hostTerm) {
        checkAuthority();
      }
      return;
    }
    if (msg.type === 'ROOM_INFO') {
      for (const fn of Array.from(probeListeners)) fn(fromPeer, msg);
      if (state && Network.getIsHost() && msg.roomCode === roomCode && msg.hostPeerId && msg.hostPeerId !== myPeerId) {
        if (msg.term > hostTerm) stepDown(msg.hostPeerId, msg.term);
        else if (msg.term === hostTerm) resolveSameTermHost(msg.hostPeerId);
      }
      return;
    }

    const t = typeof msg._t === 'number' ? msg._t : null;
    if (state && t !== null) {
      if (Network.getIsHost()) {
        if (t > hostTerm) {
          // A newer host exists — we are the stale one.
          const newHost = msg.type === 'HOST_MIGRATED' ? msg.hostPeerId : (msg.hostPeerId || null);
          stepDown(newHost, t);
          return;
        }
        if (msg.type === 'HOST_MIGRATED' && t === hostTerm && msg.hostPeerId !== myPeerId) {
          // Two hosts at the same term: lower seat keeps authority.
          if (typeof msg.hostSeat === 'number' && msg.hostSeat < mySeat) stepDown(msg.hostPeerId, t);
          else send(fromPeer, hostMigratedMessage(-1, false));
          return;
        }
        if (msg.type === 'STALE_TERM') return; // handled by term rule above
      } else if (HOST_AUTH_TYPES.has(msg.type)) {
        if (t < hostTerm) {
          send(fromPeer, { type: 'STALE_TERM', term: hostTerm, hostPeerId: currentHostPeerId });
          return;
        }
        if (msg.type !== 'HOST_MIGRATED') {
          if (t > hostTerm) {
            // Newer host reached us before its HOST_MIGRATED — adopt it.
            hostTerm = t;
            currentHostPeerId = fromPeer;
            endMigrationWait();
          } else if (currentHostPeerId && fromPeer !== currentHostPeerId) {
            return; // authority message from someone who isn't our host
          }
        }
      }
    }

    if (Network.getIsHost()) {
      if (handSync && DEFERRABLE_TYPES.has(msg.type)) { handSync.buffer.push([fromPeer, msg]); return; }
      handleHostMessage(fromPeer, msg);
    } else {
      handleClientMessage(fromPeer, msg);
    }
  }

  function onNetPeerJoin(peerId) {
    if (!state || isSoloMode || !Network.getIsHost()) return;
    // A seated human (same peer instance) reconnecting straight to the new
    // host after migration — bring them into the new term.
    const seat = seatOfPeer(peerId);
    if (seat < 0 || seat === mySeat) return;
    const p = state.players[seat];
    if (!p || p.kicked || String(p.id).startsWith('AI_')) return;
    if (!peerToSeat.has(peerId)) {
      peerToSeat.set(peerId, seat);
      seatToPeer.set(seat, peerId);
    }
    if (handSync) {
      if (!handSync.announced.has(peerId)) {
        handSync.announced.add(peerId);
        handSync.waiting.add(seat);
        send(peerId, hostMigratedMessage(handSync.departedSeat, true));
      }
      return;
    }
    if (p.connected === false && p.migrationDrop) {
      restoreHumanSeat(seat, peerId);
      sendSync(peerId);
      bcast({ type: 'PLAYER_REJOINED', seat, name: p.name });
      broadcastPeerList();
      broadcastState();
      if (isTurnOf(seat)) checkAITurn();
    }
  }

  function onNetPeerLeave(peerId) {
    if (!state || isSoloMode || unloading) return;
    if (Network.getIsHost()) { hostHandlePeerLeave(peerId); return; }
    if (peerId !== currentHostPeerId) return;
    // Losing the host right after we resumed (or while hidden) almost always
    // means WE were away — find the room again instead of migrating.
    const away = document.hidden || (Date.now() - lastResumeAt < 4000);
    if (away || reconnecting) {
      reconnectToGame('host-lost-while-away');
      return;
    }
    console.warn('[Client] Host disconnected — starting host migration');
    attemptHostMigration(peerId);
  }

  function hostHandlePeerLeave(peerId) {
    const seat = peerToSeat.get(peerId);
    if (seat === undefined || !state.players[seat]) return;
    const player = state.players[seat];
    peerToSeat.delete(peerId);
    seatToPeer.delete(seat);

    if (state.phase === 'WAITING') {
      // Lobby: free the seat entirely (no bot before the game starts)
      console.log(`[Host] "${player.name}" left the lobby — freeing seat ${seat}`);
      state.players[seat] = null;
      bcast({ type: 'PLAYER_LEFT', seat, name: player.name });
      broadcastState();
      UI.updateLobby(state, mySeat);
      return;
    }

    console.log(`[Host] Player "${player.name}" (seat ${seat}) disconnected`);
    disconnectedPlayers.set(player.id, { seat, name: player.originalName || player.name, playerId: player.id, leftAt: Date.now() });
    markSeatBot(seat);
    player.leftAt = Date.now();
    UI.showToast(`${player.originalName} disconnected — Bot taking over`);
    bcast({ type: 'PLAYER_LEFT', seat, name: player.originalName });
    broadcastState();
    if (isTurnOf(seat)) checkAITurn();
    // Everyone dropping right after we woke up smells like a split brain
    if (Date.now() - lastResumeAt < 15000) checkAuthority();
  }

  function markSeatBot(seat) {
    const p = state && state.players[seat];
    if (!p || p.isAI) return;
    p.connected = false;
    p.isAI = true;
    p.originalName = p.originalName || p.name;
    p.name = `${p.originalName} (Bot)`;
  }

  function restoreHumanSeat(seat, peerId) {
    const p = state.players[seat];
    p.peerId = peerId;
    p.connected = true;
    p.isAI = false;
    if (p.originalName) p.name = p.originalName;
    delete p.originalName;
    delete p.migrationDrop;
    delete p.leftAt;
    peerToSeat.set(peerId, seat);
    seatToPeer.set(seat, peerId);
    disconnectedPlayers.delete(p.id);
  }

  function isTurnOf(seat) {
    return !!(state && state.currentRound && DEALT_PHASES.includes(state.phase) &&
      state.phase !== 'RAISE_CHECK' && state.currentRound.currentPlayer === seat);
  }

  function broadcastPeerList() {
    const peers = [myPeerId];
    for (const [, pid] of seatToPeer) if (pid && pid !== myPeerId) peers.push(pid);
    bcast({ type: 'PEER_LIST', peers });
  }

  // Full snapshot for one client: state + their private hand
  function sendSync(peerId) {
    const seat = peerToSeat.get(peerId);
    if (seat === undefined) { send(peerId, { type: 'REJOIN_REJECTED', reason: 'Not seated', retry: true }); return; }
    send(peerId, {
      type: 'SYNC', seat, state: sanitizeStateForClient(state),
      hand: state.hands[seat] || [], seatToPeer: seatToPeerObject(),
      hostPeerId: myPeerId, hostTerm, protocol: PROTOCOL_VERSION,
    });
  }

  // ---------- client: applying host snapshots ----------
  function applyState(incoming, { force = false, hand = null, term = hostTerm } = {}) {
    if (!incoming) return false;
    const v = incoming.version || 0;
    if (!force) {
      if (term < lastAppliedStateTerm) return false;
      if (term === lastAppliedStateTerm && v && v <= lastAppliedStateVersion) return false;
    }
    lastAppliedStateTerm = term;
    lastAppliedStateVersion = v;
    const myHand = hand || (state && state.hands && state.hands[mySeat]) || [];
    state = incoming;
    if (state.currentRound && Array.isArray(state.currentRound.passedPlayers)) {
      state.currentRound.passedPlayers = new Set(state.currentRound.passedPlayers);
    }
    if (mySeat >= 0) state.hands[mySeat] = myHand;
    // An optimistic play that the host has since resolved is no longer pending
    if (pendingPlay && (!state.currentRound || state.currentRound.currentPlayer !== mySeat)) pendingPlay = null;
    return true;
  }

  function renderForPhase() {
    if (!state || mySeat < 0) return;
    if (state.phase === 'WAITING') {
      UI.showScreen('lobby-screen');
      UI.updateLobby(state, mySeat);
    } else {
      UI.updateAll(state, mySeat);
    }
  }

  function adoptHostSnapshot(fromPeer, msg) {
    mySeat = msg.seat;
    if (msg.hostPeerId) currentHostPeerId = msg.hostPeerId; else currentHostPeerId = fromPeer;
    if (typeof msg.hostTerm === 'number') hostTerm = Math.max(hostTerm, msg.hostTerm);
    endMigrationWait();
    pendingPlay = null;
    applyState(msg.state, { force: true, hand: Array.isArray(msg.hand) ? msg.hand : null });
    if (msg.seatToPeer) {
      seatToPeer.clear();
      for (const [seat, peerId] of Object.entries(msg.seatToPeer)) seatToPeer.set(Number(seat), peerId);
    }
    saveSession(true);
    renderForPhase();
    if (rejoinWaiter) rejoinWaiter(true);
  }

  // ---------- client: reconnect / rejoin ----------
  function sendRejoinAndWait(hostPeerId) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { rejoinWaiter = null; resolve(false); }, 8000);
      rejoinWaiter = (result) => { clearTimeout(timer); rejoinWaiter = null; resolve(result); };
      send(hostPeerId, {
        type: 'REJOIN_REQUEST', playerId: myPlayerId, secret: mySecret,
        name: myName, tokenHash: myTokenHash, peerId: myPeerId,
      });
    });
  }

  function reconnectToGame(reason, opts = {}) {
    if (reconnecting) return reconnecting;
    if (isSoloMode || !roomCode || unloading) return Promise.resolve(false);
    console.log('[Game] Reconnecting to game:', reason);
    setBanner('rejoin', 'Reconnecting to the game…');
    const maxMs = opts.maxMs || 120000;
    reconnecting = (async () => {
      const started = Date.now();
      let attempt = 0;
      let preferHost = opts.preferHost || null;
      while (roomCode && Date.now() - started < maxMs) {
        attempt++;
        try {
          if (!Network.isReady()) {
            await Network.init();
            myPeerId = Network.getPeerId();
            wireNetwork();
          }
          if (!Network.hasRoomKey()) await Network.setRoom(roomCode);
          let target;
          if (preferHost) {
            target = { hostPeerId: preferHost, term: hostTerm };
            preferHost = null;
          } else {
            target = await locateHost(roomCode, knownRoomPeers(), { fromTerm: hostTerm, timeoutMs: 10000 });
          }
          if (Network.getIsHost()) return true; // became host meanwhile
          if (target.hostPeerId === myPeerId) throw new Error('self-referential room info');
          await Network.connectToPeer(target.hostPeerId, 10000);
          hostTerm = Math.max(hostTerm, target.term);
          currentHostPeerId = target.hostPeerId;
          const result = await sendRejoinAndWait(target.hostPeerId);
          if (result === 'rejected') return false;
          if (result === true) {
            dropProbeConnections(target.hostPeerId);
            UI.showToast('Reconnected');
            return true;
          }
        } catch (e) {
          console.warn('[Game] Rejoin attempt', attempt, 'failed:', e && e.message);
          // The broker confirms nobody from this room is online any more.
          // If we hold a live mid-game state, carry on as host with bots.
          if (e && e.allUnavailable && state && DEALT_PHASES.concat(['ROUND_END']).includes(state.phase) &&
              Date.now() - started > 15000) {
            console.warn('[Game] Room is empty — taking over as host');
            for (let s = 0; s < 6; s++) if (s !== mySeat) markSeatBot(s);
            promoteSelfToHost(-1, null);
            return true;
          }
        }
        await sleep(Math.min(8000, 1000 * Math.pow(2, attempt - 1)));
      }
      if (roomCode) UI.showToast('Could not reconnect to the game');
      return false;
    })().finally(() => {
      reconnecting = null;
      setBanner('rejoin', null);
    });
    return reconnecting;
  }

  function onRejoinRejected(msg) {
    // Only a rejection of OUR in-flight rejoin counts; anything else (a stale
    // reply, or a reply about someone else's id) must not tear down our seat.
    if (msg.playerId && msg.playerId !== myPlayerId) return;
    if (!rejoinWaiter && !reconnecting) return;
    if (msg.retry) { reconnectToGame('not-seated'); return; }
    if (rejoinWaiter) rejoinWaiter('rejected');
    clearSession();
    UI.showToast(msg.reason || 'Could not rejoin the game');
    setTimeout(() => { cleanup(); UI.showScreen('title-screen'); }, 1500);
  }

  // ---------- resume / visibility ----------
  function handleVisibilityChange() {
    if (document.hidden) {
      lastHiddenAt = Date.now();
      return;
    }
    const away = lastHiddenAt ? Date.now() - lastHiddenAt : 0;
    onResume(away);
  }

  function handlePageShow(e) {
    unloading = false;
    if (e && e.persisted) onResume(60000); // restored from back/forward cache
  }

  function handleOnline() {
    if (!state || isSoloMode || Network.getIsHost()) return;
    const h = currentHostPeerId;
    if (!h || !Network.isConnectedTo(h)) reconnectToGame('online');
  }

  function onResume(awayMs) {
    lastResumeAt = Date.now();
    if (!state || isSoloMode || !roomCode) return;
    Network.resetLiveness();
    renderForPhase();
    if (awayMs < 3000) return;
    console.log(`[Game] Resumed after ${Math.round(awayMs / 1000)}s away`);
    if (Network.getIsHost()) {
      // Others may have promoted a new host while we were frozen.
      checkAuthority();
      setTimeout(checkAuthority, 5000);
      return;
    }
    const h = currentHostPeerId;
    if (h && Network.isConnectedTo(h)) send(h, { type: 'STATE_REQUEST' });
    else reconnectToGame('resume');
  }

  // Host: look for a newer host (higher term) or a same-term rival
  function checkAuthority() {
    if (!Network.getIsHost() || !roomCode || isSoloMode) return;
    const ids = new Set();
    for (let t = hostTerm + 1; t <= hostTerm + 2; t++) ids.add(aliasFor(t));
    const now = Date.now();
    if (state && state.players) {
      for (const p of state.players) {
        if (p && p.peerId && p.peerId !== myPeerId && !String(p.id).startsWith('AI_') &&
            !Network.isConnectedTo(p.peerId) && (!p.leftAt || now - p.leftAt < 180000)) ids.add(p.peerId);
      }
    }
    for (const id of ids) {
      Network.connectToPeer(id, 6000).then((c) => {
        if (c && Network.getIsHost()) send(id, { type: 'ROOM_PROBE', roomCode });
      }).catch(() => {});
    }
    setTimeout(() => {
      for (const id of ids) {
        if (id.startsWith('TC_' + roomCode + '_') && Network.isConnectedTo(id) && !isRoomMemberPeer(id)) Network.dropPeer(id);
      }
    }, 8000);
  }

  function startAuthorityWatch() {
    stopAuthorityWatch();
    authorityWatch = setInterval(() => {
      if (!document.hidden) checkAuthority();
    }, 15000);
  }

  function stopAuthorityWatch() {
    if (authorityWatch) { clearInterval(authorityWatch); authorityWatch = null; }
  }

  function resolveSameTermHost(otherHostPeerId) {
    const otherSeat = seatOfPeer(otherHostPeerId);
    if (otherSeat >= 0 && otherSeat < mySeat) {
      stepDown(otherHostPeerId, hostTerm);
    } else {
      Network.connectToPeer(otherHostPeerId, 6000)
        .then(() => send(otherHostPeerId, hostMigratedMessage(-1, false)))
        .catch(() => {});
    }
  }

  // Stale host → demote to client and rejoin whoever holds authority now
  function stepDown(newHostPeerId, term) {
    if (!Network.getIsHost()) return;
    console.warn('[Game] Stepping down: newer host', newHostPeerId, 'term', term, '(mine', hostTerm + ')');
    UI.showToast('Another player took over hosting — rejoining…');
    clearTurnTimer();
    clearRaiseTimer();
    aiTurnToken++;
    roundToken++;
    if (handSync) { clearTimeout(handSync.timer); handSync = null; }
    stopAuthorityWatch();
    Network.demoteToClient();
    hostTerm = Math.max(hostTerm, term);
    currentHostPeerId = newHostPeerId || null;
    migrationInProgress = false;
    // Old authority connections to our former clients are now meaningless
    reconnectToGame('stepped-down', { preferHost: newHostPeerId || null });
  }

  // ---------- host migration ----------
  // Deterministic election: every survivor picks the lowest-numbered seat
  // held by a connected human (excluding seats that already failed).
  function electNextHost(excluded) {
    if (!state || !state.players) return null;
    for (let s = 0; s < 6; s++) {
      if (excluded.has(s)) continue;
      const p = state.players[s];
      if (p && !p.isAI && p.connected !== false && p.peerId) {
        return { seat: s, peerId: p.peerId, name: p.name };
      }
    }
    return null;
  }

  function endMigrationWait() {
    migrationInProgress = false;
    if (migrationTimer) { clearTimeout(migrationTimer); migrationTimer = null; }
    setBanner('migrate', null);
  }

  function attemptHostMigration(departedPeerId, excluded = new Set()) {
    if (Network.getIsHost() || !state || unloading) return;
    migrationInProgress = true;
    setBanner('migrate', 'Host left — handing off…');

    const departedSeat = seatOfPeer(departedPeerId);
    if (departedSeat >= 0) { excluded.add(departedSeat); markSeatBot(departedSeat); }

    // If we can't reach ANY other human, it's probably our own network that
    // failed. Don't crown ourselves; go find the room instead.
    const others = [];
    for (let s = 0; s < 6; s++) {
      const p = state.players[s];
      if (s !== mySeat && !excluded.has(s) && p && !p.isAI && p.peerId) others.push(p);
    }
    if (others.length > 0 && !others.some(p => Network.isConnectedTo(p.peerId))) {
      endMigrationWait();
      reconnectToGame('isolated');
      return;
    }

    const elected = electNextHost(excluded);
    if (!elected) { endMigrationWait(); reconnectToGame('no-candidate'); return; }
    UI.showToast(`Host lost — ${elected.seat === mySeat ? 'you are taking over' : elected.name + ' is taking over'}`);

    if (elected.seat === mySeat) {
      promoteSelfToHost(departedSeat, departedPeerId);
      return;
    }
    currentHostPeerId = elected.peerId;
    if (!Network.isConnectedTo(elected.peerId)) Network.connectToPeer(elected.peerId, 6000).catch(() => {});
    const termAtStart = hostTerm;
    if (migrationTimer) clearTimeout(migrationTimer);
    migrationTimer = setTimeout(() => {
      migrationTimer = null;
      if (!migrationInProgress || hostTerm !== termAtStart) return;
      console.warn('[Client] Elected host', elected.seat, 'silent — electing the next one');
      excluded.add(elected.seat);
      attemptHostMigration(null, excluded);
    }, 8000);
  }

  function hostMigratedMessage(departedSeat, needHands) {
    return {
      type: 'HOST_MIGRATED', hostPeerId: myPeerId, hostSeat: mySeat, departedSeat,
      state: sanitizeStateForClient(state), seatToPeer: seatToPeerObject(), needHands,
    };
  }

  function promoteSelfToHost(departedSeat, departedPeerId) {
    if (unloading) return;
    console.log('[Game] Promoting self to host');
    hostTerm += 1;
    state.hostTerm = hostTerm;
    Network.promoteToHost();
    endMigrationWait();
    currentHostPeerId = myPeerId;
    state.hostPlayerId = myPlayerId;
    cardPlaySeqCounter = hostTerm * 100000;
    clearTurnTimer();
    clearRaiseTimer();

    peerToSeat.clear();
    seatToPeer.clear();
    for (let s = 0; s < 6; s++) {
      const p = state.players[s];
      if (s === mySeat || !p || p.isAI || !p.peerId) continue;
      peerToSeat.set(p.peerId, s);
      seatToPeer.set(s, p.peerId);
      if (!Network.isConnectedTo(p.peerId)) Network.connectToPeer(p.peerId, 6000).catch(() => {});
    }
    peerToSeat.set(myPeerId, mySeat);
    seatToPeer.set(mySeat, myPeerId);

    const alias = aliasFor(hostTerm);
    Network.claimAlias(alias, {
      onTaken: () => {
        Network.connectToPeer(alias, 6000)
          .then((c) => { if (c) send(alias, { type: 'ROOM_PROBE', roomCode }); })
          .catch(() => {});
      },
    });

    const dealt = DEALT_PHASES.includes(state.phase) && state.currentRound;
    if (dealt) {
      const waiting = new Set();
      const announced = new Set();
      for (const [s, pid] of seatToPeer) {
        if (s !== mySeat && Network.isConnectedTo(pid)) { waiting.add(s); announced.add(pid); }
      }
      handSync = { hands: {}, waiting, announced, buffer: [], departedSeat, timer: setTimeout(finishHandSync, 4000) };
    }
    bcast(hostMigratedMessage(departedSeat, !!dealt));
    saveSession(true);
    UI.showToast('You are now the host');
    if (state.phase === 'WAITING') showHostLobbyControls();

    if (departedPeerId) nudgeOldHost(departedPeerId);
    startAuthorityWatch();

    if (!dealt) resumeHostAuthority();
    else if (handSync.waiting.size === 0) finishHandSync();
  }

  // If the old host is actually alive (frozen, partitioned), tell it directly
  // so it steps down instead of running a parallel game.
  function nudgeOldHost(peerId) {
    const termAtStart = hostTerm;
    for (const delay of [0, 10000, 30000]) {
      setTimeout(() => {
        if (!Network.getIsHost() || hostTerm !== termAtStart || !roomCode) return;
        Network.connectToPeer(peerId, 6000)
          .then((c) => { if (c) send(peerId, hostMigratedMessage(-1, false)); })
          .catch(() => {});
      }, delay);
    }
  }

  function showHostLobbyControls() {
    const btn = document.getElementById('start-game-btn');
    if (btn) { btn.style.display = 'block'; btn.onclick = () => startGame(); }
    const code = document.getElementById('room-code-display');
    const section = document.getElementById('room-code-section');
    if (code) code.textContent = roomCode;
    if (section) section.style.display = 'flex';
  }

  function handleHandSync(fromPeer, msg) {
    if (!handSync) return;
    const seat = peerToSeat.get(fromPeer);
    if (seat === undefined || seat === mySeat) return;
    if (!(seat in handSync.hands)) handSync.hands[seat] = Array.isArray(msg.hand) ? msg.hand : [];
    handSync.waiting.delete(seat);
    if (handSync.waiting.size === 0) finishHandSync();
  }

  function finishHandSync() {
    if (!handSync) return;
    const hs = handSync;
    handSync = null;
    clearTimeout(hs.timer);

    // Humans that never reached us become bots (they can rejoin later)
    for (let s = 0; s < 6; s++) {
      const p = state.players[s];
      if (s === mySeat || !p || p.isAI || !p.peerId) continue;
      if (!Network.isConnectedTo(p.peerId)) {
        peerToSeat.delete(p.peerId);
        seatToPeer.delete(s);
        markSeatBot(s);
        p.migrationDrop = true;
        p.leftAt = Date.now();
      }
    }

    const result = reconstructHands(hs.hands);
    if (!result.ok) {
      console.warn('[Host] Could not reconstruct hands after migration — re-dealing round');
      UI.showToast('Re-dealing this round after the host change');
      resumeHostAuthority({ redeal: true });
      return;
    }
    for (const seat of result.changedSeats) {
      const pid = seatToPeer.get(seat);
      if (pid && pid !== myPeerId) send(pid, { type: 'DEAL_HAND', hand: state.hands[seat] });
    }
    broadcastPeerList();
    resumeHostAuthority();
    for (const [p, m] of hs.buffer) onNetMessage(p, m);
  }

  // Rebuild every hand from my own hand + hands reported by clients + the
  // unseen remainder of the deck (see Engine.recoverHands). Unknown seats —
  // the departed host and bots — get a legal random deal of the remainder.
  function reconstructHands(synced) {
    const r = state.currentRound;
    if (!r) return { ok: false };
    const known = Object.assign({}, synced || {});
    known[mySeat] = state.hands[mySeat] || [];
    const res = Engine.recoverHands(r, known);
    if (!res.ok) return { ok: false };
    state.hands = res.hands;

    // Bots think with memory of the tricks played so far
    resetAiMemory();
    for (const t of r.tricks || []) updateAiMemoryFromTrick(t.cards, r.trumpSuit);

    // Anyone whose authoritative hand differs from what they reported must be told
    const ids = (arr) => (arr || []).map(c => c && c.id).sort().join(',');
    const changedSeats = [];
    for (let s = 0; s < 6; s++) {
      if (s === mySeat) continue;
      if (!synced || !synced[s] || ids(synced[s]) !== ids(res.hands[s])) changedSeats.push(s);
    }
    return { ok: true, changedSeats };
  }

  // Pick the game back up from wherever the previous host left it
  function resumeHostAuthority(opts = {}) {
    if (!state || !Network.getIsHost()) return;
    const r = state.currentRound;
    if (opts.redeal) {
      startNewRound();
      return;
    }
    switch (state.phase) {
      case 'WAITING':
        broadcastState();
        UI.updateLobby(state, mySeat);
        return;
      case 'SHUFFLING':
        startNewRound();
        return;
      case 'ROUND_END':
        broadcastState();
        scheduleNextRound(d(3000));
        return;
      case 'GAME_OVER':
        broadcastState();
        return;
      case 'RAISE_CHECK': {
        broadcastState();
        UI.updateAll(state, mySeat);
        const remaining = (r.raiseDeadline || 0) - Date.now();
        clearRaiseTimer();
        raiseTimer = setTimeout(() => processNoRaise(), Math.max(d(1500), remaining));
        return;
      }
      case 'PLAYING': {
        const last = r.tricks[r.tricks.length - 1];
        if (r.currentTrick.length === 6 && last && last.cards[0].card.id === r.currentTrick[0].card.id) {
          broadcastState();
          UI.updateAll(state, mySeat);
          advanceAfterTrick(last.winner);
          return;
        }
        break;
      }
    }
    broadcastState();
    UI.updateAll(state, mySeat);
    checkAITurn();
  }

  function scheduleNextRound(delay) {
    const token = ++roundToken;
    setTimeout(() => {
      if (token !== roundToken || !state || state.phase !== 'ROUND_END') return;
      if (!isSoloMode && !Network.getIsHost()) return;
      startNewRound();
    }, delay);
  }

  // Client: new host announced itself
  function handleHostMigrated(fromPeer, msg) {
    if (!msg || !msg.hostPeerId) return;
    const t = typeof msg._t === 'number' ? msg._t : 0;
    if (t < hostTerm) return;
    if (t === hostTerm && currentHostPeerId && currentHostPeerId !== msg.hostPeerId && !migrationInProgress) {
      // Same-term rival: keep the lower seat
      const curSeat = seatOfPeer(currentHostPeerId);
      if (curSeat >= 0 && typeof msg.hostSeat === 'number' && msg.hostSeat > curSeat) return;
    }
    console.log('[Client] Host migrated to', msg.hostPeerId, 'seat', msg.hostSeat, 'term', t);
    hostTerm = t;
    currentHostPeerId = msg.hostPeerId;
    endMigrationWait();

    // A play we sent to the dead host never landed — take the card back so
    // the hand we report is the true one.
    if (pendingPlay && msg.state && msg.state.currentRound) {
      const inTrick = (msg.state.currentRound.currentTrick || []).some(e => e.card.id === pendingPlay.cardId) ||
        (msg.state.currentRound.tricks || []).some(tr => tr.cards.some(e => e.card.id === pendingPlay.cardId));
      if (!inTrick && state && state.hands[mySeat] && !state.hands[mySeat].some(c => c.id === pendingPlay.cardId)) {
        state.hands[mySeat].push(pendingPlay.card);
      }
      pendingPlay = null;
    }
    applyState(msg.state, { force: true, term: t });
    if (msg.seatToPeer) {
      seatToPeer.clear();
      for (const [seat, peerId] of Object.entries(msg.seatToPeer)) seatToPeer.set(Number(seat), peerId);
    }
    if (msg.needHands) send(fromPeer, { type: 'HAND_SYNC', hand: state.hands[mySeat] || [] });
    saveSession(true);
    UI.showToast('Host changed — game continues');
    renderForPhase();
  }

  // HOST message handling
  function handleHostMessage(fromPeer, msg) {
    switch (msg.type) {
      case 'JOIN_REQUEST': handleJoinRequest(fromPeer, msg); break;
      case 'REJOIN_REQUEST': handleRejoinRequest(fromPeer, msg); break;
      case 'STATE_REQUEST': sendSync(fromPeer); break;
      case 'HAND_SYNC': handleHandSync(fromPeer, msg); break;
      case 'BID': handleBid(fromPeer, msg); break;
      case 'TRUMP_SELECT': handleTrumpSelect(fromPeer, msg); break;
      case 'PLAY_CARD': handlePlayCard(fromPeer, msg); break;
      case 'RAISE_BID': handleRaiseBid(fromPeer, msg); break;
      case 'RAISE_COMMIT': handleRaiseCommit(fromPeer, msg); break;
      case 'EXTEND_TIMER': handleExtendTimer(fromPeer, msg); break;
      case 'NO_RAISE': handleNoRaise(fromPeer); break;
      case 'CHAT':
        if (!peerToSeat.has(fromPeer)) return;
        UI.addChatMessage(msg.name, msg.text);
        bcast({ type: 'CHAT', name: msg.name, text: msg.text }); // relay
        break;
      case 'EMOJI_REACTION':
        if (!peerToSeat.has(fromPeer)) return;
        UI.showEmojiReaction(msg.emoji);
        bcast({ type: 'EMOJI_REACTION', emoji: msg.emoji }); // relay
        break;
    }
  }

  // CLIENT message handling
  function handleClientMessage(fromPeer, msg) {
    switch (msg.type) {
      case 'SEAT_ASSIGNED': {
        if (msg.protocol !== PROTOCOL_VERSION) {
          UI.showToast('The host is on an older version — ask them to refresh the page');
          setTimeout(() => { cleanup(); UI.showScreen('title-screen'); }, 2500);
          break;
        }
        const first = mySeat !== msg.seat || !state;
        adoptHostSnapshot(fromPeer, msg);
        if (first) UI.showToast(`Seated at position ${msg.seat + 1} (Team ${Engine.getTeam(msg.seat)})`);
        break;
      }
      case 'SYNC':
        adoptHostSnapshot(fromPeer, msg);
        break;
      case 'STATE_UPDATE':
        if (applyState(msg.state, { term: typeof msg._t === 'number' ? msg._t : hostTerm })) {
          saveSession();
          renderForPhase();
        }
        break;
      case 'DEAL':
        playedCardSeq.clear();
        pendingPlay = null;
        applyState(msg.state, { force: true, hand: msg.hand, term: typeof msg._t === 'number' ? msg._t : hostTerm });
        UI.updateAll(state, mySeat);
        UI.showToast('Cards dealt!');
        break;
      case 'DEAL_HAND':
        if (!state) break;
        pendingPlay = null;
        state.hands[mySeat] = Array.isArray(msg.hand) ? msg.hand : [];
        UI.updateAll(state, mySeat);
        break;
      case 'PLAY_REJECTED':
        if (!state) break;
        pendingPlay = null;
        if (msg.state) applyState(msg.state, { force: true, hand: msg.hand });
        else if (Array.isArray(msg.hand)) state.hands[mySeat] = msg.hand;
        UI.updateAll(state, mySeat);
        UI.showToast('That play did not go through — your hand is restored');
        break;
      case 'CARD_PLAYED':
        handleCardPlayed(null, msg);
        break;
      case 'PEER_LIST':
        for (const pid of msg.peers || []) {
          if (pid !== myPeerId && !Network.isConnectedTo(pid)) Network.connectToPeer(pid).catch(() => {});
        }
        saveSession();
        break;
      case 'TRICK_RESULT':
        UI.animateTrickWin(msg.winner, msg.trickCards);
        break;
      case 'ROUND_RESULT':
        UI.showRoundResult(msg);
        break;
      case 'GAME_OVER':
        clearSession();
        UI.showGameOver(msg.winner, msg.scores);
        break;
      case 'RAISE_PROMPT':
        if (state && Engine.getTeam(mySeat) === state.currentRound.biddingTeam) UI.showRaisePrompt(state);
        break;
      case 'REJOIN_REJECTED':
        onRejoinRejected(msg);
        break;
      case 'STALE_TERM':
        if (typeof msg.term === 'number' && msg.term > hostTerm) {
          hostTerm = msg.term;
          reconnectToGame('stale-term', { preferHost: msg.hostPeerId || null });
        }
        break;
      case 'ERROR':
        UI.showToast(msg.message || 'An error occurred');
        clearSession();
        UI.showScreen('title-screen');
        cleanup();
        break;
      case 'PLAYER_LEFT':
        if (msg.seat >= 0) UI.showToast(`${msg.name} disconnected — Bot taking over`);
        break;
      case 'PLAYER_REJOINED':
        UI.showToast(`${msg.name} reconnected!`);
        break;
      case 'HOST_CLOSED':
        clearSession();
        UI.showToast('Host closed the game');
        setTimeout(() => { UI.showScreen('title-screen'); cleanup(); }, 2000);
        break;
      case 'KICKED':
        clearSession();
        UI.showToast(msg.reason || 'You were removed by the host');
        setTimeout(() => { UI.showScreen('title-screen'); cleanup(); }, 2500);
        break;
      case 'HOST_MIGRATED':
        handleHostMigrated(fromPeer, msg);
        break;
      case 'CHAT':
        UI.addChatMessage(msg.name, msg.text);
        break;
      case 'EMOJI_REACTION':
        UI.showEmojiReaction(msg.emoji);
        break;
    }
  }

  function handleJoinRequest(fromPeer, msg) {
    console.log('[Host] Join request from:', msg.name, 'peerId:', fromPeer);

    // Same peer already seated → resend its snapshot
    const existingSeat = peerToSeat.get(fromPeer);
    if (existingSeat !== undefined) {
      send(fromPeer, {
        type: 'SEAT_ASSIGNED', seat: existingSeat, state: sanitizeStateForClient(state),
        hand: state.hands[existingSeat] || [], seatToPeer: seatToPeerObject(),
        hostPeerId: myPeerId, hostTerm, protocol: PROTOCOL_VERSION,
      });
      return;
    }

    // Known playerId → must prove ownership via REJOIN (secret), never by claim
    if (state.players.some(p => p && p.id === msg.playerId)) {
      send(fromPeer, { type: 'ERROR', message: 'That player is already in this game' });
      return;
    }

    if (state.phase !== 'WAITING') {
      send(fromPeer, { type: 'ERROR', message: 'This game has already started' });
      return;
    }

    for (let i = 0; i < 6; i++) {
      const p = state.players[i];
      if (p && !p.isAI && p.connected && p.name === msg.name) {
        send(fromPeer, { type: 'ERROR', message: 'A player with that name is already in the game' });
        return;
      }
    }

    let seat = -1;
    for (let i = 0; i < 6; i++) if (!state.players[i]) { seat = i; break; }
    if (seat === -1) {
      send(fromPeer, { type: 'ERROR', message: 'Game is full' });
      return;
    }
    if (msg.protocol !== PROTOCOL_VERSION || typeof msg.tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(msg.tokenHash)) {
      send(fromPeer, { type: 'ERROR', message: 'Your app is out of date — refresh the page and join again' });
      return;
    }

    console.log('[Host] Assigning seat', seat, 'to', msg.name);
    state.players[seat] = {
      id: msg.playerId, name: String(msg.name || 'Player').slice(0, 20), seat,
      peerId: fromPeer, connected: true, tokenHash: msg.tokenHash,
    };
    peerToSeat.set(fromPeer, seat);
    seatToPeer.set(seat, fromPeer);

    send(fromPeer, {
      type: 'SEAT_ASSIGNED', seat, state: sanitizeStateForClient(state), hand: [],
      seatToPeer: seatToPeerObject(), hostPeerId: myPeerId, hostTerm, protocol: PROTOCOL_VERSION,
    });
    broadcastPeerList();
    broadcastState();
    saveSession(true);
    UI.updateLobby(state, mySeat);
    UI.showToast(`${msg.name} joined (Seat ${seat + 1}, Team ${Engine.getTeam(seat)})`);

    if (state.players.filter(Boolean).length === 6) {
      UI.showToast('All 6 players joined! Starting game...');
      setTimeout(() => startGame(), d(2000));
    }
  }

  // Player proving seat ownership after refresh / network loss / migration
  async function handleRejoinRequest(fromPeer, msg) {
    const seat = state.players.findIndex(p => p && p.id === msg.playerId);
    if (seat === -1) {
      if (state.phase === 'WAITING' && typeof msg.secret === 'string') {
        // Seat was freed while they were away — seat them again as new
        const tokenHash = await GameCrypto.sha256Hex(msg.secret);
        if (!state || !Network.getIsHost()) return;
        handleJoinRequest(fromPeer, { ...msg, tokenHash });
        return;
      }
      send(fromPeer, { type: 'REJOIN_REJECTED', playerId: msg.playerId, reason: 'Your seat is no longer in this game' });
      return;
    }
    const player = state.players[seat];
    let verified = false;
    try {
      verified = typeof msg.secret === 'string' && !!player.tokenHash &&
        (await GameCrypto.sha256Hex(msg.secret)) === player.tokenHash;
    } catch (_) { verified = false; }
    if (!state || !Network.getIsHost()) return; // things changed during the await
    if (!verified) {
      console.warn('[Host] Rejoin rejected: bad secret for seat', seat, 'from', fromPeer);
      send(fromPeer, { type: 'REJOIN_REJECTED', playerId: msg.playerId, reason: 'Could not verify your seat' });
      return;
    }
    if (player.kicked) {
      send(fromPeer, { type: 'REJOIN_REJECTED', playerId: msg.playerId, reason: 'You were removed by the host' });
      return;
    }
    if (seat === mySeat) {
      send(fromPeer, { type: 'REJOIN_REJECTED', playerId: msg.playerId, reason: 'Seat is in use by the host', retry: false });
      return;
    }

    // Retire any older connection still holding this seat
    const oldPeer = player.peerId;
    if (oldPeer && oldPeer !== fromPeer) {
      peerToSeat.delete(oldPeer);
      if (Network.isConnectedTo(oldPeer)) Network.dropPeer(oldPeer);
    }
    const wasBot = player.isAI;
    restoreHumanSeat(seat, fromPeer);
    console.log('[Host] Restored', player.name, 'to seat', seat);

    // Current hand (the bot may have played cards meanwhile)
    send(fromPeer, {
      type: 'SEAT_ASSIGNED', seat, state: sanitizeStateForClient(state),
      hand: state.hands[seat] || [], seatToPeer: seatToPeerObject(),
      hostPeerId: myPeerId, hostTerm, protocol: PROTOCOL_VERSION,
    });
    if (wasBot) {
      bcast({ type: 'PLAYER_REJOINED', seat, name: player.name });
      UI.showToast(`${player.name} reconnected to Seat ${seat + 1}!`);
    }
    broadcastPeerList();
    broadcastState();
    if (state.phase === 'WAITING') UI.updateLobby(state, mySeat);
    else UI.updateAll(state, mySeat);
    // Cancel any bot move queued for this seat and start their turn timer
    if (isTurnOf(seat)) checkAITurn();
  }

  // Turn timeout — auto-play for AFK players
  function startTurnTimer() {
    clearTurnTimer();
    if (!Network.getIsHost() && !isSoloMode) return;
    if (!state || !state.currentRound) return;
    state.currentRound.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
    const seatAtStart = state.currentRound.currentPlayer;
    const phaseAtStart = state.phase;
    turnTimer = setTimeout(() => {
      turnTimer = null;
      if (!state || !state.currentRound || !Network.getIsHost()) return;
      const seat = state.currentRound.currentPlayer;
      if (seat !== seatAtStart || state.phase !== phaseAtStart) return; // turn already moved on
      const player = state.players[seat];
      if (!player || player.isAI || seat === mySeat) return;

      console.log(`[Host] Turn timeout for "${player.name}" (seat ${seat}) — auto-playing`);
      UI.showToast(`${player.name} took too long — auto-playing`);
      if (state.phase === 'BIDDING') aiMakeBid(seat);
      else if (state.phase === 'TRUMP_SELECT') aiSelectTrump(seat);
      else if (state.phase === 'PLAYING') aiPlayCard(seat);
    }, TURN_TIMEOUT_MS);
  }

  function clearTurnTimer() {
    if (turnTimer) { clearTimeout(turnTimer); turnTimer = null; }
  }

  function startRaiseTimer() {
    clearRaiseTimer();
    const timerDuration = state.currentRound.raiseTimer || 20;
    // Deadline in epoch ms — every client renders a live countdown from it
    state.currentRound.raiseDeadline = Date.now() + timerDuration * 1000;
    raiseTimer = setTimeout(() => {
      console.log('[Host] Raise timer expired - automatically no raise');
      processNoRaise();
    }, timerDuration * 1000);
  }

  function clearRaiseTimer() {
    if (raiseTimer) { clearTimeout(raiseTimer); raiseTimer = null; }
  }

  function cleanup() {
    clearTurnTimer();
    clearRaiseTimer();
    stopAuthorityWatch();
    aiTurnToken++;
    roundToken++;
    if (migrationTimer) { clearTimeout(migrationTimer); migrationTimer = null; }
    if (handSync) { clearTimeout(handSync.timer); handSync = null; }
    Network.stopHeartbeat();
    Network.destroy();
    state = null;
    mySeat = -1;
    myPlayerId = null;
    myPeerId = null;
    mySecret = null;
    myTokenHash = null;
    roomCode = '';
    hostTerm = 0;
    peerToSeat.clear();
    seatToPeer.clear();
    disconnectedPlayers.clear();
    isSoloMode = false;
    currentHostPeerId = null;
    migrationInProgress = false;
    savedKnownPeers = [];
    dealing = false;
    rejoinWaiter = null;
    resetSyncCounters();
    bannerReasons.clear();
    setBanner('none', null);
    if (networkWired) {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('online', handleOnline);
      networkWired = false;
    }
  }

  // Start the game (host only)
  function startGame() {
    if (!Network.getIsHost()) return;
    const playerCount = state.players.filter(Boolean).length;
    if (playerCount < 2) { // Allow 2+ for testing, 6 for real
      UI.showToast('Need at least 2 players to start');
      return;
    }

    // Fill empty seats with AI placeholders
    for (let i = 0; i < 6; i++) {
      if (!state.players[i]) {
        state.players[i] = {
          id: 'AI_' + i,
          name: `Bot ${i + 1}`,
          seat: i,
          peerId: null,
          connected: true,
          isAI: true,
        };
      }
    }

    // Init badges for multiplayer
    Badges.reset();
    UI.updatePointsDisplay();
    UI.renderBadgesGrid();

    // Brief delay to ensure all outbound connections are ready
    UI.showToast('Starting game...');
    setTimeout(() => startNewRound(), d(1500));
  }

  async function startNewRound() {
    if (dealing || !state) return; // never deal twice concurrently
    if (!isSoloMode && !Network.getIsHost()) return;
    dealing = true;
    roundToken++;
    clearTurnTimer();
    clearRaiseTimer();
    aiTurnToken++;
    try {
      resetAiMemory();
      state.phase = 'SHUFFLING';
      UI.updateAll(state, mySeat);
      if (SPEED === 1) await UI.showShuffleAnimation();
      else await sleep(d(1000));
    } finally {
      dealing = false;
    }
    // We may have stepped down / left while the animation ran
    if (!state || (!isSoloMode && !Network.getIsHost())) return;

    // Create and shuffle deck
    const deck = Engine.createDeck();
    const shuffled = GameCrypto.secureShuffleDeck(deck);
    const hands = Engine.dealCards(shuffled);

    state.phase = 'BIDDING';
    state.currentRound = {
      bid: 0,
      bidder: -1,
      biddingTeam: null,
      trumpSuit: null,
      currentBidder: (state.dealer + 1) % 6,
      bids: [],
      passCount: 0,
      passedPlayers: new Set(), // Track which players have passed
      tricks: [],
      currentTrick: [],
      tricksTaken: { A: 0, B: 0 },
      trickLeader: -1,
      currentPlayer: (state.dealer + 1) % 6,
      tricksPlayed: 0,
      raised: false,
      raiseCommitments: {}, // seat -> number of additional tricks they can win
      raiseTimer: null,
    };
    state.hands = hands;

    // Deal privately: each human receives ONLY their own hand. (Everyone
    // shares the room key, so broadcasting all hands would let any player
    // read everyone's cards from the wire.)
    if (!isSoloMode) {
      playedCardSeq.clear();
      state.version = (state.version || 0) + 1;
      const clean = sanitizeStateForClient(state);
      for (let s = 0; s < 6; s++) {
        const p = state.players[s];
        if (!p || p.isAI || s === mySeat) continue;
        const pid = seatToPeer.get(s);
        if (pid) send(pid, { type: 'DEAL', state: clean, hand: hands[s] });
      }
      saveSession(true);
    }

    UI.updateAll(state, mySeat);
    checkAITurn();
  }

  function handleBid(fromPeer, msg) {
    const seat = peerToSeat.get(fromPeer);
    if (seat === undefined) return;
    if (state.phase !== 'BIDDING' || seat !== state.currentRound.currentBidder) { sendSync(fromPeer); return; }
    processBid(seat, msg.bid);
  }

  function makeBid(bid) {
    if (!state || state.phase !== 'BIDDING' || mySeat !== state.currentRound.currentBidder) return;
    if (isSoloMode || Network.getIsHost()) {
      processBid(mySeat, bid);
    } else {
      sendToHost({ type: 'BID', bid });
    }
  }

  function processBid(seat, bid) {
    if (!Engine.isValidBid(bid, state.currentRound.bid, state.phase, state)) {
      // Force pass if invalid
      processBid(seat, 0);
      return;
    }

    state.currentRound.bids.push({ seat, bid });

    if (bid > 0) {
      state.currentRound.bid = bid;
      state.currentRound.bidder = seat;
      state.currentRound.biddingTeam = Engine.getTeam(seat);
      // Remove this player from passed set (they outbid)
      state.currentRound.passedPlayers.delete(seat);
    } else {
      // Player passed — mark them
      state.currentRound.passedPlayers.add(seat);
      state.currentRound.passCount = state.currentRound.passedPlayers.size;
    }

    // Check if bidding is over: 5 players passed and someone has a bid
    if (state.currentRound.passedPlayers.size >= 5 && state.currentRound.bid > 0) {
      // Everyone else passed, bidder wins
      state.phase = 'TRUMP_SELECT';
      state.currentRound.currentPlayer = state.currentRound.bidder;
      broadcastState();
      UI.updateAll(state, mySeat);
      checkAITurn();
      return;
    }

    // All 6 passed with no bid — re-deal
    if (state.currentRound.passedPlayers.size >= 6 && state.currentRound.bid === 0) {
      state.dealer = (state.dealer + 1) % 6;
      UI.showToast('No bids \u2014 re-dealing...');
      setTimeout(() => startNewRound(), d(2000));
      return;
    }

    if (state.currentRound.bid === 9) {
      // Max bid — go straight to trump selection
      state.phase = 'TRUMP_SELECT';
      state.currentRound.currentPlayer = state.currentRound.bidder;
      broadcastState();
      UI.updateAll(state, mySeat);
      checkAITurn();
      return;
    }

    // Find next eligible bidder (skip those who have passed)
    let nextBidder = (seat + 1) % 6;
    let attempts = 0;
    while (attempts < 6) {
      if (!state.currentRound.passedPlayers.has(nextBidder)) {
        break; // This player hasn't passed, they can bid
      }
      nextBidder = (nextBidder + 1) % 6;
      attempts++;
    }

    // If we looped all the way around and everyone has passed except the current bidder
    if (attempts >= 6 || (state.currentRound.passedPlayers.size >= 5 && state.currentRound.bid > 0)) {
      state.phase = 'TRUMP_SELECT';
      state.currentRound.currentPlayer = state.currentRound.bidder;
      broadcastState();
      UI.updateAll(state, mySeat);
      checkAITurn();
      return;
    }

    state.currentRound.currentBidder = nextBidder;
    state.currentRound.currentPlayer = nextBidder;
    broadcastState();
    UI.updateAll(state, mySeat);
    checkAITurn();
  }

  function handleTrumpSelect(fromPeer, msg) {
    const seat = peerToSeat.get(fromPeer);
    if (seat === undefined) return;
    if (state.phase !== 'TRUMP_SELECT' || seat !== state.currentRound.bidder) { sendSync(fromPeer); return; }
    processTrumpSelect(msg.suit);
  }

  function selectTrump(suit) {
    if (!state || state.phase !== 'TRUMP_SELECT' || mySeat !== state.currentRound.bidder) return;
    if (isSoloMode || Network.getIsHost()) {
      processTrumpSelect(suit);
    } else {
      sendToHost({ type: 'TRUMP_SELECT', suit });
    }
  }

  function processTrumpSelect(suit) {
    if (!['spades', 'hearts', 'diamonds', 'clubs'].includes(suit)) suit = 'spades';
    state.currentRound.trumpSuit = suit;
    state.phase = 'PLAYING';
    state.currentRound.trickLeader = state.currentRound.bidder;
    state.currentRound.currentPlayer = state.currentRound.bidder;
    state.currentRound.currentTrick = [];

    // Track trump calls for badges
    if (Engine.getTeam(state.currentRound.bidder) === Engine.getTeam(mySeat)) {
      Badges.recordTrumpCall();
      UI.updatePointsDisplay();
    }

    broadcastState();
    UI.updateAll(state, mySeat);
    UI.showToast(`Trump is ${suit.toUpperCase()}!`);
    checkAITurn();
  }

  function handlePlayCard(fromPeer, msg) {
    const seat = peerToSeat.get(fromPeer);
    if (seat === undefined) return;
    const ok = state.phase === 'PLAYING' && seat === state.currentRound.currentPlayer &&
      processPlayCard(seat, msg.cardId);
    if (!ok) {
      // Authoritative correction so the client can undo its optimistic play
      send(fromPeer, {
        type: 'PLAY_REJECTED', cardId: msg.cardId,
        hand: state.hands[seat] || [], state: sanitizeStateForClient(state),
      });
    }
  }

  function currentLead() {
    const trick = state.currentRound.currentTrick;
    const isLeading = trick.length === 0;
    const leadSuit = !isLeading ? (trick[0].card.suit === 'joker' ? null : trick[0].card.suit) : null;
    return { isLeading, leadSuit };
  }

  function playCard(cardId) {
    if (!state || state.phase !== 'PLAYING' || mySeat !== state.currentRound.currentPlayer) return;
    if ((state.currentRound.currentTrick || []).length >= 6) return; // trick still being cleared
    if (isSoloMode || Network.getIsHost()) {
      processPlayCard(mySeat, cardId);
      return;
    }
    if (pendingPlay && Date.now() - pendingPlay.at < 8000) return; // one play in flight
    const hand = state.hands[mySeat] || [];
    const cardIdx = hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return;
    const { isLeading, leadSuit } = currentLead();
    if (!Engine.getPlayableCards(hand, leadSuit, isLeading).some(c => c.id === cardId)) {
      UI.showToast('You must follow suit');
      return;
    }
    const h = getHostPeerId();
    if (!h || !Network.isConnectedTo(h) || migrationInProgress || reconnecting) {
      UI.showToast('Reconnecting to the host — try again in a moment');
      if (!migrationInProgress) reconnectToGame('play-offline');
      return;
    }
    // Optimistic: remove now, host confirms via CARD_PLAYED or rejects
    const [card] = hand.splice(cardIdx, 1);
    pendingPlay = { cardId, card, at: Date.now() };
    UI.updateAll(state, mySeat);
    send(h, { type: 'PLAY_CARD', cardId });
  }

  // Returns true if the play was accepted
  function processPlayCard(seat, cardId) {
    // Single choke point for every play (local, remote, AI, turn timeout):
    // it must be this seat's turn, and a finished trick that is still on the
    // table (the pause before it clears) accepts no more cards. Without the
    // second check the player who completed the trick could play again during
    // the pause — the trick then grows past 6 and never resolves.
    if (!state || state.phase !== 'PLAYING' || !state.currentRound) return false;
    if (seat !== state.currentRound.currentPlayer) return false;
    if (state.currentRound.currentTrick.length >= 6) return false;
    const hand = state.hands[seat];
    if (!hand) return false;
    const cardIdx = hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return false;

    const card = hand[cardIdx];
    const isLeading = state.currentRound.currentTrick.length === 0;
    const leadSuit = !isLeading
      ? (state.currentRound.currentTrick[0].card.suit === 'joker' ? null : state.currentRound.currentTrick[0].card.suit)
      : null;

    // Validate play
    const playable = Engine.getPlayableCards(hand, leadSuit, isLeading);
    if (!playable.find(c => c.id === cardId)) return false;

    // Remove card from hand
    hand.splice(cardIdx, 1);

    // Broadcast card played to all clients (simpler than HAND_UPDATE)
    if (!isSoloMode) {
      cardPlaySeqCounter++;
      bcast({ type: 'CARD_PLAYED', seat, cardId, seq: cardPlaySeqCounter });
    }

    // Add to current trick
    state.currentRound.currentTrick.push({ playerIndex: seat, card });

    if (state.currentRound.currentTrick.length === 6) {
      // Trick complete — determine winner
      const winner = Engine.determineTrickWinnerRefined(
        state.currentRound.currentTrick,
        state.currentRound.trumpSuit
      );
      const winnerTeam = Engine.getTeam(winner);
      state.currentRound.tricksTaken[winnerTeam]++;
      state.currentRound.tricksPlayed++;

      const trickCards = [...state.currentRound.currentTrick];
      // Update AI memory from this completed trick
      updateAiMemoryFromTrick(trickCards, state.currentRound.trumpSuit);
      state.currentRound.tricks.push({
        cards: trickCards,
        winner,
        winnerTeam,
      });

      // Track trick for badges
      Badges.recordTrickWin(Engine.getTeam(mySeat), winnerTeam);
      UI.updatePointsDisplay();

      // Broadcast trick result
      if (!isSoloMode) bcast({ type: 'TRICK_RESULT', winner, trickCards });

      // Show trick result briefly, then clear
      broadcastState();
      UI.updateAll(state, mySeat);
      UI.showToast(`${state.players[winner].name} wins the trick!`);

      // Trigger trick win celebration
      const winnerRelIdx = ((winner - mySeat + 6) % 6);
      if (typeof UI.triggerTrickWinFX === 'function') {
        UI.triggerTrickWinFX(winnerRelIdx, winnerTeam);
      }

      // Pause so players can see the finished trick, then move on
      const termAtTrick = hostTerm;
      setTimeout(() => {
        if (!state || (!isSoloMode && (!Network.getIsHost() || hostTerm !== termAtTrick))) return;
        advanceAfterTrick(winner);
      }, d(1200));
      return true;
    }

    // Next player in the trick
    state.currentRound.currentPlayer = (seat + 1) % 6;
    broadcastState();
    UI.updateAll(state, mySeat);
    checkAITurn();
    return true;
  }

  // After a completed trick: raise check, round end, or next trick.
  // Separate function so a newly promoted host can run it if the old host
  // died during the post-trick pause.
  function advanceAfterTrick(winner) {
        if (state.phase !== 'PLAYING' || state.currentRound.currentTrick.length !== 6) return;
        // Check for raise opportunity after 5 tricks
        if (state.currentRound.tricksPlayed === 5 && !state.currentRound.raised) {
          const biddingTeam = state.currentRound.biddingTeam;
          const biddingTricks = state.currentRound.tricksTaken[biddingTeam];
          if (biddingTricks >= state.currentRound.bid) {
            // Bidding team is winning — offer raise
            state.phase = 'RAISE_CHECK';
            state.currentRound.currentTrick = [];
            state.currentRound.raiseCommitments = {};
            state.currentRound.raiseTimer = 20; // 20 seconds
            broadcastState();
            if (!isSoloMode) bcast({ type: 'RAISE_PROMPT' });
            UI.updateAll(state, mySeat);
            if (Engine.getTeam(mySeat) === biddingTeam) {
              UI.showRaisePrompt(state);
            } else if (isSoloMode) {
              // AI teammates suggest their capability
              setTimeout(() => aiSuggestRaiseCommitment(), d(1000));
            }
            // Start the countdown timer
            if (Network.getIsHost() || isSoloMode) {
              startRaiseTimer();
            }
            return;
          }
        }

        if (state.currentRound.tricksPlayed === 9) {
          // Round over
          state.currentRound.currentTrick = [];
          endRound();
          return;
        }

        // Next trick
        state.currentRound.currentTrick = [];
        state.currentRound.trickLeader = winner;
        state.currentRound.currentPlayer = winner;
        broadcastState();
        UI.updateAll(state, mySeat);
        checkAITurn();
  }

  function handleRaiseBid(fromPeer, msg) {
    const seat = peerToSeat.get(fromPeer);
    if (seat === undefined || state.phase !== 'RAISE_CHECK') return;
    if (Engine.getTeam(seat) !== state.currentRound.biddingTeam) return;
    // Only bidder can confirm final raise
    if (seat !== state.currentRound.bidder) return;
    processRaise(msg.newBid);
  }

  function handleRaiseCommit(fromPeer, msg) {
    const seat = peerToSeat.get(fromPeer);
    if (seat === undefined || state.phase !== 'RAISE_CHECK') return;
    if (Engine.getTeam(seat) !== state.currentRound.biddingTeam) return;
    state.currentRound.raiseCommitments[seat] = Math.max(0, Math.min(4, Number(msg.tricks) || 0));
    broadcastState();
    UI.updateAll(state, mySeat);
  }

  function handleExtendTimer(fromPeer, msg) {
    const seat = peerToSeat.get(fromPeer);
    if (seat === undefined || state.phase !== 'RAISE_CHECK') return;
    if (Engine.getTeam(seat) !== state.currentRound.biddingTeam) return;
    state.currentRound.raiseTimer += 10;
    state.currentRound.raiseDeadline = (state.currentRound.raiseDeadline || Date.now()) + 10000;
    // Restart the host-side timeout to match the new deadline
    if (raiseTimer) {
      clearTimeout(raiseTimer);
      raiseTimer = setTimeout(() => {
        console.log('[Host] Raise timer expired - automatically no raise');
        processNoRaise();
      }, Math.max(0, state.currentRound.raiseDeadline - Date.now()));
    }
    broadcastState();
    UI.updateAll(state, mySeat);
  }

  function handleCardPlayed(fromPeer, msg) {
    // Host already processed this, so this is only for other clients
    if (Network.getIsHost()) return;
    // Dedupe on (seat, cardId, seq)
    const key = `${msg.seat}:${msg.cardId}:${msg.seq || 0}`;
    if (playedCardSeq.has(key)) {
      console.log('[Client] Duplicate CARD_PLAYED ignored:', key);
      return;
    }
    playedCardSeq.add(key);
    if (!state) return;
    if (msg.seat === mySeat) {
      if (pendingPlay && pendingPlay.cardId === msg.cardId) pendingPlay = null;
      const hand = state.hands[mySeat] || [];
      const cardIdx = hand.findIndex(c => c.id === msg.cardId);
      if (cardIdx !== -1) hand.splice(cardIdx, 1); // e.g. auto-played on timeout
    }
    if (Array.isArray(state.handCounts) && state.handCounts[msg.seat] > 0) state.handCounts[msg.seat]--;
    UI.updateAll(state, mySeat);
  }

  function commitRaiseTricks(tricks) {
    if (isSoloMode || Network.getIsHost()) {
      state.currentRound.raiseCommitments[mySeat] = tricks;
      broadcastState();
      UI.updateAll(state, mySeat);
    } else {
      sendToHost({ type: 'RAISE_COMMIT', tricks });
    }
  }

  function extendRaiseTimer() {
    if (isSoloMode || Network.getIsHost()) {
      state.currentRound.raiseTimer += 10;
      state.currentRound.raiseDeadline = (state.currentRound.raiseDeadline || Date.now()) + 10000;
      if (raiseTimer) {
        clearTimeout(raiseTimer);
        raiseTimer = setTimeout(() => {
          processNoRaise();
        }, Math.max(0, state.currentRound.raiseDeadline - Date.now()));
      }
      broadcastState();
      UI.updateAll(state, mySeat);
    } else {
      sendToHost({ type: 'EXTEND_TIMER' });
    }
  }

  function raiseBid(newBid) {
    if (isSoloMode || Network.getIsHost()) {
      processRaise(newBid);
    } else {
      sendToHost({ type: 'RAISE_BID', newBid });
    }
  }

  function noRaise() {
    if (isSoloMode || Network.getIsHost()) {
      processNoRaise();
    } else {
      sendToHost({ type: 'NO_RAISE' });
    }
  }

  function handleNoRaise(fromPeer) {
    const seat = peerToSeat.get(fromPeer);
    if (seat === undefined || state.phase !== 'RAISE_CHECK') return;
    if (Engine.getTeam(seat) !== state.currentRound.biddingTeam) return;
    processNoRaise();
  }

  function processNoRaise() {
    clearRaiseTimer();
    if (!state || state.phase !== 'RAISE_CHECK') return; // already resolved
    UI.showToast('Bid not raised');
    resumeAfterRaise();
  }

  function processRaise(newBid) {
    clearRaiseTimer();
    if (!state || state.phase !== 'RAISE_CHECK') return;
    if (newBid > state.currentRound.bid && newBid <= 9) {
      state.currentRound.bid = newBid;
      state.currentRound.raised = true;
      UI.showToast(`Bid raised to ${newBid}!`);
    }
    resumeAfterRaise();
  }

  function resumeAfterRaise() {
    state.phase = 'PLAYING';
    const lastTrick = state.currentRound.tricks[state.currentRound.tricks.length - 1];
    state.currentRound.trickLeader = lastTrick.winner;
    state.currentRound.currentPlayer = lastTrick.winner;
    broadcastState();
    UI.updateAll(state, mySeat);
    checkAITurn();
  }

  function endRound() {
    const result = Engine.calculateScore(
      state.currentRound.biddingTeam,
      state.currentRound.bid,
      state.currentRound.tricksTaken
    );

    state.scores.A += result.A;
    state.scores.B += result.B;

    const roundResult = {
      type: 'ROUND_RESULT',
      biddingTeam: state.currentRound.biddingTeam,
      bid: state.currentRound.bid,
      tricksTaken: { ...state.currentRound.tricksTaken },
      scoreChange: result,
      totalScores: { ...state.scores },
      gs: result.gs,
      ls: result.ls,
    };

    state.roundHistory.push(roundResult);

    // Trigger slam celebration if applicable
    if ((result.gs || result.ls) && typeof FX !== 'undefined') {
      FX.slamCelebration();
    }

    // Track round end for badges
    Badges.recordRoundEnd(Engine.getTeam(mySeat), {
      scoreChange: result,
      ls: result.ls,
      gs: result.gs,
      biddingTeam: state.currentRound.biddingTeam,
    });
    const bidMet = result[state.currentRound.biddingTeam] > 0;
    Badges.recordBidWon(Engine.getTeam(mySeat), state.currentRound.biddingTeam, bidMet);
    UI.updatePointsDisplay();
    UI.renderBadgesGrid();

    if (!isSoloMode) bcast(roundResult);
    UI.showRoundResult(roundResult);

    if (Engine.isGameOver(state.scores)) {
      const winner = Engine.getWinner(state.scores);
      state.phase = 'GAME_OVER';
      // Rotate to a new named personality set for the next game
      if (isSoloMode) {
        let nextIdx = aiCurrentSetIdx;
        while (nextIdx === aiCurrentSetIdx) nextIdx = Math.floor(Math.random() * AI_NAME_SETS.length);
        aiCurrentSetIdx = nextIdx;
        const newSet = AI_NAME_SETS[aiCurrentSetIdx];
        for (let i = 1; i < 6; i++) {
          if (state.players[i]) state.players[i].name = newSet[i - 1];
        }
      }
      if (!isSoloMode) { bcast({ type: 'GAME_OVER', winner, scores: state.scores }); broadcastState(); clearSession(); }
      UI.showGameOver(winner, state.scores);
    } else {
      state.dealer = (state.dealer + 1) % 6;
      state.phase = 'ROUND_END';
      broadcastState();
      // Auto-start next round after delay
      scheduleNextRound(d(5000));
    }
  }

  // AI Logic + turn timeout for human players.
  // Every call invalidates previously scheduled bot moves (aiTurnToken), so
  // re-entrant calls (peer leave, rejoin, migration) can never make a bot
  // play twice or out of turn.
  function checkAITurn() {
    if (!state || !state.currentRound) return;
    if (!isSoloMode && !Network.getIsHost()) return;
    clearTurnTimer();
    const token = ++aiTurnToken;
    const currentSeat = state.currentRound.currentPlayer;
    const phaseAtSchedule = state.phase;
    const player = state.players[currentSeat];
    if (!player) return;
    if (!DEALT_PHASES.includes(state.phase)) return;
    if (!player.isAI) {
      if (currentSeat !== mySeat) {
        startTurnTimer();
        if (!isSoloMode) broadcastState(); // share the fresh turnDeadline
      } else if (state.currentRound.turnDeadline) {
        state.currentRound.turnDeadline = null;
        if (!isSoloMode) broadcastState();
      }
      return;
    }
    if (state.currentRound.turnDeadline) state.currentRound.turnDeadline = null;

    let delay;
    if (state.phase === 'PLAYING') {
      delay = 7000;
    } else if (state.phase === 'BIDDING' || state.phase === 'TRUMP_SELECT') {
      delay = isSoloMode ? 1000 + Math.random() * 500 : 1500 + Math.random() * 1000;
    } else {
      delay = isSoloMode ? 500 + Math.random() * 400 : 800 + Math.random() * 600;
    }

    setTimeout(() => {
      if (token !== aiTurnToken || !state || !state.currentRound) return;
      if (!isSoloMode && !Network.getIsHost()) return;
      if (state.phase !== phaseAtSchedule || state.currentRound.currentPlayer !== currentSeat) return;
      const p = state.players[currentSeat];
      if (!p || !p.isAI) return; // a human rejoined this seat meanwhile
      if (state.phase === 'BIDDING') aiMakeBid(currentSeat);
      else if (state.phase === 'TRUMP_SELECT') aiSelectTrump(currentSeat);
      else if (state.phase === 'PLAYING') aiPlayCard(currentSeat);
      else if (state.phase === 'RAISE_CHECK') aiHandleRaise(currentSeat);
    }, d(delay));
  }

  // --- SMART AI ---

  function aiEvalHand(hand) {
    let strength = 0;
    const suitCounts = {};
    const suitStrength = {};

    for (const card of hand) {
      if (card.id === 'BIG_JOKER') { strength += 3; continue; }
      if (card.id === 'SMALL_JOKER') { strength += 2; continue; }
      if (!suitCounts[card.suit]) { suitCounts[card.suit] = 0; suitStrength[card.suit] = 0; }
      suitCounts[card.suit]++;
      if (card.rank === 'A') { strength += 1.5; suitStrength[card.suit] += 2; }
      else if (card.rank === 'K') { strength += 1; suitStrength[card.suit] += 1.5; }
      else if (card.rank === 'Q') { strength += 0.5; suitStrength[card.suit] += 1; }
    }

    // Best suit bonus: long suits are stronger as trump
    let bestSuit = null;
    let bestScore = -1;
    for (const [suit, count] of Object.entries(suitCounts)) {
      const score = count * 1.5 + (suitStrength[suit] || 0);
      if (score > bestScore) { bestScore = score; bestSuit = suit; }
    }

    // Length bonus for best suit
    if (bestSuit && suitCounts[bestSuit] >= 4) strength += 1;
    if (bestSuit && suitCounts[bestSuit] >= 5) strength += 1.5;

    return { strength, bestSuit, suitCounts, suitStrength };
  }

  function aiMakeBid(seat) {
    const hand = state.hands[seat];
    const eval_ = aiEvalHand(hand);

    // Determine if we're in raise phase (after 5 tricks, only winning team can raise)
    const isRaisePhase = state.phase === 'RAISE_CHECK';
    const tricksPlayed = state.currentRound.tricksPlayed || 0;
    const biddingTeam = state.currentRound.biddingTeam;
    const myTeam = Engine.getTeam(seat);
    const isWinningTeam = state.currentRound.tricksTaken[biddingTeam] >= tricksPlayed;

    let bid;
    if (isRaisePhase) {
      // Raise phase only after 5 tricks, only winning team can raise
      if (tricksPlayed >= 5 && isWinningTeam && myTeam === biddingTeam && eval_.strength >= 6) {
        bid = Math.min(9, state.currentRound.bid + 1);
      } else {
        bid = 0; // Pass
      }
    } else {
      // Initial bidding: 5-7 normally, 8-9 only for very strong hands
      const currentBid = state.currentRound.bid;
      const hasLongSuit = Object.values(eval_.suitCounts).some(c => c >= 5);
      const hasHighCards = eval_.strength >= 7;
      const hasJokers = hand.some(c => c.id === 'BIG_JOKER' || c.id === 'SMALL_JOKER');

      // First bid: 5-7 normally
      if (currentBid === 0) {
        if (eval_.strength >= 5 && hasLongSuit && hasJokers) {
          bid = 7; // Strong hand, bid 7
        } else if (eval_.strength >= 4) {
          bid = 5 + Math.floor(Math.random() * 2); // 5 or 6
        } else if (eval_.strength >= 3) {
          bid = 5;
        } else {
          bid = 0; // Pass
        }
      } else {
        // Raising during initial phase: only to 8-9 if very strong
        if (currentBid < 7 && eval_.strength >= 5) {
          bid = currentBid + 1;
        } else if (currentBid >= 7 && currentBid < 9 && hasLongSuit && hasHighCards && hasJokers) {
          bid = currentBid + 1; // Only 8-9 for very strong hands
        } else {
          bid = 0; // Pass
        }
      }
    }

    if (bid > 9) bid = 0; // Can't bid higher than 9
    processBid(seat, bid);
  }

  function aiSelectTrump(seat) {
    const hand = state.hands[seat];
    const eval_ = aiEvalHand(hand);

    // AI sometimes chooses no-trump if hand is balanced (no long suit)
    const suitCounts = Object.values(eval_.suitCounts);
    const maxSuitCount = Math.max(...suitCounts);
    const isBalanced = maxSuitCount <= 3; // No suit longer than 3 cards

    if (isBalanced && Math.random() < 0.3) {
      processTrumpSelect('notrump');
    } else {
      processTrumpSelect(eval_.bestSuit || 'spades');
    }
  }

  function aiPlayCard(seat) {
    const hand = state.hands[seat];
    if (hand.length === 0) return;

    const trump = state.currentRound.trumpSuit;
    const trick = state.currentRound.currentTrick;
    const isLeading = trick.length === 0;
    const leadSuit = !isLeading
      ? (trick[0].card.suit === 'joker' ? null : trick[0].card.suit)
      : null;

    const playable = Engine.getPlayableCards(hand, leadSuit, isLeading);
    if (playable.length === 1) { processPlayCard(seat, playable[0].id); return; }

    const myTeam = Engine.getTeam(seat);
    const totalPlayers = trick.length + 1; // including me
    const playersYetToPlay = 6 - totalPlayers; // players after me
    const isLastPlayer = trick.length === 5;

    // --- Card counting: build set of played cards across all tricks ---
    const playedCards = new Set();
    for (const pastTrick of (state.currentRound.tricks || [])) {
      for (const cp of (pastTrick.cards || pastTrick)) playedCards.add(cp.card?.id || cp.id);
    }
    for (const cp of trick) playedCards.add(cp.card.id);

    // --- Who is currently winning this trick? ---
    let currentWinner = null;
    let teammateWinning = false;
    let opponentWinning = false;
    if (trick.length > 0) {
      currentWinner = Engine.determineTrickWinnerRefined(trick, trump);
      teammateWinning = Engine.getTeam(currentWinner) === myTeam;
      opponentWinning = !teammateWinning;
    }

    // --- Will my teammate still win after remaining players play? ---
    // Conservative: only trust teammate win if no opponents play after us
    const opponentSeatsAfter = [];
    for (let i = 1; i <= playersYetToPlay; i++) {
      const futureSeat = (seat + i) % 6;
      if (Engine.getTeam(futureSeat) !== myTeam) opponentSeatsAfter.push(futureSeat);
    }
    const teammateWinSafe = teammateWinning && opponentSeatsAfter.length === 0;
    const teammateWinLikely = teammateWinning && opponentSeatsAfter.length > 0
      && currentWinner !== null
      && isTrickWinLikelySecure(trick, trump, opponentSeatsAfter, state);

    // --- Helper: check if winning card is strong enough opponents can't beat it ---
    function isTrickWinLikelySecure(trickSoFar, trump, oppSeats, st) {
      const winnerIdx = Engine.determineTrickWinnerRefined(trickSoFar, trump);
      const winCard = trickSoFar.find(cp => cp.playerIndex === winnerIdx).card;
      // If winning card is a joker or trump A/K, it's very likely secure
      if (winCard.id === 'BIG_JOKER') return true;
      if (winCard.id === 'SMALL_JOKER') {
        // Safe only if no trump cards in opponents' potential hands
        return !oppSeats.some(s => (st.hands[s] || []).some(c => c.suit === trump));
      }
      if (winCard.suit === trump) {
        const winVal = Engine.RANK_VALUES[winCard.rank];
        // Safe if no higher trump left (check opponents' hands)
        const higherTrumpExists = oppSeats.some(s =>
          (st.hands[s] || []).some(c => c.suit === trump && Engine.RANK_VALUES[c.rank] > winVal)
        );
        return !higherTrumpExists;
      }
      return false; // Non-trump lead can easily be beaten
    }

    // --- Context flags ---
    const myTeamBid = state.currentRound.biddingTeam === myTeam;
    const bidder = state.currentRound.bidder;
    const isBidder = seat === bidder;
    const isTeammateBidder = bidder >= 0 && Engine.getTeam(bidder) === myTeam && !isBidder;
    const tricksLeft = 9 - state.currentRound.tricksPlayed;
    const teamTricks = state.currentRound.tricksTaken[myTeam] || 0;
    const oppTeam = myTeam === 'A' ? 'B' : 'A';
    const oppTricks = state.currentRound.tricksTaken[oppTeam] || 0;
    const bigJokerGone = !!aiMemory.jokerSeen['BIG_JOKER'];
    const smallJokerGone = !!aiMemory.jokerSeen['SMALL_JOKER'];
    const trumpAcePlayed = !!aiMemory.opponentTrumpA[trump];
    const hasBigJoker = playable.some(c => c.id === 'BIG_JOKER');
    const hasSmallJoker = playable.some(c => c.id === 'SMALL_JOKER');

    // What card is currently winning (if any)?
    const currentWinCard = currentWinner !== null
      ? trick.find(cp => cp.playerIndex === currentWinner)?.card
      : null;
    const oppWinningWithJoker = opponentWinning && currentWinCard &&
      (currentWinCard.id === 'BIG_JOKER' || currentWinCard.id === 'SMALL_JOKER');
    const oppWinningWithTrumpA = opponentWinning && currentWinCard &&
      currentWinCard.suit === trump && currentWinCard.rank === 'A';
    const oppWinningWithHighTrump = opponentWinning && currentWinCard &&
      currentWinCard.suit === trump && Engine.RANK_VALUES[currentWinCard.rank] >= 10; // K or A

    let chosen;

    if (isLeading) {
      chosen = aiChooseLeadCard(seat, hand, playable, trump, playedCards, myTeam);

    } else if (teammateWinSafe || teammateWinLikely) {
      // Teammate winning securely — NEVER use Big Joker here, just dump cheap
      chosen = getDumpCard(playable, trump, leadSuit);

    } else if (teammateWinning && !isLastPlayer) {
      // Teammate winning but opponents still to act — dump cheap, save big guns
      chosen = getDumpCard(playable, trump, leadSuit);

    } else {
      // Need to contest or win this trick
      // --- BIG JOKER STRATEGY ---
      // Only use Big Joker when:
      // 1. Opponent is winning with a joker/trump A that nothing else can beat
      // 2. This is a critical trick (team needs it to meet/save bid)
      // 3. It's the last few tricks (tricksLeft <= 3) and we need every trick
      const criticalTrick = myTeamBid
        ? teamTricks < state.currentRound.bid  // bidding team needs tricks
        : oppTricks >= state.currentRound.bid - 1; // defending team must stop them
      const endgame = tricksLeft <= 3;

      if (hasBigJoker) {
        // Don't use Big Joker if a cheaper card can win
        const cheapWins = playable.filter(c => {
          if (c.id === 'BIG_JOKER' || c.id === 'SMALL_JOKER') return false;
          const testTrick = [...trick, { playerIndex: seat, card: c }];
          return Engine.determineTrickWinnerRefined(testTrick, trump) === seat;
        });

        // --- INFORMATION MANAGEMENT: consider if revealing Big Joker helps opponents ---
        // If opponents don't know Big Joker is gone, they might play conservatively
        // Revealing it early lets them play more aggressively
        const bigJokerUnknown = !bigJokerGone;
        const opponentsLeftToPlay = opponentSeatsAfter.length > 0;

        const shouldUseBigJoker =
          // Must use if opponent has unbeatable card AND it's critical
          (oppWinningWithJoker || oppWinningWithTrumpA) && criticalTrick ||
          // Use if no other way to win AND it's critical
          (cheapWins.length === 0 && criticalTrick && (opponentWinning || endgame)) ||
          // Use in endgame when every trick matters
          (endgame && criticalTrick && cheapWins.length === 0);

        // INFORMATION CHECK: if Big Joker is unknown and opponents remain, consider sacrificing
        if (bigJokerUnknown && opponentsLeftToPlay && !criticalTrick && cheapWins.length === 0) {
          // Better to lose this trick and keep Big Joker hidden
          // Opponents will remain cautious not knowing who has it
          chosen = getDumpCard(playable, trump, leadSuit);
        } else if (!shouldUseBigJoker) {
          // Save Big Joker — try to win cheaply without it
          if (cheapWins.length > 0) {
            const nonTrumpCheap = cheapWins.filter(c => c.suit !== trump);
            chosen = nonTrumpCheap.length > 0
              ? nonTrumpCheap.sort((a, b) => Engine.RANK_VALUES[a.rank] - Engine.RANK_VALUES[b.rank])[0]
              : getLowest(cheapWins, trump);
          } else {
            chosen = getDumpCard(playable, trump, leadSuit);
          }
        } else {
          // Use Big Joker — opponent has something unbeatable otherwise
          chosen = playable.find(c => c.id === 'BIG_JOKER');
        }
      } else if (hasSmallJoker) {
        // SMALL JOKER STRATEGY:
        // Use it to kill opponent's trump A or high trump when Big Joker is gone
        // Also use if no trump cards are on table (Small Joker wins)
        const trumpOnTable = trick.some(cp => cp.card.suit === trump);
        const smallJokerWins = (() => {
          const testTrick = [...trick, { playerIndex: seat, card: playable.find(c => c.id === 'SMALL_JOKER') }];
          return Engine.determineTrickWinnerRefined(testTrick, trump) === seat;
        })();

        const cheapWins = playable.filter(c => {
          if (c.suit === 'joker') return false;
          const testTrick = [...trick, { playerIndex: seat, card: c }];
          return Engine.determineTrickWinnerRefined(testTrick, trump) === seat;
        });

        const useSmallJoker = smallJokerWins && (
          (oppWinningWithTrumpA && bigJokerGone) ||
          (criticalTrick && cheapWins.length === 0 && !trumpOnTable)
        );

        if (useSmallJoker) {
          chosen = playable.find(c => c.id === 'SMALL_JOKER');
        } else if (cheapWins.length > 0) {
          const nonTrumpCheap = cheapWins.filter(c => c.suit !== trump);
          chosen = nonTrumpCheap.length > 0
            ? nonTrumpCheap.sort((a, b) => Engine.RANK_VALUES[a.rank] - Engine.RANK_VALUES[b.rank])[0]
            : getLowest(cheapWins, trump);
        } else {
          chosen = getDumpCard(playable, trump, leadSuit);
        }
      } else {
        // No jokers — standard: find cheapest winning card
        const winningCards = playable.filter(c => {
          const testTrick = [...trick, { playerIndex: seat, card: c }];
          return Engine.determineTrickWinnerRefined(testTrick, trump) === seat;
        });

        if (winningCards.length > 0) {
          const nonTrumpWins = winningCards.filter(c => c.suit !== trump);
          if (nonTrumpWins.length > 0) {
            chosen = nonTrumpWins.sort((a, b) => Engine.RANK_VALUES[a.rank] - Engine.RANK_VALUES[b.rank])[0];
          } else {
            chosen = getLowest(winningCards, trump);
          }
        } else {
          // Can't win — dump to avoid wasting trump
          // Use memory: if opponent is known void in a suit, don't lead that suit next time
          chosen = getDumpCard(playable, trump, leadSuit);
        }
      }
    }

    // Safety fallback
    if (!chosen) chosen = playable[0];
    processPlayCard(seat, chosen.id);
  }

  // Choose what to lead with — memory-aware and teammate-coordinated
  function aiChooseLeadCard(seat, hand, playable, trump, playedCards, myTeam) {
    const oppTeam = myTeam === 'A' ? 'B' : 'A';

    // Identify teammate seats
    const teammateSeats = [0,1,2,3,4,5].filter(s => Engine.getTeam(s) === myTeam && s !== seat);
    // Identify opponent seats
    const oppSeats = [0,1,2,3,4,5].filter(s => Engine.getTeam(s) === oppTeam);

    // --- TEAMMATE ANALYSIS: infer teammate's strong suits from their play history ---
    const teammateStrongSuits = new Set();
    for (const tSeat of teammateSeats) {
      const high = aiMemory.highCardPlayed[tSeat] || {};
      for (const [suit, val] of Object.entries(high)) {
        if (val >= 10) teammateStrongSuits.add(suit); // Teammate has played K or A in this suit
      }
    }
    // Also check if teammate has shown void in any suit (don't lead those)
    const teammateVoidSuits = new Set();
    for (const tSeat of teammateSeats) {
      const voids = aiMemory.suitVoids[tSeat] || new Set();
      for (const v of voids) teammateVoidSuits.add(v);
    }

    // --- PRIORITY 1: Lead to teammate's strong suit to set them up ---
    const teammateStrongLeads = playable.filter(c =>
      c.suit !== trump && c.suit !== 'joker' &&
      teammateStrongSuits.has(c.suit) &&
      !teammateVoidSuits.has(c.suit)
    );
    if (teammateStrongLeads.length > 0) {
      // Lead low card of their strong suit - they can win with high cards
      return teammateStrongLeads.sort((a,b) => Engine.RANK_VALUES[a.rank] - Engine.RANK_VALUES[b.rank])[0];
    }

    // Suits the human has been repeatedly leading (patterns to counter)
    const humanFavSuit = (() => {
      if (aiMemory.humanLeadPatterns.length < 2) return null;
      const counts = {};
      for (const s of aiMemory.humanLeadPatterns) counts[s] = (counts[s] || 0) + 1;
      const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
      return sorted[0]?.[0] || null;
    })();

    // Suits where opponents are known to be strong (have played high cards)
    const oppStrongSuits = new Set();
    for (const s of oppSeats) {
      const high = aiMemory.highCardPlayed[s] || {};
      for (const [suit, val] of Object.entries(high)) {
        if (val >= 11) oppStrongSuits.add(suit); // K or A seen
      }
    }

    // Suits opponents are known void in (great to lead — forces them off-suit)
    const oppVoidSuits = new Set();
    for (const s of oppSeats) {
      const voids = aiMemory.suitVoids[s] || new Set();
      for (const v of voids) oppVoidSuits.add(v);
    }

    // 1. Lead a suit opponents are void in (they can't follow, forces trump or dump)
    const voidLeads = playable.filter(c =>
      c.suit !== trump && c.suit !== 'joker' && oppVoidSuits.has(c.suit)
    );
    if (voidLeads.length > 0) {
      // Lead highest of that suit — it will win since they're void
      return voidLeads.sort((a,b) => Engine.RANK_VALUES[b.rank] - Engine.RANK_VALUES[a.rank])[0];
    }

    // 2. Lead a suit where we have the Ace (guaranteed win)
    const aces = playable.filter(c => c.rank === 'A' && c.suit !== trump && c.suit !== 'joker');
    if (aces.length > 0) {
      // Prefer ace of suit NOT in opponents' strong suits
      const safeAces = aces.filter(c => !oppStrongSuits.has(c.suit));
      const pool = safeAces.length > 0 ? safeAces : aces;
      // Lead ace of shortest suit (clears it out fast)
      return pool.sort((a, b) => {
        const cA = hand.filter(c => c.suit === a.suit).length;
        const cB = hand.filter(c => c.suit === b.suit).length;
        return cA - cB;
      })[0];
    }

    // 3. Lead a suit where King is now highest (ace played)
    const kings = playable.filter(c => c.rank === 'K' && c.suit !== trump && c.suit !== 'joker');
    for (const k of kings) {
      if (playedCards.has(`A-${k.suit}`)) return k;
    }

    // 4. Counter human's favourite lead — lead a DIFFERENT suit to confuse
    const nonTrump = playable.filter(c => c.suit !== trump && c.suit !== 'joker');
    if (nonTrump.length > 0) {
      const suitLengths = {};
      for (const c of hand) {
        if (c.suit !== trump && c.suit !== 'joker')
          suitLengths[c.suit] = (suitLengths[c.suit] || 0) + 1;
      }

      // Avoid human's favourite suit (be unpredictable)
      const nonFav = nonTrump.filter(c => c.suit !== humanFavSuit);
      const pool = nonFav.length > 0 ? nonFav : nonTrump;

      // Avoid suits opponents are strong in
      const safe = pool.filter(c => !oppStrongSuits.has(c.suit));
      const finalPool = safe.length > 0 ? safe : pool;

      // Sort by suit length desc, then within that suit lead second-highest to hide Ace/King
      finalPool.sort((a,b) => (suitLengths[b.suit] || 0) - (suitLengths[a.suit] || 0));
      const longSuit = finalPool[0].suit;
      const longSuitCards = finalPool.filter(c => c.suit === longSuit)
        .sort((a,b) => Engine.RANK_VALUES[b.rank] - Engine.RANK_VALUES[a.rank]);

      if (longSuitCards.length >= 3) {
        // Lead 2nd highest — conceals Ace/King, opponent can't read hand
        return longSuitCards[1];
      }
      return finalPool[0];
    }

    return playable[0];
  }

  // Dump the least valuable card — protect trump, jokers, and high suited cards
  function getDumpCard(playable, trump, leadSuit) {
    // Sort by value ascending: off-suit low ranks first, then lead-suit low, then trump low, jokers last
    const sorted = [...playable].sort((a, b) => {
      const valA = dumpValue(a, trump, leadSuit);
      const valB = dumpValue(b, trump, leadSuit);
      return valA - valB;
    });
    return sorted[0];
  }

  function dumpValue(card, trump, leadSuit) {
    if (card.id === 'BIG_JOKER') return 10000;
    if (card.id === 'SMALL_JOKER') return 9000;
    if (card.suit === trump) return 500 + Engine.RANK_VALUES[card.rank];
    if (card.suit === leadSuit) return 200 + Engine.RANK_VALUES[card.rank];
    // Off-suit: lowest value to dump
    return Engine.RANK_VALUES[card.rank];
  }

  // AI teammates suggest how many tricks they can win during raise discussion
  function aiSuggestRaiseCommitment() {
    const biddingTeam = state.currentRound.biddingTeam;
    const aiSeats = [1, 2, 3, 4, 5].filter(s => 
      state.players[s]?.isAI && Engine.getTeam(s) === biddingTeam
    );

    for (const seat of aiSeats) {
      const hand = state.hands[seat];
      if (!hand || hand.length === 0) continue;

      const trump = state.currentRound.trumpSuit;
      const eval_ = aiEvalHand(hand);
      
      // Estimate additional tricks AI can win
      let canWin = 0;
      const hasBigJoker = hand.some(c => c.id === 'BIG_JOKER');
      const hasSmallJoker = hand.some(c => c.id === 'SMALL_JOKER');
      const trumpCards = hand.filter(c => c.suit === trump);
      const highTrump = trumpCards.filter(c => Engine.RANK_VALUES[c.rank] >= 11); // A or K
      
      if (hasBigJoker) canWin++;
      if (hasSmallJoker && !aiMemory.opponentTrumpA[trump]) canWin++;
      canWin += Math.min(highTrump.length, 2);
      
      // Cap at remaining tricks
      const remaining = 4; // 9 total - 5 played
      canWin = Math.min(canWin, remaining);

      if (canWin > 0) {
        state.currentRound.raiseCommitments[seat] = canWin;
        const playerName = state.players[seat].name;
        const msg = canWin === 1 ? `I can take 1 more 💪` : `I can win ${canWin} more 🔥`;
        setTimeout(() => {
          UI.addChatMessage(playerName, msg);
        }, 500 + seat * 300);
      }
    }

    // Update UI after all AI commitments
    setTimeout(() => {
      broadcastState();
      UI.updateAll(state, mySeat);
    }, 2000);
  }

  function getLowest(cards, trump) {
    return cards.sort((a, b) => {
      if (a.suit === 'joker') return 1;
      if (b.suit === 'joker') return -1;
      if (a.suit === trump && b.suit !== trump) return 1;
      if (b.suit === trump && a.suit !== trump) return -1;
      return Engine.RANK_VALUES[a.rank] - Engine.RANK_VALUES[b.rank];
    })[0];
  }

  function aiHandleRaise(seat) {
    if (Engine.getTeam(seat) !== state.currentRound.biddingTeam) return;
    const tricks = state.currentRound.tricksTaken[state.currentRound.biddingTeam];
    const remaining = 9 - state.currentRound.tricksPlayed;
    // If we've won all 5 so far and have strong cards, go for LS/GS
    if (tricks === 5 && remaining === 4) {
      const eval_ = aiEvalHand(state.hands[seat]);
      if (eval_.strength >= 4) {
        processRaise(8); // Go for LS
        return;
      }
    }
    processNoRaise();
  }

  // AI chat responses — mix of English + proper Odia script ✨
  const AI_CHAT_LINES = [
    'Nice play! 👏', 'Good one!', 'Hmm, interesting move...',
    'Let\'s go team! 💪', 'Watch out! 👀', 'I see what you did there.',
    'Trump it! 🔥', 'Well played.', 'That was bold!',
    'My turn next...', 'Great trick!', 'Not bad!',
    'This round is ours! 🏆', 'Don\'t count us out yet!',
    // Odia script lines ✨
    'ଆଜି ଆମେ ଜିତିବା! 🦁',       // Today we will win!
    'ଏଇ କାର୍ଡ ବଡ଼ ଶକ୍ତ! 💥',     // This card is very strong!
    'ଦାଦା, କଣ କଲେ? 😂',           // Bro, what did you do?
    'ମିଠା ଖେଳ ଖେଳୁଛ! 🍬',         // Playing a sweet game!
    'ଜୋକର ଦେବ ନାହିଁ! 🃏',         // Won\'t give the joker!
    'ପାଗଳ ହୋଇଗଲ କି? 😵',          // Have you gone crazy?
    'ସହି ବାତ! 👍',                  // Correct thing!
    'ଆମ ଟିମ୍ ବେଷ୍ଟ! 🤝',           // Our team is the best!
    'ଟ୍ରମ୍ପ ଦିଅ ଏଠି! 😤',           // Give trump here!
    'ହଁ ହଁ! ହୁଁ! 😤',               // Odia exclamation
    'ଏଇଟା ଧମାକା! 🔥',              // This is a blast!
    'ଭଲ ଖେଳ, ଭଲ ଖେଳ! 👌',        // Good game, good game!
  ];

  function getRandomAIChatLine() {
    return AI_CHAT_LINES[Math.floor(Math.random() * AI_CHAT_LINES.length)];
  }

  // Send chat
  function sendChat(text) {
    if (!isSoloMode) {
      const msg = { type: 'CHAT', name: myName, text };
      bcast(msg);
    }
    UI.addChatMessage(myName, text);

    // AI responds in solo mode after a short delay
    if (isSoloMode) {
      const responder = AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)];
      const delay = 800 + Math.random() * 1200;
      setTimeout(() => {
        UI.addChatMessage(responder, getRandomAIChatLine());
      }, delay);
    }
  }

  // Broadcast emoji reaction to all players
  function broadcastEmoji(emoji) {
    if (!isSoloMode) {
      const msg = { type: 'EMOJI_REACTION', emoji };
      bcast(msg);
    }
    UI.showEmojiReaction(emoji);
  }

  // Sanitize state before sending: hide every hand, expose only counts
  function sanitizeStateForClient(s) {
    const clean = JSON.parse(JSON.stringify(s));
    clean.handCounts = (s.hands || []).map(h => (h ? h.length : 0));
    clean.hands = [[], [], [], [], [], []]; // hands travel privately
    if (clean.currentRound && clean.currentRound.passedPlayers) {
      clean.currentRound.passedPlayers = Array.from(s.currentRound.passedPlayers || []);
    }
    return clean;
  }

  function broadcastState() {
    if (isSoloMode || !state) return;
    state.version = (state.version || 0) + 1;
    bcast({ type: 'STATE_UPDATE', state: sanitizeStateForClient(state) });
    saveSession();
  }

  // Host-only: kick a player. Converts the seat to a bot and notifies the kicked peer.
  function kickPlayer(seat) {
    if (!Network.getIsHost()) return;
    if (seat === mySeat) return;
    const player = state.players[seat];
    if (!player || player.isAI) return;
    const kickedPeer = player.peerId;
    const kickedName = player.originalName || player.name;

    // A kick is final: the seat's secret no longer grants a rejoin
    disconnectedPlayers.delete(player.id);
    player.kicked = true;

    player.connected = false;
    player.isAI = true;
    player.originalName = kickedName;
    player.name = `${kickedName} (Bot)`;
    if (kickedPeer) {
      peerToSeat.delete(kickedPeer);
      send(kickedPeer, { type: 'KICKED', reason: 'Removed by host' })
        .then(() => setTimeout(() => Network.dropPeer(kickedPeer), 500));
    }
    seatToPeer.delete(seat);

    bcast({ type: 'PLAYER_LEFT', seat, name: kickedName });
    broadcastState();
    if (state.phase === 'WAITING') UI.updateLobby(state, mySeat);
    UI.showToast(`${kickedName} was kicked`);

    // If it was their turn, keep the game moving
    if (state.currentRound && state.currentRound.currentPlayer === seat) {
      checkAITurn();
    }
  }

  // Explicit "Leave" — the player means it, so no auto-rejoin afterwards
  async function leaveGame() {
    clearSession();
    if (!isSoloMode && state && Network.getPeerId()) {
      try {
        if (Network.getIsHost()) await bcast({ type: 'HOST_CLOSED' });
        else Network.sendByeBestEffort();
        await sleep(150); // let the goodbye flush before tearing down
      } catch (_) { /* best-effort */ }
    }
    cleanup();
    UI.showScreen('title-screen');
  }

  // Tab close / refresh / navigation. Deliberately NOT "end the game": a
  // host who refreshes or loses the tab hands off to the next player, and
  // the saved session lets anyone who reloads rejoin their seat.
  const gracefulExit = () => {
    // From here on this tab is going away: never react to our own teardown
    // (closing channels looks like "host left" and would trigger a bogus
    // promotion that forces the real host to step down).
    unloading = true;
    if (!state || isSoloMode || !Network.getPeerId()) return;
    saveSession(true);
    Network.sendByeBestEffort();
  };
  window.addEventListener('beforeunload', gracefulExit);
  window.addEventListener('pagehide', gracefulExit);

  return {
    hostGame, joinGame, startGame, startSoloGame, leaveGame, cleanup,
    getState, getMySeat, getMyTeam,
    makeBid, selectTrump, playCard,
    raiseBid, noRaise, commitRaiseTricks, extendRaiseTimer, sendChat, broadcastEmoji,
    stopAINameRotation,
    kickPlayer,
    getSavedSession, resumeSavedSession, clearSession,
    // Test/diagnostic hooks (read-only views + controlled faults)
    __debug: {
      term: () => hostTerm,
      isHost: () => Network.getIsHost(),
      hostPeerId: () => getHostPeerId(),
      roomCode: () => roomCode,
      playerId: () => myPlayerId,
      reconnecting: () => !!reconnecting,
      migrating: () => migrationInProgress,
      forgeRejoin: (hostPeerId, playerId) => send(hostPeerId, {
        type: 'REJOIN_REQUEST', playerId, secret: GameCrypto.generateSecret(), name: 'Impostor',
      }),
    },
  };
})();
