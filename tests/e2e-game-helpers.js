// Page-side helpers shared by the game E2E suites.
const H = require('./e2e-harness');

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
function makeHandChecker(check) { return async function checkHandConsistency(pages, label) {
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
}; }

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


module.exports = { installAutoplay, snapshot, makeHandChecker, waitForProgress, waitForRoundEnd };
