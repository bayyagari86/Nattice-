// ============================================================
// RECAP REEL — a 20-second vertical clip of the round's biggest
// moments (joker slams, trump cuts, last-card steals, the trick
// that decided the bid, and the final trick). Drawn on a canvas,
// recorded in the browser with MediaRecorder, shared as a file.
// ============================================================

const Reel = (() => {
  const W = 540, H = 960, FPS = 30, TOTAL = 20;
  const SUIT = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣', notrump: 'NT' };
  const SUIT_NAME = { spades: 'Spades', hearts: 'Hearts', diamonds: 'Diamonds', clubs: 'Clubs', notrump: 'No trump' };
  const RED = new Set(['hearts', 'diamonds']);
  const BG = {
    classic: ['#1f7a3c', '#0a3318'], dussehra: ['#9b1c1c', '#3a0709'], kumar: ['#2b3a7a', '#0b1033'],
    chaupal: ['#e9934a', '#2a1a0c'],
  };

  // ---------- Snapshot + moments ----------
  function snapshot(result) {
    const st = Game.getState && Game.getState();
    if (!st || !st.currentRound) return null;
    const r = st.currentRound;
    const tricks = (r.tricks || []).map(t => ({ cards: t.cards.map(c => ({ seat: c.playerIndex, card: c.card })), winner: t.winner, winnerTeam: t.winnerTeam }));
    if (!tricks.length) return null;
    return JSON.parse(JSON.stringify({
      round: (st.roundHistory || []).length || 1,
      names: st.players.map(p => (p && p.name) || '—'),
      trump: r.trumpSuit, bid: result.bid, biddingTeam: result.biddingTeam,
      tricksTaken: result.tricksTaken, scores: result.totalScores, delta: result.scoreChange,
      myTeam: Game.getMyTeam ? Game.getMyTeam() : 'A', tricks,
      theme: typeof Extras !== 'undefined' ? Extras.activeTheme() : 'classic',
    }));
  }

  const label = c => c.suit === 'joker' ? (c.rank === 'BIG' ? 'Big Joker' : 'Small Joker') : `${c.rank}${SUIT[c.suit] || ''}`;

  function findMoments(s) {
    const out = [];
    const got = { A: 0, B: 0 };
    const bt = s.biddingTeam, dt = bt === 'A' ? 'B' : 'A';
    let decided = false;
    s.tricks.forEach((t, k) => {
      const seq = t.cards.map(c => ({ playerIndex: c.seat, card: c.card }));
      let best = null;
      let w = seq[0].playerIndex;
      for (let j = 1; j < seq.length; j++) {
        const nw = Engine.determineTrickWinnerRefined(seq.slice(0, j + 1), s.trump);
        const me = seq[j];
        const prevCard = seq.find(c => c.playerIndex === w).card;
        let m = null;
        if (me.card.suit === 'joker') {
          m = { type: 'joker', score: me.card.rank === 'BIG' ? 10 : 8, title: me.card.rank === 'BIG' ? 'BIG JOKER SLAM!' : 'JOKER SLAM!',
            caption: `${s.names[me.playerIndex]} slams the ${label(me.card)}`, voice: me.card.rank === 'BIG' ? 'joker_big' : 'joker_small' };
        } else if (nw === me.playerIndex && nw !== w && s.trump && me.card.suit === s.trump && prevCard.suit !== s.trump && prevCard.suit !== 'joker' && seq[0].card.suit !== s.trump) {
          m = { type: 'cut', score: 6, title: 'TRUMPED!', caption: `${s.names[me.playerIndex]} cuts ${s.names[w]}'s ${label(prevCard)} with ${label(me.card)}`,
            voice: 'trumped', victim: prevCard };
        } else if (j === 5 && nw !== w) {
          m = { type: 'steal', score: 5, title: 'LAST-CARD STEAL!', caption: `${s.names[me.playerIndex]} snatches it with ${label(me.card)}`, victim: prevCard };
        }
        if (m && (!best || m.score > best.score)) best = Object.assign(m, { k, j, seat: me.playerIndex, card: me.card });
        w = nw;
      }
      got[t.winnerTeam]++;
      if (!decided && (got[bt] === s.bid || got[dt] === 9 - s.bid + 1)) {
        decided = true;
        const made = got[bt] === s.bid;
        const wc = t.cards.find(c => c.seat === t.winner).card;
        const m = { type: 'decisive', score: 7, title: made ? 'BID MADE!' : 'BID BROKEN!', caption: `Trick ${k + 1}: ${s.names[t.winner]} seals it with ${label(wc)}`,
          voice: made ? 'bid_made' : 'bid_broken', k, j: t.cards.findIndex(c => c.seat === t.winner), seat: t.winner, card: wc };
        if (!best || m.score + (best.type === 'joker' ? 0 : 2) > best.score) best = Object.assign(m, { score: (best ? best.score : 0) + 7 });
      }
      if (best) out.push(best);
    });
    const last = s.tricks.length - 1;
    return out.filter(m => m.k !== last) // the final scene already shows the last trick
      .sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.k - b.k);
  }

  function timeline(s) {
    const moments = findMoments(s);
    const n = moments.length;
    const md = n ? Math.min(4, 12 / n) : 0;
    const left = 12 - n * md;
    const scenes = [{ kind: 'intro', d: 2.5 }];
    moments.forEach(m => scenes.push({ kind: 'moment', d: md, m }));
    scenes.push({ kind: 'final', d: 3.5 + left * 0.6 });
    scenes.push({ kind: 'outro', d: 2 + left * 0.4 });
    let t = 0; scenes.forEach(sc => { sc.t0 = t; t += sc.d; });
    return scenes;
  }

  // ---------- Drawing ----------
  const ease = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const easeIn = x => Math.pow(Math.min(1, Math.max(0, x)), 2);
  const clamp01 = x => Math.min(1, Math.max(0, x));

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function card(ctx, c, x, y, w, { rot = 0, glow = 0, alpha = 1 } = {}) {
    const h = w * 1.42;
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot);
    if (glow > 0) { ctx.shadowColor = `rgba(253,224,71,${0.9 * glow})`; ctx.shadowBlur = 40 * glow; }
    else { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 6; }
    const joker = c.suit === 'joker';
    if (joker) { const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2); g.addColorStop(0, '#4c1d95'); g.addColorStop(1, c.rank === 'BIG' ? '#b45309' : '#1e3a8a'); ctx.fillStyle = g; }
    else ctx.fillStyle = '#fbfaf5';
    rr(ctx, -w / 2, -h / 2, w, h, w * 0.1); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(2, w * 0.03); ctx.strokeStyle = glow > 0 ? `rgba(253,224,71,${0.5 + 0.5 * glow})` : 'rgba(0,0,0,.15)'; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (joker) {
      ctx.fillStyle = '#fde68a'; ctx.font = `800 ${w * 0.5}px Inter, sans-serif`; ctx.fillText('★', 0, -h * 0.08);
      ctx.font = `800 ${w * 0.15}px Inter, sans-serif`; ctx.fillText(c.rank === 'BIG' ? 'BIG JOKER' : 'JOKER', 0, h * 0.3);
    } else {
      ctx.fillStyle = RED.has(c.suit) ? '#c81e1e' : '#111827';
      ctx.font = `800 ${w * 0.26}px Inter, sans-serif`; ctx.textAlign = 'left'; ctx.fillText(c.rank, -w * 0.4, -h * 0.36);
      ctx.font = `${w * 0.2}px serif`; ctx.fillText(SUIT[c.suit], -w * 0.4, -h * 0.2);
      ctx.textAlign = 'center'; ctx.font = `${w * 0.62}px serif`; ctx.fillText(SUIT[c.suit], 0, h * 0.08);
    }
    ctx.restore();
  }
  function bg(ctx, s, t) {
    const [a, b] = BG[s.theme] || BG.classic;
    const g = ctx.createRadialGradient(W / 2, H * 0.45, 60, W / 2, H * 0.5, H * 0.75);
    g.addColorStop(0, a); g.addColorStop(1, b); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // drifting glints
    ctx.fillStyle = 'rgba(255,230,160,.10)';
    for (let i = 0; i < 18; i++) {
      const x = (i * 97 + t * 14 * (1 + i % 3)) % W, y = (i * 211 + t * 9) % H;
      ctx.beginPath(); ctx.arc(x, y, 2 + (i % 3), 0, Math.PI * 2); ctx.fill();
    }
  }
  function text(ctx, str, x, y, { size = 32, weight = 800, color = '#fff', align = 'center', shadow = true, maxW = W - 60 } = {}) {
    ctx.save(); ctx.textAlign = align; ctx.textBaseline = 'middle';
    let sz = size;
    do { ctx.font = `${weight} ${sz}px Inter, "Noto Sans Oriya", sans-serif`; sz -= 2; } while (ctx.measureText(str).width > maxW && sz > 12);
    if (shadow) { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; }
    ctx.fillStyle = color; ctx.fillText(str, x, y); ctx.restore();
  }
  function footer(ctx) {
    text(ctx, 'NATTIS', W / 2, H - 70, { size: 26, color: '#f0c040' });
    text(ctx, 'nattice.vercel.app', W / 2, H - 40, { size: 17, weight: 600, color: 'rgba(255,255,255,.75)' });
  }
  function teamColor(seat) { return Engine.getTeam(seat) === 'A' ? '#60a5fa' : '#f87171'; }

  function drawIntro(ctx, s, p) {
    text(ctx, `ROUND ${s.round} RECAP`, W / 2, 150, { size: 30, color: '#fde68a' });
    const sc = ease(p * 2.5);
    ctx.save(); ctx.translate(W / 2, 360); ctx.scale(sc, sc);
    const sym = SUIT[s.trump] || '?';
    ctx.beginPath(); ctx.arc(0, 0, 110, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = '#fde68a'; ctx.stroke();
    ctx.fillStyle = RED.has(s.trump) ? '#f87171' : '#f8fafc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${sym === 'NT' ? '800 80px Inter' : '150px serif'}`; ctx.fillText(sym, 0, 8); ctx.restore();
    text(ctx, `Trump: ${SUIT_NAME[s.trump] || '—'}`, W / 2, 520, { size: 34 });
    ctx.globalAlpha = clamp01((p - 0.3) * 3);
    text(ctx, `Team ${s.biddingTeam} bid ${s.bid}`, W / 2, 580, { size: 30, color: s.biddingTeam === 'A' ? '#93c5fd' : '#fca5a5' });
    // fan of six face-down cards
    for (let i = 0; i < 6; i++) {
      const a = (i - 2.5) * 0.16 * ease((p - 0.2) * 2);
      ctx.save(); ctx.translate(W / 2 + Math.sin(a) * 260, 840 - Math.cos(a) * 140); ctx.rotate(a);
      rr(ctx, -34, -48, 68, 96, 8); ctx.fillStyle = '#7f1d1d'; ctx.fill(); ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawMoment(ctx, s, sc, p, fx) {
    const m = sc.m, t = s.tricks[m.k];
    text(ctx, `Trick ${m.k + 1} of ${s.tricks.length}`, W / 2, 110, { size: 22, weight: 700, color: 'rgba(255,255,255,.8)' });
    // earlier cards of this trick, small along the top
    const prior = t.cards.slice(0, m.j);
    const cw = Math.min(70, (W - 80) / Math.max(5, prior.length) - 8);
    prior.forEach((c, i) => {
      const x = W / 2 + (i - (prior.length - 1) / 2) * (cw + 10);
      const isVictim = m.victim && c.card.id === m.victim.id;
      const knock = isVictim ? easeIn((p - 0.32) * 4) : 0;
      card(ctx, c.card, x + knock * 160 * (i % 2 ? 1 : -1), 230 + knock * 120, cw, { rot: knock * 0.9, alpha: 1 - knock * 0.6 });
      text(ctx, s.names[c.seat], x, 300, { size: 13, weight: 700, color: teamColor(c.seat), maxW: cw + 8 });
    });
    // hero card slams in
    const fall = easeIn(p / 0.32);
    const impact = p >= 0.32;
    const y = -200 + fall * 760;
    const bounce = impact ? Math.sin(clamp01((p - 0.32) * 5) * Math.PI) * -20 : 0;
    card(ctx, m.card, W / 2, Math.min(y, 560) + bounce, 190, { rot: (1 - fall) * -0.4, glow: impact ? 0.6 + 0.4 * Math.sin(p * 20) : 0 });
    if (impact && !fx.hit) { fx.hit = true; fx.hitAt = p; fx.parts = burst(W / 2, 560, m.type === 'joker' ? '#fde68a' : '#fca5a5'); }
    if (fx.parts) drawParts(ctx, fx.parts, p - fx.hitAt, sc.d);
    // flash
    if (impact) { const f = 1 - clamp01((p - 0.32) * 6); if (f > 0) { ctx.fillStyle = `rgba(255,255,255,${0.55 * f})`; ctx.fillRect(0, 0, W, H); } }
    // title
    const tp = clamp01((p - 0.3) * 5);
    ctx.save(); ctx.translate(W / 2, 790); const ts = 0.6 + 0.4 * ease(tp) + (tp < 1 ? (1 - tp) * 0.5 : 0); ctx.scale(ts, ts); ctx.globalAlpha = tp;
    text(ctx, m.title, 0, 0, { size: 52, color: m.type === 'joker' ? '#fde047' : m.title.includes('BROKEN') ? '#fca5a5' : '#fef3c7' });
    ctx.restore();
    ctx.globalAlpha = clamp01((p - 0.45) * 4);
    text(ctx, m.caption, W / 2, 850, { size: 22, weight: 700, color: '#e2e8f0' });
    ctx.globalAlpha = 1;
  }

  function drawFinal(ctx, s, p) {
    const t = s.tricks[s.tricks.length - 1];
    text(ctx, s.tricks.length === 9 ? 'THE FINAL TRICK' : `TRICK ${s.tricks.length} · DECIDER`, W / 2, 120, { size: 34, color: '#fde68a' });
    const cx = W / 2, cy = 470, R = 175;
    const per = 0.62 / 6;
    t.cards.forEach((c, i) => {
      const q = ease((p - i * per) / per);
      if (q <= 0) return;
      const a = -Math.PI / 2 + i * (Math.PI * 2 / 6);
      const x = cx + Math.cos(a) * R * q, y = cy + Math.sin(a) * R * q + (1 - q) * 400;
      const isWin = c.seat === t.winner && p > 0.72;
      card(ctx, c.card, x, y, 92, { rot: (1 - q) * 0.6, glow: isWin ? 0.7 + 0.3 * Math.sin(p * 18) : 0, alpha: isWin || p < 0.72 ? 1 : 0.55 });
      text(ctx, s.names[c.seat], x, y + 82, { size: 15, weight: 800, color: teamColor(c.seat), maxW: 120 });
    });
    ctx.globalAlpha = clamp01((p - 0.75) * 5);
    text(ctx, `${s.names[t.winner]} takes it`, W / 2, 790, { size: 36 });
    const jk = t.cards.find(c => c.card.suit === 'joker');
    if (jk) text(ctx, `${s.names[jk.seat]} threw the ${label(jk.card)}!`, W / 2, 840, { size: 22, weight: 700, color: '#fde68a' });
    ctx.globalAlpha = 1;
  }

  function drawOutro(ctx, s, p) {
    const made = (s.tricksTaken[s.biddingTeam] || 0) >= s.bid;
    const sc = 0.7 + 0.3 * ease(p * 3);
    ctx.save(); ctx.translate(W / 2, 260); ctx.scale(sc, sc);
    text(ctx, made ? 'BID MADE!' : 'BID BROKEN!', 0, 0, { size: 62, color: made ? '#86efac' : '#fca5a5' }); ctx.restore();
    text(ctx, `Team ${s.biddingTeam} bid ${s.bid} · took ${s.tricksTaken[s.biddingTeam] || 0}`, W / 2, 350, { size: 26, weight: 700, color: '#e2e8f0' });
    const box = (x, team) => {
      rr(ctx, x - 110, 440, 220, 190, 22); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
      ctx.strokeStyle = team === 'A' ? '#60a5fa' : '#f87171'; ctx.lineWidth = 3; ctx.stroke();
      text(ctx, `Team ${team}${team === s.myTeam ? ' (you)' : ''}`, x, 480, { size: 20, weight: 700, color: team === 'A' ? '#93c5fd' : '#fca5a5', maxW: 200 });
      text(ctx, String(s.scores[team]), x, 545, { size: 64 });
      const d = s.delta[team]; if (d > 0) text(ctx, `+${d}`, x, 600, { size: 22, color: '#86efac' });
    };
    box(W / 2 - 125, 'A'); box(W / 2 + 125, 'B');
    ctx.globalAlpha = clamp01((p - 0.3) * 3);
    text(ctx, 'Play Nattis with your friends', W / 2, 720, { size: 26, weight: 700, color: '#fde68a' });
    ctx.globalAlpha = 1;
  }

  function burst(x, y, color) {
    return Array.from({ length: 40 }, (_, i) => ({ x, y, a: (i / 40) * Math.PI * 2 + Math.random() * 0.3, v: 180 + Math.random() * 320, r: 3 + Math.random() * 5, color: i % 3 ? color : '#ffffff' }));
  }
  function drawParts(ctx, parts, dp, d) {
    const t = dp * d;
    if (t > 1.4) return;
    parts.forEach(q => {
      ctx.globalAlpha = Math.max(0, 1 - t / 1.4);
      ctx.fillStyle = q.color; ctx.beginPath();
      ctx.arc(q.x + Math.cos(q.a) * q.v * t, q.y + Math.sin(q.a) * q.v * t + 200 * t * t, q.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function render(ctx, s, scenes, t, fxs) {
    const i = scenes.findIndex(sc => t >= sc.t0 && t < sc.t0 + sc.d);
    const sc = scenes[i < 0 ? scenes.length - 1 : i];
    const p = clamp01((t - sc.t0) / sc.d);
    bg(ctx, s, t);
    ctx.save();
    // screen shake right after a slam
    const fx = fxs[scenes.indexOf(sc)];
    if (sc.kind === 'moment' && fx.hit) { const k = Math.max(0, 1 - (p - fx.hitAt) * 8); ctx.translate((Math.random() - 0.5) * 16 * k, (Math.random() - 0.5) * 16 * k); }
    if (sc.kind === 'intro') drawIntro(ctx, s, p);
    else if (sc.kind === 'moment') drawMoment(ctx, s, sc, p, fx);
    else if (sc.kind === 'final') drawFinal(ctx, s, p);
    else drawOutro(ctx, s, p);
    ctx.restore();
    // scene fade
    const edge = Math.min(p * sc.d, (1 - p) * sc.d);
    if (edge < 0.18) { ctx.fillStyle = `rgba(0,0,0,${(1 - edge / 0.18) * 0.6})`; ctx.fillRect(0, 0, W, H); }
    footer(ctx);
    // progress line
    ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(30, 26, W - 60, 4);
    ctx.fillStyle = '#f0c040'; ctx.fillRect(30, 26, (W - 60) * Math.min(1, t / TOTAL), 4);
  }

  // Audio cues per scene, scheduled when the recording starts
  function scheduleAudio(s, scenes) {
    if (typeof Sound === 'undefined' || !Sound.canPlay()) return;
    Sound.reelBed(TOTAL);
    scenes.forEach(sc => {
      if (sc.kind === 'intro') { Sound.reelSting('host', sc.t0 + 0.4); Sound.reelVoice('trump_' + (s.trump || 'notrump'), sc.t0 + 0.6); }
      if (sc.kind === 'moment') {
        const at = sc.t0 + sc.d * 0.32;
        Sound.reelSting(sc.m.type === 'joker' ? 'joker' : sc.m.type === 'decisive' ? 'celebrate' : 'shock', at - 0.05);
        if (sc.m.voice) Sound.reelVoice(sc.m.voice, at + 0.35);
      }
      if (sc.kind === 'final') { if (s.tricks.length === 9) Sound.reelVoice('last_trick', sc.t0 + 0.3); Sound.reelSting('drumroll', sc.t0 + sc.d * 0.55); }
      if (sc.kind === 'outro') {
        const made = (s.tricksTaken[s.biddingTeam] || 0) >= s.bid;
        Sound.reelSting(made ? 'celebrate' : 'frustrated', sc.t0 + 0.1);
        Sound.reelVoice(made ? 'bid_made' : 'bid_broken', sc.t0 + 0.5);
      }
    });
  }

  function pickMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    const opts = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4',
      'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return opts.find(m => MediaRecorder.isTypeSupported(m)) || null;
  }

  // Records the reel in real time. onFrame(t) lets the UI show progress.
  function record(s, canvas, onFrame) {
    return new Promise((resolve, reject) => {
      const mime = pickMime();
      if (!mime || !canvas.captureStream) { reject(new Error('Video recording is not supported in this browser')); return; }
      const ctx = canvas.getContext('2d');
      const scenes = timeline(s), fxs = scenes.map(() => ({}));
      const vstream = canvas.captureStream(FPS);
      let astream = null;
      try { if (typeof Sound !== 'undefined') { Sound.unlock(); astream = Sound.startCapture(); } } catch (_) {}
      const tracks = [...vstream.getVideoTracks(), ...(astream ? astream.getAudioTracks() : [])];
      const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 2_500_000 });
      const chunks = [];
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        if (typeof Sound !== 'undefined') Sound.stopCapture();
        resolve({ blob: new Blob(chunks, { type: mime.split(';')[0] }), mime: mime.split(';')[0], scenes });
      };
      render(ctx, s, scenes, 0, fxs);
      rec.start(250);
      scheduleAudio(s, scenes);
      const start = performance.now();
      const tick = () => {
        const t = (performance.now() - start) / 1000;
        render(ctx, s, scenes, Math.min(t, TOTAL - 0.001), fxs);
        if (onFrame) onFrame(t);
        if (t < TOTAL) requestAnimationFrame(tick); else setTimeout(() => rec.stop(), 120);
      };
      requestAnimationFrame(tick);
    });
  }

  // ---------- UI ----------
  function open(result, snap) {
    const s = snap || snapshot(result);
    if (!s) { if (typeof UI !== 'undefined') UI.showToast('No tricks to replay this round'); return; }
    let ov = document.getElementById('reel-overlay');
    if (!ov) { ov = document.createElement('div'); ov.id = 'reel-overlay'; document.body.appendChild(ov); }
    ov.innerHTML = `
      <div class="reel-card" role="dialog" aria-label="Recap reel">
        <button class="reel-close" aria-label="Close">✕</button>
        <h3>Recap reel</h3>
        <canvas width="${W}" height="${H}" class="reel-canvas"></canvas>
        <div class="reel-bar"><span></span></div>
        <p class="reel-status">Making your 20-second reel…</p>
        <div class="reel-actions" hidden>
          <button class="wa-btn reel-share">Share on WhatsApp</button>
          <button class="result-dismiss reel-save">Save video</button>
        </div>
      </div>`;
    ov.style.display = 'flex';
    const close = () => { ov.style.display = 'none'; ov.innerHTML = ''; };
    ov.querySelector('.reel-close').onclick = close;
    const bar = ov.querySelector('.reel-bar span'), status = ov.querySelector('.reel-status');
    record(s, ov.querySelector('.reel-canvas'), t => { bar.style.width = `${Math.min(100, t / TOTAL * 100)}%`; })
      .then(({ blob, mime }) => {
        const ext = mime.includes('mp4') ? 'mp4' : 'webm';
        const file = new File([blob], `nattis-round-${s.round}.${ext}`, { type: mime });
        Reel.last = { blob, mime, size: blob.size };
        status.textContent = `Ready · ${(blob.size / 1024 / 1024).toFixed(1)} MB ${ext.toUpperCase()}`;
        ov.querySelector('.reel-actions').hidden = false;
        const save = () => {
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name;
          document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        };
        ov.querySelector('.reel-save').onclick = save;
        ov.querySelector('.reel-share').onclick = async () => {
          const txt = `Round ${s.round} recap — Team ${s.biddingTeam} bid ${s.bid}. Play Nattis: https://nattice.vercel.app`;
          try {
            if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: txt, title: 'Nattis recap' }); return; }
          } catch (e) { if (e && e.name === 'AbortError') return; }
          save();
          window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank', 'noopener');
          status.textContent = 'Video saved. Attach it in WhatsApp.';
        };
      })
      .catch(err => { status.textContent = err.message || 'Could not make the reel on this device'; });
  }

  return { open, snapshot, findMoments, timeline, render, record, pickMime, last: null };
})();
