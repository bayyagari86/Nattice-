// Capacity E2E: full tables of 6 humans, several rooms at the same time.
//
// Every player is a separate Chromium browser context (own storage, own
// WebRTC stack) running an autoplayer through the public Game API, so all
// traffic takes the real encrypted peer-to-peer path via a local PeerJS
// broker.
//
// Measures per room:
//   - time until all 6 humans are seated
//   - play latency: playCard() → the card appears in my own state
//     (client → host → broadcast → client round trip)
//   - time to finish a full round (9 tricks)
// Checks per room: exactly one host, every hand matches the host's copy,
// rooms stay isolated from each other. Then kills the host of room 1
// mid-trick and checks the 5 survivors recover and finish the round.
//
// Limits: all players share ONE machine (CPU contention makes timings
// pessimistic) over loopback (no internet latency/loss, so network timings
// are optimistic). It proves the protocol holds with 6 humans and several
// concurrent rooms; it does not measure the public PeerJS cloud.
//
// Run: ROOMS=3 npm run test:e2e:capacity

const os = require('os');
const H = require('./e2e-harness');
const { installAutoplay, snapshot, makeHandChecker, waitForRoundEnd } = require('./e2e-game-helpers');

const ROOMS = parseInt(process.env.ROOMS || '3', 10);
const SEATS = 6;
const HTTP_PORT = 8767;
const PEER_PORT = 9002;
const BASE = `http://127.0.0.1:${HTTP_PORT}/index.html?peerHost=127.0.0.1&peerPort=${PEER_PORT}&peerPath=/&testSpeed=0.05`;
const NAMES = ['Ana', 'Ben', 'Cy', 'Dev', 'Eli', 'Fay'];

let pass = 0, fail = 0;
const pageErrors = [];
function check(cond, msg) {
  if (cond) { pass++; console.log('    \u2713 ' + msg); } else { fail++; console.log('    \u2717 ' + msg); }
  return cond;
}
const checkHands = makeHandChecker(check);

// Records playCard → own card visible in state, at ~10ms resolution
async function installLatencyProbe(page) {
  await page.evaluate(() => {
    window.__lat = window.__lat || [];
    if (window.__latProbe) return;
    const orig = Game.playCard;
    let pending = null;
    Game.playCard = function (id) {
      if (!pending) pending = { id, t: performance.now() };
      return orig.apply(this, arguments);
    };
    window.__latProbe = setInterval(() => {
      if (!pending) return;
      const s = Game.getState();
      const r = s && s.currentRound;
      if (!r) return;
      const seen = (r.currentTrick || []).some(e => e.card.id === pending.id) ||
        (r.tricks || []).some(t => t.cards.some(e => e.card.id === pending.id));
      if (seen) { window.__lat.push(performance.now() - pending.t); pending = null; }
      else if (performance.now() - pending.t > 10000) pending = null; // rejected/retried
    }, 10);
  });
}

const pct = (arr, p) => {
  if (!arr.length) return NaN;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))];
};
const fmt = (ms) => (Number.isFinite(ms) ? `${Math.round(ms)}ms` : 'n/a');

async function dumpRoom(room, r) {
  console.log(`    --- room ${r + 1} state dump ---`);
  for (const [i, p] of room.pages.entries()) {
    try {
      console.log('    ' + NAMES[i] + ' ' + JSON.stringify(await p.evaluate(() => {
        const s = Game.getState(); const c = s && s.currentRound;
        return { seat: Game.getMySeat(), host: Network.getIsHost(), term: Game.__debug.term(), phase: s && s.phase,
          bidder: c && c.currentBidder, player: c && c.currentPlayer, bid: c && c.bid, tricks: c && c.tricksPlayed,
          trick: c && c.currentTrick && c.currentTrick.length, hand: s && s.hands && (s.hands[Game.getMySeat()] || []).length,
          peers: Network.getConnectedPeers().length, v: s && s.version, reconnecting: Game.__debug.reconnecting(), migrating: Game.__debug.migrating() };
      })));
    } catch (e) { console.log('    ' + NAMES[i] + ' (dump failed: ' + e.message + ')'); }
  }
}

async function main() {
  console.log(`\n== Capacity: ${ROOMS} rooms × ${SEATS} humans = ${ROOMS * SEATS} browser contexts on ${os.cpus().length} CPU cores`);
  const peerServer = await H.startPeerServer(PEER_PORT);
  const httpServer = await H.startStaticServer(HTTP_PORT);
  const browser = await H.launchBrowser();
  const rooms = []; // { code, pages: [], ctxs: [], metrics }
  try {
    // ---- open all tabs ----
    for (let r = 0; r < ROOMS; r++) {
      const room = { pages: [], ctxs: [], metrics: {} };
      for (let s = 0; s < SEATS; s++) {
        const ctx = await browser.createBrowserContext();
        const page = await ctx.newPage();
        H.tapConsole(page, `R${r + 1}.${NAMES[s]}`, { verbose: false });
        page.on('pageerror', e => pageErrors.push(`R${r + 1}.${NAMES[s]}: ${e.message}`));
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        room.ctxs.push(ctx); room.pages.push(page);
      }
      rooms.push(room);
    }
    for (const room of rooms) for (const p of room.pages) await H.waitFor(p, () => typeof Game !== 'undefined', { label: 'loaded' });

    // ---- all rooms fill up at the same time ----
    console.log('\n== [1] All rooms fill concurrently');
    await Promise.all(rooms.map(async (room, r) => {
      const t0 = Date.now();
      room.code = await room.pages[0].evaluate((n) => Game.hostGame(n), NAMES[0]);
      await Promise.all(room.pages.slice(1).map((p, i) => p.evaluate((a) => Game.joinGame(a.n, a.c), { n: NAMES[i + 1], c: room.code })));
      await H.waitFor(room.pages[0], () => Game.getState().players.filter(p => p && !p.isAI).length === 6,
        { timeoutMs: 60000, label: `room ${r + 1} seats 6 humans` });
      // …and every client has received its SEAT_ASSIGNED
      await Promise.all(room.pages.map(p => H.waitFor(p, () => Game.getMySeat() >= 0, { timeoutMs: 30000, label: 'seated' }).catch(() => {})));
      room.metrics.joinMs = Date.now() - t0;
    }));
    for (const [r, room] of rooms.entries()) {
      const snaps = await Promise.all(room.pages.map(snapshot));
      const seats = new Set(snaps.map(s => s.seat));
      const hostView = snaps.find(s => s.isHost);
      const agree = snaps.every(s => hostView && hostView.players[s.seat] && hostView.players[s.seat].id === s.playerId);
      check(seats.size === 6 && [...seats].every(s => s >= 0 && s < 6) && agree,
        `room ${r + 1} (${room.code}): 6 humans in 6 distinct seats, matching the host, in ${fmt(room.metrics.joinMs)} [seats ${snaps.map(s => s.seat).join(',')}]`);
      check(snaps.filter(s => s.isHost).length === 1, `room ${r + 1}: exactly one host`);
    }
    const allIds = rooms.map(room => new Set());
    for (const [r, room] of rooms.entries()) for (const p of (await snapshot(room.pages[0])).players) if (p) allIds[r].add(p.id);
    let leaked = false;
    for (let a = 0; a < ROOMS; a++) for (let b = a + 1; b < ROOMS; b++) for (const id of allIds[a]) if (allIds[b].has(id)) leaked = true;
    check(!leaked && new Set(rooms.map(r => r.code)).size === ROOMS, 'rooms are isolated (distinct codes, no shared players)');

    // ---- all rooms play a full round at the same time ----
    console.log('\n== [2] All rooms play a full round concurrently');
    for (const room of rooms) {
      for (const p of room.pages) { await installAutoplay(p); await installLatencyProbe(p); }
    }
    await Promise.all(rooms.map(async (room, r) => {
      const t0 = Date.now();
      await room.pages[0].evaluate(() => Game.startGame());
      try {
        await H.waitFor(room.pages[0], () => {
          const s = Game.getState();
          return s && s.phase === 'PLAYING' && s.currentRound.tricksPlayed >= 2 && s.currentRound.currentTrick.length >= 1;
        }, { timeoutMs: 90000, pollMs: 50, label: `room ${r + 1} mid-round` });
      } catch (e) { await dumpRoom(room, r); throw e; }
      await checkHands(room.pages, `room ${r + 1} mid-round`);
      if (r === 0) return; // room 1 gets the host crash below
      await waitForRoundEnd(room.pages[1], `room ${r + 1} round end`, 120000);
      room.metrics.roundMs = Date.now() - t0;
      check(true, `room ${r + 1}: round finished in ${fmt(room.metrics.roundMs)} (incl. deal/bid pacing at testSpeed 0.05)`);
    }));

    // ---- host crash in a full room while the other rooms keep playing ----
    console.log('\n== [3] Room 1 host crashes mid-trick (5 humans survive)');
    const r1 = rooms[0];
    const pre = await snapshot(r1.pages[1]);
    // Everything recorded after this point overlaps the takeover window
    for (const p of r1.pages.slice(1)) await p.evaluate(() => { window.__latMark = (window.__lat || []).length; });
    await r1.ctxs[0].close();
    const survivors = r1.pages.slice(1);
    const t0 = Date.now();
    const deadline = Date.now() + 45000;
    let snaps;
    while (Date.now() < deadline) {
      snaps = await Promise.all(survivors.map(snapshot));
      const hosts = snaps.filter(s => s.isHost);
      if (hosts.length === 1 && snaps.every(s => s.term === hosts[0].term && s.term > pre.term)) break;
      await H.sleep(250);
    }
    const tookMs = Date.now() - t0;
    const hosts = snaps.filter(s => s.isHost);
    check(hosts.length === 1, `one new host among 5 survivors after ${fmt(tookMs)}`);
    check(snaps.every(s => s.term === snaps[0].term && s.term > pre.term), `all 5 agree on term ${snaps[0].term}`);
    await checkHands(survivors, 'room 1 after migration');
    await waitForRoundEnd(survivors[0], 'room 1 round end after migration', 120000);
    check(true, 'room 1: round finished under the new host');

    // ---- latency ----
    console.log('\n== [4] Play latency (playCard → card confirmed by host, per room)');
    for (const [r, room] of rooms.entries()) {
      const pages = r === 0 ? room.pages.slice(1) : room.pages;
      const parts = await Promise.all(pages.map(p => p.evaluate(() => {
        const l = window.__lat || [], m = window.__latMark == null ? l.length : window.__latMark;
        return { normal: l.slice(0, m), takeover: l.slice(m) };
      })));
      // Host's own plays are local (≈0ms) — keep only client round trips
      const clientLat = [].concat(...parts.map(x => x.normal)).filter(x => x > 1);
      const takeLat = [].concat(...parts.map(x => x.takeover)).filter(x => x > 1);
      room.metrics.lat = clientLat;
      console.log(`    room ${r + 1} normal play: n=${clientLat.length}  p50=${fmt(pct(clientLat, 50))}  p95=${fmt(pct(clientLat, 95))}  max=${fmt(pct(clientLat, 100))}`);
      if (takeLat.length) console.log(`    room ${r + 1} after host crash: n=${takeLat.length}  p50=${fmt(pct(takeLat, 50))}  max=${fmt(pct(takeLat, 100))}`);
      check(clientLat.length >= 10 && pct(clientLat, 95) < 1500, `room ${r + 1}: p95 play latency under 1.5s`);
    }

    check(pageErrors.length === 0, `no uncaught page errors${pageErrors.length ? ': ' + pageErrors.slice(0, 5).join(' | ') : ''}`);

    console.log('\n== Summary');
    console.log(JSON.stringify({
      rooms: ROOMS, humansPerRoom: SEATS, contexts: ROOMS * SEATS, cpuCores: os.cpus().length,
      joinMs: rooms.map(r => r.metrics.joinMs),
      roundMs: rooms.map(r => r.metrics.roundMs || null),
      latencyP50: rooms.map(r => Math.round(pct(r.metrics.lat, 50))),
      latencyP95: rooms.map(r => Math.round(pct(r.metrics.lat, 95))),
      migrationMs: tookMs,
    }));
  } catch (e) {
    fail++;
    console.log('\nFAILED: ' + (e.stack || e.message));
  } finally {
    for (const room of rooms) for (const c of room.ctxs) { try { await c.close(); } catch (_) {} }
    await browser.close();
    httpServer.close();
    H.stopPeerServer(peerServer);
  }
  console.log(`\n=====================\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
