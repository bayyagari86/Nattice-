// ============================================================
// HISTORY — every finished round, saved on this phone only.
//
// What's kept is what the whole table saw: bids, trump, raise, every trick
// in play order and the score. Your own starting hand is simply the cards you
// played. Nothing leaves the phone unless you tap "Share game log".
// ============================================================
const History = (() => {
  const KEY = 'nattis.history.v1';
  const PREF = 'nattis.history.on';
  const MAX = 300; // ~400 bytes a round → about 120 KB at most

  const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
  const put = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (_) { return false; } };
  const getPref = () => { try { return localStorage.getItem(PREF) === 'off' ? 'off' : 'on'; } catch (_) { return 'on'; } };
  const setPref = v => { try { localStorage.setItem(PREF, v === 'off' ? 'off' : 'on'); } catch (_) {} };

  // A_spades → AS, 10_hearts → 10H, jokers → BJ / SJ
  function code(c) {
    if (!c) return '?';
    if (c.id === 'BIG_JOKER') return 'BJ';
    if (c.id === 'SMALL_JOKER') return 'SJ';
    return `${c.rank}${(c.suit || '?')[0].toUpperCase()}`;
  }

  function build(state, mySeat, result, mode) {
    const r = state && state.currentRound;
    if (!r || !Array.isArray(r.tricks) || r.tricks.length !== 9) return null;
    const players = state.players || [];
    return {
      t: Date.now(),
      v: 1,
      mode,                                   // 'solo' | 'online'
      me: mySeat,
      humans: players.map((p, i) => (p && !p.isAI ? i : -1)).filter(i => i >= 0),
      names: players.map(p => (p ? (p.originalName || p.name || '').replace(/ \(Bot\)$/, '') : '')),
      dealer: state.dealer,
      bids: (r.bids || []).map(b => [b.seat, b.bid || 0]),
      bidder: r.bidder,
      bid: r.bid,
      team: r.biddingTeam,
      trump: r.trumpSuit,
      raised: !!r.raised,
      tricks: r.tricks.map(t => [t.cards[0] ? t.cards[0].playerIndex : -1, t.cards.map(cp => code(cp.card)).join(' '), t.winner]),
      taken: { ...(result.tricksTaken || r.tricksTaken || {}) },
      score: { ...(result.scoreChange || {}) },
      total: { ...(result.totalScores || state.scores || {}) },
      ls: !!result.ls, gs: !!result.gs,
    };
  }

  const keyOf = e => `${e.bid}|${e.trump}|${e.tricks.map(t => t[1]).join('/')}`;

  // Called when the round result shows. The last trick can arrive a moment
  // after the result on joined phones, so wait for all 9 tricks.
  function record(result, tries = 0) {
    if (getPref() === 'off' || typeof Game === 'undefined') return;
    const state = Game.getState && Game.getState();
    const mode = Game.isSolo && Game.isSolo() ? 'solo' : 'online';
    const e = build(state, Game.getMySeat(), result || {}, mode);
    if (!e) { if (tries < 4) setTimeout(() => record(result, tries + 1), 700); return; }
    const list = get();
    const k = keyOf(e);
    if (list.some(x => keyOf(x) === k)) return; // same round shown again (rejoin)
    list.push(e);
    while (list.length > MAX) list.shift();
    if (!put(list)) { list.splice(0, 50); put(list); }
  }

  // Quick summary for Settings
  function summary() {
    const list = get();
    if (!list.length) return { rounds: 0 };
    const team = s => (s % 2 === 0 ? 'A' : 'B');
    let myBids = 0, myMade = 0, teamBids = 0, teamMade = 0;
    for (const e of list) {
      const mine = team(e.me);
      const made = (e.score[e.team] || 0) > 0;
      if (e.team === mine) { teamBids++; if (made) teamMade++; }
      if (e.bidder === e.me) { myBids++; if (made) myMade++; }
    }
    return { rounds: list.length, since: list[0].t, myBids, myMade, teamBids, teamMade };
  }

  async function share() {
    const list = get();
    const data = JSON.stringify({ app: 'Nattis', version: 1, exported: new Date().toISOString(), rounds: list });
    const name = `nattis-history-${new Date().toISOString().slice(0, 10)}.json`;
    try {
      const file = new File([data], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Nattis game log' });
        return 'shared';
      }
    } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'downloaded';
  }

  function clear() { put([]); }

  return { record, get, summary, share, clear, getPref, setPref, _build: build };
})();
