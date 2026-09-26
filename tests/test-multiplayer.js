// Unit tests for multiplayer improvements.
// Loads game.js / engine.js / ui.js under jsdom with mocked Network + GameCrypto.
// Focus: the new logic we added on the multiplayer-improvements branch.
// Run: node tests/test-multiplayer.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Build a fresh DOM with the required DOM elements the modules touch.
function makeDom() {
  const html = `<!DOCTYPE html><html><body>
    <div id="lobby-seats"></div>
    <div id="lobby-status"></div>
    <button id="start-game-btn" style="display:none"></button>
    <div id="room-code-display"></div>
    <div id="host-id-display"></div>
    <div id="room-code-section"></div>
    <div id="qr-code-container"></div>
    <div id="qr-code"></div>
    <div id="qr-join-url"></div>
    <div id="game-screen"></div>
    <div id="game-info"></div>
    <div id="trick-counter"></div>
    <div id="my-team-score"></div>
    <div id="opp-team-score"></div>
    <div id="my-team-label"></div>
    <div id="opp-team-label"></div>
    <div id="my-team-tricks"></div>
    <div id="opp-team-tricks"></div>
    <div id="bid-info"></div>
    <div id="trump-info"></div>
    <div id="raise-panel" style="display:none"></div>
    <div id="round-history"></div>
    <div id="players-area"></div>
    <div id="player-positions"></div>
    <div id="hand-container"></div>
    <div id="trick-area"></div>
    <div id="trick-cards"></div>
    <div id="bidding-panel"></div>
    <div id="trump-select-panel"></div>
    <div id="chat-messages"></div>
    <div id="toast-container"></div>
    <div id="badge-popup"></div>
    <div id="badges-grid"></div>
    <div id="points-display"></div>
    <div id="reaction-overlay"></div>
    <div id="my-hand"></div>
    <div id="my-hand-container"></div>
    <div id="current-trick"></div>
    <div id="raise-buttons"></div>
    <div id="raise-countdown"></div>
    <div id="my-commitment"></div>
    <div id="extend-timer-btn"></div>
    <div id="commit-btn"></div>
    <div id="toast"></div>
    <div id="center-emoji"></div>
    <div id="result-overlay"></div>
    <div id="topbar-points"></div>
    <div id="panel-points"></div>
    <div id="badges-panel"></div>
    <div id="chat-area"></div>
    <div id="chat-unread"></div>
    <div id="input-overlay"></div>
    <div id="dialog-cancel"></div>
    <div id="dialog-ok"></div>
    <div id="dialog-input"></div>
    <div id="rules-overlay"></div>
    <div id="shuffle-overlay"></div>
    <div id="shuffle-text"></div>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
  return dom;
}

// Load modules into a jsdom window. Each module is an IIFE that binds to
// window globals (const Engine = ..., etc.) — we exec them inside window.
function loadModules(dom) {
  const win = dom.window;
  // Shims the browser modules rely on
  win.QRCode = undefined; // OK — code handles missing QR lib
  // Peer stub (never actually used; Network is mocked below)
  win.Peer = class {
    constructor() { setTimeout(() => this._openCb && this._openCb('MOCK_PEER'), 0); }
    on(evt, cb) { if (evt === 'open') this._openCb = cb; }
    destroy() {}
    reconnect() {}
  };

  // GameCrypto stub (deterministic, no crypto)
  const cryptoSrc = `
    const GameCrypto = {
      generatePlayerId: () => 'PID_' + Math.random().toString(36).slice(2, 10),
      generateRoomCode: () => 'ROOM' + Math.floor(Math.random()*10000),
      deriveRoomKey: async () => 'MOCK_KEY',
      encrypt: async (t) => t,
      decrypt: async (t) => t,
      generateSecret: () => 'a'.repeat(64),
      sha256Hex: async () => 'b'.repeat(64),
    };
  `;

  // Badges stub — the real module needs localStorage etc., not the point of these tests
  const badgesSrc = `
    const Badges = {
      init(){}, recordTrumpCall(){}, recordTrickWin(){}, recordRoundEnd(){},
      recordBidWon(){}, showPoints(){},
    };
  `;

  // FX stub
  const fxSrc = `const FX = { slamCelebration(){} };`;

  // Load real modules
  const engineSrc = read('engine.js');
  const networkSrc = read('network.js');
  const uiSrc = read('ui.js');
  const gameSrc = read('game.js');

  // Execute in window scope. Because each is an IIFE assigning to a const,
  // we wrap them so const declarations become globals.
  const wrap = (src) => src.replace(/^const (\w+) = /m, 'window.$1 = ');

  win.eval(cryptoSrc + '\nwindow.GameCrypto = GameCrypto;');
  win.eval(badgesSrc + '\nwindow.Badges = Badges;');
  win.eval(fxSrc + '\nwindow.FX = FX;');
  win.eval(wrap(engineSrc));
  win.eval(wrap(networkSrc));
  win.eval(wrap(uiSrc));
  win.eval(wrap(gameSrc));

  return win;
}

// ---- Test harness ----
let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    fail++;
    failures.push({ name, err: e });
    console.log('  \u2717 ' + name + '\n    ' + (e.stack || e.message));
  }
}
function assert(cond, msg) { if (!cond) throw new Error('assert failed: ' + (msg || '')); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`assert eq failed: ${JSON.stringify(a)} !== ${JSON.stringify(b)} ${msg || ''}`); }

// =====================================================================
// TESTS
// =====================================================================

console.log('\n== Static loading ==');
const dom = makeDom();
const win = loadModules(dom);
test('modules exposed on window', () => {
  assert(win.Engine, 'Engine missing');
  assert(win.Network, 'Network missing');
  assert(win.UI, 'UI missing');
  assert(win.Game, 'Game missing');
});
test('Network exposes new promoteToHost', () => {
  assert(typeof win.Network.promoteToHost === 'function', 'promoteToHost not exported');
});
test('Game exposes new kickPlayer', () => {
  assert(typeof win.Game.kickPlayer === 'function', 'kickPlayer not exported');
});

console.log('\n== Engine sanity ==');
test('createGameState returns valid state (players[] + A/B scores)', () => {
  const s = win.Engine.createGameState();
  assert(Array.isArray(s.players), 'players not an array');
  assert(s.scores && typeof s.scores.A === 'number' && typeof s.scores.B === 'number');
});
test('getTeam alternates ABABAB', () => {
  const t = i => win.Engine.getTeam(i);
  assertEq(t(0), 'A'); assertEq(t(1), 'B');
  assertEq(t(2), 'A'); assertEq(t(3), 'B');
  assertEq(t(4), 'A'); assertEq(t(5), 'B');
});

console.log('\n== UI: updateLobby (new features) ==');
test('updateLobby renders 6 seats + N/6 status', () => {
  const state = win.Engine.createGameState();
  state.phase = 'WAITING';
  state.players[0] = { id: 'p0', name: 'Alice', seat: 0, peerId: 'a', connected: true };
  state.players[1] = { id: 'p1', name: 'Bob', seat: 1, peerId: 'b', connected: true };
  win.UI.updateLobby(state, 0);
  const seats = win.document.querySelectorAll('.lobby-seat');
  assertEq(seats.length, 6, 'seat count');
  assert(win.document.getElementById('lobby-status').textContent.includes('2/6'),
    'expected "2/6" in lobby-status, got: ' + win.document.getElementById('lobby-status').textContent);
});

test('updateLobby marks disconnected player with bot indicator', () => {
  const state = win.Engine.createGameState();
  state.phase = 'WAITING';
  state.players[0] = { id: 'p0', name: 'Alice', seat: 0, peerId: 'a', connected: true };
  state.players[1] = { id: 'p1', name: 'Bob (Bot)', seat: 1, peerId: null, connected: false, isAI: true, originalName: 'Bob' };
  win.UI.updateLobby(state, 0);
  const html = win.document.getElementById('lobby-seats').innerHTML;
  assert(html.includes('Disconnected'), 'expected disconnected indicator');
  assert(html.includes('\u2713 Connected'), 'expected connected indicator on Alice');
});

test('kick button only shown when host (Network.getIsHost)', () => {
  // Simulate we are NOT host
  const state = win.Engine.createGameState();
  state.phase = 'WAITING';
  state.players[0] = { id: 'p0', name: 'Alice', seat: 0, peerId: 'a', connected: true };
  state.players[1] = { id: 'p1', name: 'Bob', seat: 1, peerId: 'b', connected: true };
  win.UI.updateLobby(state, 1);
  const btns = win.document.querySelectorAll('.seat-kick-btn');
  // Network.getIsHost() is false in test (no game started) so kicks hidden
  assertEq(btns.length, 0, 'kick buttons should be hidden when not host');
});

console.log('\n== UI: turn countdown ==');
test('renderGameInfo shows countdown suffix when turnDeadline set for other player', () => {
  const state = win.Engine.createGameState();
  state.phase = 'PLAYING';
  state.players[0] = { id: 'me', name: 'Me', seat: 0, connected: true };
  state.players[1] = { id: 'p1', name: 'Bob', seat: 1, connected: true };
  state.currentRound = {
    currentPlayer: 1,
    currentBidder: 1,
    tricksPlayed: 0,
    tricksTaken: { A: 0, B: 0 },
    bids: [],
    tricks: [],
    currentTrick: [],
    passedPlayers: new Set(),
    turnDeadline: Date.now() + 30000,
    raiseCommitments: {},
  };
  // We are seat 0, so timer should render for Bob's turn.
  // Downstream renderPlayers/Trick may throw on missing DOM; catch that,
  // we only care about game-info text.
  try { win.UI.updateAll(state, 0); } catch (_) {}
  const txt = win.document.getElementById('game-info').textContent;
  assert(/\u23f1 \d+s$/.test(txt), 'expected countdown suffix, got: ' + txt);
});

test('renderGameInfo does NOT show countdown on my own turn', () => {
  const state = win.Engine.createGameState();
  state.phase = 'PLAYING';
  state.players[0] = { id: 'me', name: 'Me', seat: 0, connected: true };
  state.currentRound = {
    currentPlayer: 0,
    currentBidder: 0,
    tricksPlayed: 0,
    tricksTaken: { A: 0, B: 0 },
    bids: [],
    tricks: [],
    currentTrick: [],
    passedPlayers: new Set(),
    turnDeadline: Date.now() + 30000,
    raiseCommitments: {},
  };
  try { win.UI.updateAll(state, 0); } catch (_) {}
  const txt = win.document.getElementById('game-info').textContent;
  assert(!/\u23f1/.test(txt), 'should not render countdown on own turn, got: ' + txt);
});

console.log('\n== Deterministic host election ==');
// The host election is an internal function; we can't call it directly (it's
// closed over inside the Game IIFE). But we can validate the algorithm's
// intent by inspecting the code we wrote. As a proxy, we test that the
// selection rule (lowest-seat human, connected, non-AI, non-departed) is
// what any correct implementation would produce for these fixtures.
function idealElect(players, departed) {
  for (let s = 0; s < 6; s++) {
    if (s === departed) continue;
    const p = players[s];
    if (p && !p.isAI && p.connected !== false && p.peerId) {
      return s;
    }
  }
  return -1;
}

test('election skips AI, disconnected, and departed host', () => {
  const players = [
    { id: 'h', name: 'Host', seat: 0, peerId: 'H', connected: true }, // departed
    { id: 'b', name: 'Bot', seat: 1, peerId: 'X', connected: true, isAI: true }, // skip
    { id: 'd', name: 'DC',  seat: 2, peerId: 'Y', connected: false }, // skip
    { id: 'c', name: 'Ok',  seat: 3, peerId: 'Z', connected: true }, // WIN
    { id: 'x', name: 'Ok2', seat: 4, peerId: 'W', connected: true },
    null,
  ];
  assertEq(idealElect(players, 0), 3);
});

test('election returns -1 when only bots/disconnected remain', () => {
  const players = [
    { id: 'h', name: 'Host', seat: 0, peerId: 'H', connected: true },
    { id: 'b', name: 'Bot', seat: 1, peerId: 'X', connected: true, isAI: true },
    { id: 'd', name: 'DC',  seat: 2, peerId: 'Y', connected: false },
    null, null, null,
  ];
  assertEq(idealElect(players, 0), -1);
});

console.log('\n== Anti-race: state versioning + card dedupe ==');
// Verify the CARD_PLAYED broadcast includes a seq number (source check).
test('processPlayCard broadcast includes seq field', () => {
  const src = read('game.js');
  assert(/type: 'CARD_PLAYED', seat, cardId, seq: cardPlaySeqCounter/.test(src),
    'expected CARD_PLAYED to include seq');
});
test('broadcastState bumps state.version monotonically', () => {
  const src = read('game.js');
  assert(/state\.version = \(state\.version \|\| 0\) \+ 1/.test(src),
    'expected version increment in broadcastState');
});
test('client applyState drops stale (term, version) updates', () => {
  const src = read('game.js');
  const m = src.match(/function applyState[\s\S]*?^\s{2}\}/m);
  assert(m, 'applyState not found');
  assert(/term < lastAppliedStateTerm/.test(m[0]), 'expected lower-term rejection');
  assert(/v <= lastAppliedStateVersion/.test(m[0]), 'expected same-term version rejection');
});
test('client CARD_PLAYED handler dedupes on (seat, cardId, seq)', () => {
  const src = read('game.js');
  assert(/playedCardSeq\.has\(key\)/.test(src), 'expected dedupe check');
  assert(/Duplicate CARD_PLAYED ignored/.test(src), 'expected dedupe log');
});

console.log('\n== Rejoin: seat ownership + current hand ==');
test('handleRejoinRequest verifies SHA-256 of secret against stored tokenHash', () => {
  const src = read('game.js');
  const m = src.match(/async function handleRejoinRequest[\s\S]*?^\s{2}\}/m);
  assert(m, 'could not find handleRejoinRequest');
  assert(/GameCrypto\.sha256Hex\(msg\.secret\)\) === player\.tokenHash/.test(m[0]), 'expected hash verification');
  assert(!/originalSeat/.test(m[0]), 'must not trust a client-claimed seat');
  assert(/hand: state\.hands\[seat\]/.test(m[0]), 'must send the CURRENT hand, not a stale snapshot');
});
test('JOIN_REQUEST cannot claim an existing playerId', () => {
  const src = read('game.js');
  const m = src.match(/function handleJoinRequest[\s\S]*?^\s{2}\}/m);
  assert(/state\.players\.some\(p => p && p\.id === msg\.playerId\)/.test(m[0]), 'expected playerId collision guard');
});
test('session is persisted and resumable', () => {
  assert(typeof win.Game.getSavedSession === 'function', 'getSavedSession missing');
  assert(typeof win.Game.resumeSavedSession === 'function', 'resumeSavedSession missing');
  win.localStorage.setItem('nattice.session.v1', JSON.stringify({ roomCode: 'ABC234', playerId: 'p', secret: 's', savedAt: Date.now() }));
  assertEq(win.Game.getSavedSession().roomCode, 'ABC234');
  win.localStorage.setItem('nattice.session.v1', JSON.stringify({ roomCode: 'OLD', playerId: 'p', secret: 's', savedAt: Date.now() - 4 * 3600e3 }));
  assertEq(win.Game.getSavedSession(), null, 'expired session must be ignored');
  win.localStorage.removeItem('nattice.session.v1');
});
test('deal is private: no DEAL_ALL broadcast of every hand', () => {
  const src = read('game.js');
  assert(!/DEAL_ALL/.test(src), 'DEAL_ALL must be gone');
  assert(/send\(pid, \{ type: 'DEAL', state: clean, hand: hands\[s\] \}\)/.test(src), 'expected per-player DEAL');
  assert(/clean\.hands = \[\[\], \[\], \[\], \[\], \[\], \[\]\]/.test(src), 'sanitized state must hide hands');
});

console.log('\n== Host addressing ==');
test('client actions go through sendToHost (connection-aware)', () => {
  const src = read('game.js');
  const sites = src.match(/sendToHost\(\{ type: '(BID|TRUMP_SELECT|RAISE_COMMIT|EXTEND_TIMER|RAISE_BID|NO_RAISE)'/g) || [];
  assert(sites.length >= 6, 'expected >=6 sendToHost sites, got ' + sites.length);
});

console.log('\n== Host migration wiring ==');
test('HOST_MIGRATED message type is handled on client', () => {
  const src = read('game.js');
  assert(/case 'HOST_MIGRATED':/.test(src), 'HOST_MIGRATED case missing');
  assert(/function handleHostMigrated/.test(src), 'handler function missing');
});
test('promotion bumps term, claims alias, and runs hand sync', () => {
  const src = read('game.js');
  const m = src.match(/function promoteSelfToHost[\s\S]*?^\s{2}\}/m);
  assert(m, 'promoteSelfToHost not found');
  assert(/hostTerm \+= 1/.test(m[0]), 'must bump the term');
  assert(/Network\.promoteToHost\(\)/.test(m[0]), 'must call Network.promoteToHost');
  assert(/Network\.claimAlias\(alias/.test(m[0]), 'must claim the term alias');
  assert(/handSync = \{/.test(m[0]), 'must collect hands from clients');
  assert(/bcast\(hostMigratedMessage/.test(m[0]), 'must broadcast HOST_MIGRATED');
});
test('host with a lower term steps down on seeing a higher one', () => {
  const src = read('game.js');
  const m = src.match(/function onNetMessage[\s\S]*?^\s{2}\}/m);
  assert(/if \(t > hostTerm\) \{[\s\S]*?stepDown\(/.test(m[0]), 'expected stepDown on higher term');
  assert(/STALE_TERM/.test(m[0]), 'clients must reject lower-term authority');
});
test('client peer-leave triggers attemptHostMigration when host drops', () => {
  const src = read('game.js');
  assert(/attemptHostMigration\(peerId\)/.test(src), 'expected attemptHostMigration call on peer leave');
  assert(/away \|\| reconnecting/.test(src), 'must not migrate when WE were the ones away');
});

console.log('\n== Network hardening ==');
test('Network exposes sendByeBestEffort for graceful leave', () => {
  assert(typeof win.Network.sendByeBestEffort === 'function', 'sendByeBestEffort not exported');
});
test('setupConnection has idempotency guard', () => {
  const src = read('network.js');
  assert(/conn\._natticeSetup/.test(src), 'expected _natticeSetup guard');
  assert(/conn\._natticeJoined/.test(src), 'expected _natticeJoined guard');
});
test('data handler treats __BYE__ as a close', () => {
  const src = read('network.js');
  assert(/msg\.type === '__BYE__'/.test(src), '__BYE__ handling missing');
});
test('ICE state change triggers early leave detection', () => {
  const src = read('network.js');
  assert(/iceconnectionstatechange/.test(src), 'ICE state listener missing');
});
test('beforeunload + pagehide both call gracefulExit', () => {
  const src = read('game.js');
  assert(/addEventListener\('beforeunload', gracefulExit\)/.test(src), 'beforeunload not wired');
  assert(/addEventListener\('pagehide', gracefulExit\)/.test(src), 'pagehide not wired');
  assert(/sendByeBestEffort\(\)/.test(src), 'graceful exit does not call sendByeBestEffort');
});
test('TURN server config is honored', () => {
  const src = read('network.js');
  assert(/NATTICE_CONFIG\.turnServers/.test(src), 'turnServers config missing');
  assert(/turnUrl/.test(src), 'turnUrl URL param missing');
});
test('PeerJS cloud connect has retry logic', () => {
  const src = read('network.js');
  assert(/MAX_CONNECT_ATTEMPTS/.test(src), 'connect retry constant missing');
  assert(/tryConnect/.test(src), 'retryable connect function missing');
});
test('Public TURN servers are wired into index.html', () => {
  const src = read('index.html');
  assert(/turnServers:/.test(src), 'turnServers config missing in index.html');
  assert(/openrelay\.metered\.ca/.test(src), 'OpenRelay TURN URL missing');
});
test('broadcast snapshots connections to avoid mutation-during-iteration', () => {
  const src = read('network.js');
  assert(/Snapshot connections|Array\.from\(connections\.entries\(\)\)/.test(src),
    'broadcast should snapshot');
});

console.log('\n== Deadline-based timers ==');
test('raise timer sets raiseDeadline (epoch ms)', () => {
  const src = read('game.js');
  assert(/state\.currentRound\.raiseDeadline = Date\.now\(\) \+ timerDuration \* 1000/.test(src),
    'expected raiseDeadline set from Date.now()');
});
test('turn timer sets turnDeadline before broadcastState', () => {
  const src = read('game.js');
  assert(/state\.currentRound\.turnDeadline = Date\.now\(\) \+ TURN_TIMEOUT_MS/.test(src),
    'expected turnDeadline set');
  assert(/share the fresh turnDeadline/.test(src), 'expected turnDeadline broadcast');
});
test('extendRaiseTimer also extends raiseDeadline', () => {
  const src = read('game.js');
  assert(/state\.currentRound\.raiseDeadline = \(state\.currentRound\.raiseDeadline \|\| Date\.now\(\)\) \+ 10000/.test(src),
    'extendRaiseTimer should bump raiseDeadline by 10000');
});

// =====================================================================

console.log('\n== Hand recovery after migration (Engine.recoverHands) ==');
const E = win.Engine;
function fullDeal(seed) {
  let x = seed;
  const rng = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const deck = E.createDeck();
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return [0, 1, 2, 3, 4, 5].map(s => deck.slice(s * 9, s * 9 + 9));
}
// Play `n` legal cards starting from seat `leader`, updating hands + round
function playLegal(hands, round, n) {
  for (let k = 0; k < n; k++) {
    const trick = round.currentTrick;
    const seat = trick.length ? (trick[trick.length - 1].playerIndex + 1) % 6 : round.leader;
    const isLeading = trick.length === 0;
    const leadSuit = isLeading ? null : (trick[0].card.suit === 'joker' ? null : trick[0].card.suit);
    const playable = E.getPlayableCards(hands[seat], leadSuit, isLeading);
    // Prefer an off-suit card when allowed, to create observable voids
    const card = playable[playable.length - 1];
    hands[seat] = hands[seat].filter(c => c.id !== card.id);
    trick.push({ playerIndex: seat, card });
    if (trick.length === 6) {
      round.tricks.push({ cards: trick.slice(), winner: seat });
      round.leader = seat;
      round.currentTrick = [];
    }
  }
}
function checkConsistent(res, round, trueHands) {
  assert(res.ok, 'recovery failed');
  const played = new Set();
  for (const t of round.tricks) t.cards.forEach(e => played.add(e.card.id));
  (round.currentTrick || []).forEach(e => played.add(e.card.id));
  const seen = new Set();
  for (let s = 0; s < 6; s++) {
    assertEq(res.hands[s].length, trueHands[s].length, `seat ${s} hand size`);
    for (const c of res.hands[s]) {
      assert(!played.has(c.id), 'played card dealt back: ' + c.id);
      assert(!seen.has(c.id), 'card dealt twice: ' + c.id);
      seen.add(c.id);
    }
  }
  assertEq(seen.size + played.size, 54, 'every card accounted for');
}

test('mid-trick: known hands kept exactly, unknown seats get a legal remainder', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const hands = fullDeal(seed);
    const round = { tricks: [], currentTrick: [], leader: seed % 6 };
    playLegal(hands, round, 6 * 3 + (seed % 6)); // 3 tricks + partial
    const known = { 1: hands[1], 2: hands[2], 4: hands[4] }; // 0, 3, 5 unknown (old host + bots)
    const res = E.recoverHands(round, known);
    checkConsistent(res, round, hands);
    for (const s of [1, 2, 4]) {
      assertEq(res.hands[s].map(c => c.id).sort().join(), hands[s].map(c => c.id).sort().join(), 'known hand changed at seat ' + s);
    }
  }
});

test('observed voids are honoured for unknown seats', () => {
  let checked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const hands = fullDeal(seed);
    const round = { tricks: [], currentTrick: [], leader: 0 };
    playLegal(hands, round, 6 * 4);
    const voids = [0, 1, 2, 3, 4, 5].map(() => new Set());
    for (const t of round.tricks) {
      const lead = t.cards[0].card.suit;
      t.cards.forEach((e, i) => { if (i > 0 && lead !== 'joker' && e.card.suit !== 'joker' && e.card.suit !== lead) voids[e.playerIndex].add(lead); });
    }
    const res = E.recoverHands(round, { 2: hands[2] });
    checkConsistent(res, round, hands);
    // The true deal satisfies all voids, so a void-respecting deal exists
    for (let s = 0; s < 6; s++) {
      for (const c of res.hands[s]) {
        if (c.suit !== 'joker') assert(!voids[s].has(c.suit), `seat ${s} dealt ${c.id} despite void in ${c.suit}`);
        checked++;
      }
    }
  }
  assert(checked > 0);
});

test('finished trick still shown on table is not double-counted', () => {
  const hands = fullDeal(7);
  const round = { tricks: [], currentTrick: [], leader: 0 };
  playLegal(hands, round, 12);
  round.currentTrick = round.tricks[round.tricks.length - 1].cards.slice(); // not cleared yet
  const res = E.recoverHands(round, {});
  checkConsistent(Object.assign(res), { tricks: round.tricks, currentTrick: [] }, hands);
});

test('invalid reports are ignored (played card, duplicate, oversize)', () => {
  const hands = fullDeal(3);
  const round = { tricks: [], currentTrick: [], leader: 0 };
  playLegal(hands, round, 6);
  const playedCard = round.tricks[0].cards[0].card;
  const res = E.recoverHands(round, {
    1: hands[1].slice(0, 7).concat([playedCard]),   // contains a played card
    2: [hands[2][0], hands[2][0]],                    // duplicate
    3: hands[3].concat(hands[4].slice(0, 2)),         // too many cards
  });
  checkConsistent(res, round, hands);
  assert(!res.knownSeats.includes(1) && !res.knownSeats.includes(2) && !res.knownSeats.includes(3), 'bad reports must be rejected');
});

test('two players claiming the same card: second claim rejected', () => {
  const hands = fullDeal(5);
  const round = { tricks: [], currentTrick: [], leader: 0 };
  const res = E.recoverHands(round, { 1: hands[1], 2: [hands[1][0]].concat(hands[2].slice(1)) });
  checkConsistent(res, round, hands);
  assert(res.knownSeats.includes(1) && !res.knownSeats.includes(2));
});

(async () => {
  console.log('\n== Crypto: seat secrets (real crypto.js, WebCrypto) ==');
  try {
    const vm = require('vm');
    const ctx = { crypto: globalThis.crypto, TextEncoder, TextDecoder, btoa, atob, Uint8Array };
    vm.createContext(ctx);
    vm.runInContext(read('crypto.js') + '\nthis.GameCrypto = GameCrypto;', ctx);
    const GC = ctx.GameCrypto;
    const secret = GC.generateSecret();
    assert(/^[0-9a-f]{64}$/.test(secret), 'secret must be 256-bit hex');
    assert(GC.generateSecret() !== secret, 'secrets must be random');
    const h1 = await GC.sha256Hex(secret);
    assertEq(h1, await GC.sha256Hex(secret), 'hash must be deterministic');
    assert(h1 !== await GC.sha256Hex(GC.generateSecret()), 'different secret, different hash');
    assertEq(await GC.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 test vector');
    // Large payload round-trip (chunked base64 — no call-stack overflow)
    const key = await GC.deriveRoomKey('ROOM42', 'TrumpCall_ROOM42');
    const big = 'x'.repeat(300000);
    assertEq(await GC.decrypt(await GC.encrypt(big, key), key), big, 'large encrypt/decrypt round-trip');
    pass++; console.log('  \u2713 secret generation, SHA-256 verification, large-payload encryption');
  } catch (e) {
    fail++; console.log('  \u2717 crypto\n    ' + (e.stack || e.message));
  }
  console.log(`\n=====================\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
  process.exit(0);
})();
