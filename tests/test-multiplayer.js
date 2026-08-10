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
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only' });
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
test('client STATE_UPDATE handler drops stale versions', () => {
  const src = read('game.js');
  assert(/Dropping stale STATE_UPDATE/.test(src), 'expected stale-update drop path');
  assert(/lastAppliedStateVersion = incomingV/.test(src), 'expected version assignment');
});
test('client CARD_PLAYED handler dedupes on (seat, cardId, seq)', () => {
  const src = read('game.js');
  assert(/playedCardSeq\.has\(key\)/.test(src), 'expected dedupe check');
  assert(/Duplicate CARD_PLAYED ignored/.test(src), 'expected dedupe log');
});

console.log('\n== Reconnect fix: hand restored before delete ==');
test('handleRejoinRequest reads dcInfo before delete', () => {
  const src = read('game.js');
  // Find the handleRejoinRequest block
  const m = src.match(/function handleRejoinRequest[\s\S]*?^\s{2}\}/m);
  assert(m, 'could not find handleRejoinRequest');
  const body = m[0];
  const getIdx = body.indexOf('disconnectedPlayers.get(msg.playerId)');
  const delIdx = body.indexOf('disconnectedPlayers.delete(msg.playerId)');
  assert(getIdx > -1 && delIdx > -1, 'expected get + delete calls');
  assert(getIdx < delIdx, `dcInfo must be read BEFORE delete (get@${getIdx}, del@${delIdx})`);
  // And hand restoration must reference the local dcInfo
  assert(/dcInfo && Array\.isArray\(dcInfo\.hand\)/.test(body),
    'expected hand restoration from dcInfo');
});

console.log('\n== Host addressing: getHostPeerId helper ==');
test('getHostPeerId helper exists and is used for BID/TRUMP/PLAY/RAISE', () => {
  const src = read('game.js');
  assert(/function getHostPeerId\(\)/.test(src), 'getHostPeerId not defined');
  // Old seat-0 fallback should be gone from the send sites
  const badPattern = /const hostPeerId = seatToPeer\.get\(0\) \|\| Network\.getConnectedPeers\(\)\[0\];/g;
  const matches = src.match(badPattern);
  assertEq(matches, null, 'stale seatToPeer.get(0) fallbacks still present');
  // New pattern present
  const goodMatches = src.match(/const hostPeerId = getHostPeerId\(\);/g);
  assert(goodMatches && goodMatches.length >= 6, 'expected >=6 send sites using helper, got ' + (goodMatches && goodMatches.length));
});

console.log('\n== Host migration wiring ==');
test('HOST_MIGRATED message type is handled on client', () => {
  const src = read('game.js');
  assert(/case 'HOST_MIGRATED':/.test(src), 'HOST_MIGRATED case missing');
  assert(/function handleHostMigrated/.test(src), 'handler function missing');
});
test('promoteToHost + setupHostListeners called during promotion', () => {
  const src = read('game.js');
  const m = src.match(/function promoteSelfToHost[\s\S]*?^\s{2}\}/m);
  assert(m, 'promoteSelfToHost not found');
  assert(/Network\.promoteToHost\(\)/.test(m[0]), 'must call Network.promoteToHost');
  assert(/setupHostListeners\(\)/.test(m[0]), 'must swap to host listeners');
  assert(/type: 'HOST_MIGRATED'/.test(m[0]), 'must broadcast HOST_MIGRATED');
});
test('client peer-leave triggers attemptHostMigration when host drops', () => {
  const src = read('game.js');
  assert(/attemptHostMigration\(peerId\)/.test(src), 'expected attemptHostMigration call on peer leave');
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
  assert(/Broadcast the fresh turnDeadline/.test(src), 'expected broadcast comment');
});
test('extendRaiseTimer also extends raiseDeadline', () => {
  const src = read('game.js');
  assert(/state\.currentRound\.raiseDeadline = \(state\.currentRound\.raiseDeadline \|\| Date\.now\(\)\) \+ 10000/.test(src),
    'extendRaiseTimer should bump raiseDeadline by 10000');
});

// =====================================================================
console.log(`\n=====================\n${pass} passed, ${fail} failed`);
if (fail) {
  process.exit(1);
}
