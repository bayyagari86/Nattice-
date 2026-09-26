// Multi-tab network resilience E2E.
//
// Three real Chromium browser contexts (separate storage, separate WebRTC
// stacks) play a 6-seat game (3 humans + 3 bots) through a local PeerJS
// broker. Each tab runs an autoplayer that only uses the public Game API, so
// every action travels the same encrypted message path a real player's does.
//
// Scenarios, in order:
//   [A] forged rejoin: a player tries to take another player's seat with a
//       made-up secret — the host must refuse it
//   [B] host crash mid-trick (browser context killed, no unload handlers):
//       a survivor takes over with a higher term, hands stay consistent, the
//       round finishes
//   [C] client refresh mid-round: the tab auto-rejoins into the same seat
//       with the same hand
//   [D] host frozen (backgrounded phone): the other player takes over; when
//       the frozen host wakes it discovers the newer term and steps down —
//       exactly one host afterwards
//
// What this does NOT cover: real NATs, TURN relays, packet loss/jitter,
// mobile OS tab killing. Everything runs over loopback.
//
// Run: npm run test:e2e:resilience   (≈1–2 min)

const H = require('./e2e-harness');

const HTTP_PORT = 8766;
const PEER_PORT = 9001;
const BASE = `http://127.0.0.1:${HTTP_PORT}/index.html?peerHost=127.0.0.1&peerPort=${PEER_PORT}&peerPath=/&testSpeed=0.05`;

let pass = 0, fail = 0;
const pageErrors = [];
function check(cond, msg) {
  if (cond) { pass++; console.log('    \u2713 ' + msg); }
  else { fail++; console.log('    \u2717 ' + msg); }
  return cond;
}
function must(cond, msg) { if (!check(cond, msg)) throw new Error('fatal: ' + msg); }

// ---- page-side autoplayer (runs inside each tab) ----
async function installAutoplay(page) {
  await H.waitFor(page, () => typeof Game !== 'undefined' && typeof Engine !== 'undefined', { label: 'Game loaded' });
  await page.evaluate(() => {
    if (window.__autoplay) clearInterval(window.__autoplay);
    window.__autoplay = setInterval(() => {
      if (window.__autoplayPaused) return;
      const s = Game.getState();
      const me = Game.getMySeat();
      if (!s || !s.currentRound || me == null || me < 0) return;
      const r = s.currentRound;
      try {
        if (s.phase === 'BIDDING' && r.currentBidder === me) {
          Game.makeBid(r.bid === 0 ? 5 : 0);
        } else if (s.phase === 'TRUMP_SELECT' && r.bidder === me) {
          Game.selectTrump(Engine.SUITS[0]);
        } else if (s.phase === 'RAISE_CHECK' && Engine.getTeam(me) === r.biddingTeam) {
          Game.noRaise();
        } else if (s.phase === 'PLAYING' && r.currentPlayer === me) {
          const trick = r.currentTrick || [];
          const isLeading = trick.length === 0;
          const leadSuit = isLeading || trick[0].card.suit === 'joker' ? null : trick[0].card.suit;
          const playable = Engine.getPlayableCards(s.hands[me] || [], leadSuit, isLeading);
          if (playable.length) Game.playCard(playable[0].id);
        }
      } catch (e) { console.warn('[autoplay]', e.message); }
    }, 150);
  });
}

async function snapshot(page) {
  return page.evaluate(() => {
    const s = Game.getState();
    const r = s && s.currentRound;
    return {
      isHost: Network.getIsHost(),
      term: Game.__debug.term(),
      seat: Game.getMySeat(),
      playerId: Game.__debug.playerId(),
      hostPeerId: Game.__debug.hostPeerId(),
      peerId: Network.getPeerId(),
      phase: s && s.phase,
      tricksPlayed: r ? r.tricksPlayed : null,
      trickLen: r && r.currentTrick ? r.currentTrick.length : 0,
      scores: s && s.scores,
      myHand: s && s.hands && Game.getMySeat() >= 0 ? (s.hands[Game.getMySeat()] || []).map(c => c.id).sort() : [],
      allHands: Network.getIsHost() && s && s.hands ? s.hands.map(h => (h || []).map(c => c.id).sort()) : null,
      played: r ? [].concat(...(r.tricks || []).map(t => t.cards.map(e => e.card.id)), (r.currentTrick || []).map(e => e.card.id)) : [],
      players: s && s.players ? s.players.map(p => p && { id: p.id, isAI: !!p.isAI, connected: p.connected !== false, name: p.name }) : [],
      version: s && s.version,
    };
  });
}

// Every human's own hand must equal the host's authoritative copy, no card may
// be in two hands, no played card may be held, and the 54 cards add up.
async function checkHandConsistency(pages, label) {
  // Let in-flight messages settle so we compare a quiescent moment
  for (const p of pages) await p.evaluate(() => { window.__autoplayPaused = true; });
  await H.sleep(1200);
  const snaps = await Promise.all(pages.map(snapshot));
  for (const p of pages) await p.evaluate(() => { window.__autoplayPaused = false; });
  const hosts = snaps.filter(s => s.isHost);
  if (!check(hosts.length === 1, `${label}: exactly one host (${hosts.length})`)) return snaps;
  const host = hosts[0];
  if (!['PLAYING', 'RAISE_CHECK'].includes(host.phase)) {
    check(true, `${label}: (round not in play — phase ${host.phase}, hand check skipped)`);
    return snaps;
  }
  const seen = new Set(host.played);
  let dup = false;
  for (const hand of host.allHands) for (const id of hand) { if (seen.has(id)) dup = true; seen.add(id); }
  check(!dup && seen.size === 54, `${label}: host deal is a partition of the 54 cards (${seen.size})`);
  for (const s of snaps) {
    if (s.isHost) continue;
    check(s.myHand.join() === host.allHands[s.seat].join(),
      `${label}: seat ${s.seat} hand matches the host's copy (${s.myHand.length} cards)`);
  }
  return snaps;
}

async function waitForProgress(page, from, label, timeoutMs = 60000) {
  return H.waitFor(page, (f) => {
    const s = Game.getState();
    if (!s || !s.currentRound) return false;
    const t = s.currentRound.tricksPlayed;
    const sc = s.scores ? s.scores.A + s.scores.B : 0;
    return (t > f.tricks) || sc !== f.score || s.phase === 'ROUND_END' || s.phase === 'GAME_OVER';
  }, { timeoutMs, label, arg: from });
}

async function waitForRoundEnd(page, label, timeoutMs = 90000) {
  const start = await page.evaluate(() => { const s = Game.getState(); return s.scores.A + s.scores.B; });
  return H.waitFor(page, (sc0) => {
    const s = Game.getState();
    return s && (s.phase === 'ROUND_END' || s.phase === 'GAME_OVER' || (s.scores.A + s.scores.B) !== sc0);
  }, { timeoutMs, label, arg: start });
}

async function main() {
  const peerServer = await H.startPeerServer(PEER_PORT);
  const httpServer = await H.startStaticServer(HTTP_PORT);
  const browser = await H.launchBrowser();
  const ctx = {}, page = {};
  try {
    for (const n of ['A', 'B', 'C']) {
      ctx[n] = await browser.createBrowserContext();
      page[n] = await ctx[n].newPage();
      H.tapConsole(page[n], n);
      page[n].on('pageerror', e => pageErrors.push(`${n}: ${e.message}`));
      // `auto=true` only suppresses the UI's auto-rejoin on first load
      await page[n].goto(BASE, { waitUntil: 'domcontentloaded' });
      await H.waitFor(page[n], () => typeof Game !== 'undefined', { label: `${n} loaded` });
    }

    console.log('\n== Setup: A hosts, B and C join, 3 bots fill in');
    const room = await page.A.evaluate(() => Game.hostGame('Alice'));
    await page.B.evaluate((c) => Game.joinGame('Bob', c), room);
    await page.C.evaluate((c) => Game.joinGame('Cara', c), room);
    await H.waitFor(page.A, () => Game.getState().players.filter(p => p && !p.isAI).length === 3, { label: 'host sees 3 humans' });
    must(true, `room ${room} has 3 humans`);

    // ---------------------------------------------------------------
    console.log('\n== [A] Forged rejoin is refused');
    const sB = await snapshot(page.B), sC = await snapshot(page.C);
    await page.B.evaluate((a) => Game.__debug.forgeRejoin(a.host, a.victim), { host: sB.hostPeerId, victim: sC.playerId });
    await H.sleep(1500);
    const afterForge = await snapshot(page.A);
    const cSeat = afterForge.players.findIndex(p => p && p.id === sC.playerId);
    check(cSeat === sC.seat, `victim keeps seat ${sC.seat}`);
    check(afterForge.players.filter(p => p && p.name === 'Impostor').length === 0, 'no seat was renamed to the impostor');
    check((await snapshot(page.C)).seat === sC.seat && (await snapshot(page.B)).seat === sB.seat, 'both players still in their own seats');

    // ---------------------------------------------------------------
    console.log('\n== Start game (autoplay on all tabs)');
    await page.A.evaluate(() => Game.startGame());
    for (const n of ['A', 'B', 'C']) await installAutoplay(page[n]);
    await H.waitFor(page.B, () => {
      const s = Game.getState();
      return s.phase === 'PLAYING' && s.currentRound.tricksPlayed >= 1 && s.currentRound.currentTrick.length >= 1 && s.currentRound.currentTrick.length <= 4;
    }, { timeoutMs: 60000, pollMs: 50, label: 'mid-trick after >=1 trick' });
    await checkHandConsistency([page.A, page.B, page.C], 'before crash');

    // ---------------------------------------------------------------
    console.log('\n== [B] Host crashes mid-trick (context killed, no unload handlers)');
    const pre = await snapshot(page.B);
    await ctx.A.close(); delete page.A;
    const t0 = Date.now();
    await Promise.race([
      H.waitFor(page.B, () => Network.getIsHost() && Game.__debug.term() >= 1 && !Game.__debug.migrating(), { timeoutMs: 40000, label: 'B takes over' }),
      H.waitFor(page.C, () => Network.getIsHost() && Game.__debug.term() >= 1 && !Game.__debug.migrating(), { timeoutMs: 40000, label: 'C takes over' }),
    ]);
    const tookMs = Date.now() - t0;
    await H.sleep(1500);
    const [b1, c1] = await Promise.all([snapshot(page.B), snapshot(page.C)]);
    check([b1, c1].filter(s => s.isHost).length === 1, `exactly one new host after ${tookMs}ms (B=${b1.isHost}, C=${c1.isHost})`);
    check(b1.term === c1.term && b1.term > pre.term, `both agree on the new term ${b1.term} > ${pre.term}`);
    check(b1.tricksPlayed >= pre.tricksPlayed, `trick history kept (${pre.tricksPlayed} → ${b1.tricksPlayed})`);
    await checkHandConsistency([page.B, page.C], 'after migration');
    await waitForProgress(page.C, { tricks: c1.tricksPlayed, score: c1.scores.A + c1.scores.B }, 'play continues after migration');
    check(true, 'play continued under the new host');
    await waitForRoundEnd(page.C, 'round finishes after migration');
    check(true, 'round finished under the new host');

    // ---------------------------------------------------------------
    console.log('\n== [C] Client refreshes mid-round and auto-rejoins');
    const hostName = (await snapshot(page.B)).isHost ? 'B' : 'C';
    const clientName = hostName === 'B' ? 'C' : 'B';
    await H.waitFor(page[hostName], () => {
      const s = Game.getState();
      return s.phase === 'PLAYING' && s.currentRound.tricksPlayed >= 1;
    }, { timeoutMs: 60000, label: 'next round in play' });
    const beforeRefresh = await snapshot(page[clientName]);
    const termBeforeRefresh = (await snapshot(page[hostName])).term;
    await page[clientName].reload({ waitUntil: 'domcontentloaded' });
    await H.waitFor(page[clientName], () => typeof Game !== 'undefined' && Game.getMySeat() >= 0 && Game.getState() && Game.getState().phase !== 'WAITING',
      { timeoutMs: 30000, label: 'refreshed tab rejoined' });
    const afterRefresh = await snapshot(page[clientName]);
    check(afterRefresh.seat === beforeRefresh.seat, `same seat after refresh (${beforeRefresh.seat} → ${afterRefresh.seat})`);
    check(afterRefresh.playerId === beforeRefresh.playerId, 'same player identity after refresh');
    const hostView = await snapshot(page[hostName]);
    check(hostView.players[afterRefresh.seat] && !hostView.players[afterRefresh.seat].isAI, 'host shows the seat as human again (bot handed back)');
    check(hostView.isHost && hostView.term === termBeforeRefresh, `a client refresh causes no host change (term ${termBeforeRefresh} → ${hostView.term})`);
    await installAutoplay(page[clientName]);
    await checkHandConsistency([page.B, page.C], 'after refresh');
    const cur = await snapshot(page[hostName]);
    await waitForProgress(page[clientName], { tricks: cur.tricksPlayed, score: cur.scores.A + cur.scores.B }, 'play continues after refresh');
    check(true, 'play continued after refresh');

    // ---------------------------------------------------------------
    console.log('\n== [D] Host freezes (backgrounded), the other player takes over, frozen host steps down on wake');
    const frozenName = hostName, otherName = clientName;
    const termBefore = (await snapshot(page[frozenName])).term;
    await page[frozenName].evaluate(() => {
      window.__autoplayPaused = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Network.__testFreeze(25000);
    });
    await H.waitFor(page[otherName], (t) => Network.getIsHost() && Game.__debug.term() > t && !Game.__debug.migrating(),
      { timeoutMs: 45000, label: 'other player takes over from frozen host', arg: termBefore });
    check(true, `${otherName} took over while ${frozenName} was frozen`);
    // Wake the frozen host
    await H.sleep(26000);
    await page[frozenName].evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.__autoplayPaused = false;
    });
    await H.waitFor(page[frozenName], () => !Network.getIsHost() && Game.getMySeat() >= 0 && !Game.__debug.reconnecting(),
      { timeoutMs: 45000, label: 'woken host steps down and rejoins' });
    await H.sleep(1500);
    const [fz, ot] = await Promise.all([snapshot(page[frozenName]), snapshot(page[otherName])]);
    check(!fz.isHost && ot.isHost, `exactly one host after wake (${frozenName}=${fz.isHost}, ${otherName}=${ot.isHost})`);
    check(fz.term === ot.term, `terms agree after wake (${fz.term} = ${ot.term})`);
    check(fz.hostPeerId === ot.peerId || fz.hostPeerId === (await page[otherName].evaluate(() => Network.getAliasId && Network.getAliasId())),
      'woken player follows the new host');
    await checkHandConsistency([page.B, page.C], 'after wake');
    const cur2 = await snapshot(page[otherName]);
    await waitForProgress(page[frozenName], { tricks: cur2.tricksPlayed, score: cur2.scores.A + cur2.scores.B }, 'play continues after wake');
    check(true, 'play continued after the split-brain was resolved');

    check(pageErrors.length === 0, `no uncaught page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
  } catch (e) {
    fail++;
    console.log('\nFAILED: ' + (e.stack || e.message));
  } finally {
    for (const n of Object.keys(ctx)) { try { await ctx[n].close(); } catch (_) {} }
    await browser.close();
    httpServer.close();
    H.stopPeerServer(peerServer);
  }
  console.log(`\n=====================\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
