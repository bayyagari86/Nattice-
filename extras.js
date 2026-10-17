// ============================================================
// EXTRAS — festival/table themes, card decks, WhatsApp sharing,
// and animated Odia reactions. Pure presentation: nothing here
// touches game rules or network state.
// ============================================================

const Extras = (() => {
  // ---------- Themes ----------
  // Festival windows are local dates (inclusive). Auto mode picks the
  // festival whose window contains today, otherwise Classic.
  const FESTIVALS = [
    { theme: 'dussehra', from: '2026-10-10', to: '2026-10-22' }, // Durga Puja → Dussehra (20 Oct 2026)
    { theme: 'kumar',    from: '2026-10-23', to: '2026-10-27' }, // Kumar Purnima (25 Oct 2026)
  ];

  const TABLE_THEMES = {
    classic:  { label: 'Classic',       sub: 'Green felt',          swatch: 'linear-gradient(135deg,#1f7a3c,#0a3318)' },
    dussehra: { label: 'Dussehra',      sub: 'Marigold & diyas',    swatch: 'linear-gradient(135deg,#9b1c1c,#4a0a0e)',
                greeting: 'ଶୁଭ ଦଶହରା', greetingEn: 'Happy Dussehra' },
    kumar:    { label: 'Kumar Purnima', sub: 'Full-moon night',     swatch: 'linear-gradient(135deg,#2b3a7a,#0b1033)',
                greeting: 'ଶୁଭ କୁମାର ପୂର୍ଣ୍ଣିମା', greetingEn: 'Happy Kumar Purnima' },
  };
  const DECKS = {
    classic:     { label: 'Classic',     sub: 'Clean white cards' },
    pattachitra: { label: 'Pattachitra', sub: 'Odisha folk-art style' },
  };

  const LS_THEME = 'nattis.theme';   // 'auto' | theme key
  const LS_DECK = 'nattis.deck';

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function festivalToday() {
    const t = todayISO();
    const f = FESTIVALS.find(f => t >= f.from && t <= f.to);
    return f ? f.theme : null;
  }
  function getThemePref() { try { return localStorage.getItem(LS_THEME) || 'auto'; } catch (_) { return 'auto'; } }
  function getDeckPref()  { try { return localStorage.getItem(LS_DECK) || 'classic'; } catch (_) { return 'classic'; } }
  function activeTheme() {
    const pref = getThemePref();
    if (pref === 'auto') return festivalToday() || 'classic';
    return TABLE_THEMES[pref] ? pref : 'classic';
  }

  function renderDeco(theme) {
    const el = document.getElementById('theme-deco');
    if (!el) return;
    if (theme === 'dussehra') {
      const flowers = Array.from({ length: 28 }, (_, i) => `<span class="marigold m${i % 3}"></span>`).join('');
      el.innerHTML = `<div class="garland">${flowers}</div>
        <span class="diya d-tl"></span><span class="diya d-tr"></span>
        <span class="diya d-bl"></span><span class="diya d-br"></span>`;
    } else if (theme === 'kumar') {
      const stars = Array.from({ length: 22 }, (_, i) =>
        `<span class="star" style="left:${(i * 37) % 100}%;top:${(i * 53) % 90}%;animation-delay:${(i % 7) * 0.4}s"></span>`).join('');
      el.innerHTML = `<div class="moon"></div>${stars}`;
    } else {
      el.innerHTML = '';
    }
  }

  function applyTheme() {
    const theme = activeTheme();
    const deck = DECKS[getDeckPref()] ? getDeckPref() : 'classic';
    document.body.dataset.theme = theme;
    document.body.dataset.deck = deck;
    renderDeco(theme);
    return theme;
  }

  // Festive greeting once per session per festival, when a game starts
  let greeted = null;
  function greetIfFestival() {
    const theme = activeTheme();
    const t = TABLE_THEMES[theme];
    if (!t || !t.greeting || greeted === theme) return;
    greeted = theme;
    showReaction(`${t.greeting} ${theme === 'kumar' ? '🌕' : '🪔'}`, { style: 'festival' });
  }

  function openThemePicker() {
    const overlay = document.getElementById('theme-overlay');
    if (!overlay) return;
    const fest = festivalToday();
    const pref = getThemePref();
    const tableOpts = [['auto', { label: 'Auto', sub: fest ? `${TABLE_THEMES[fest].label} now` : 'Festivals when on',
      swatch: 'conic-gradient(#9b1c1c,#f59e0b,#2b3a7a,#1f7a3c,#9b1c1c)' }], ...Object.entries(TABLE_THEMES)];
    document.getElementById('theme-table-options').innerHTML = tableOpts.map(([k, t]) => `
      <button class="theme-opt ${pref === k ? 'selected' : ''}" data-kind="table" data-key="${k}">
        <span class="theme-swatch" style="background:${t.swatch}"></span>
        <span class="theme-label">${t.label}</span><span class="theme-sub">${t.sub}</span>
      </button>`).join('');
    const deckPref = getDeckPref();
    document.getElementById('theme-deck-options').innerHTML = Object.entries(DECKS).map(([k, d]) => `
      <button class="theme-opt ${deckPref === k ? 'selected' : ''}" data-kind="deck" data-key="${k}">
        <span class="deck-preview deck-${k}"><span class="dp-card">A<i>♥</i></span><span class="dp-back"></span></span>
        <span class="theme-label">${d.label}</span><span class="theme-sub">${d.sub}</span>
      </button>`).join('');
    overlay.querySelectorAll('.theme-opt').forEach(btn => btn.addEventListener('click', () => {
      try { localStorage.setItem(btn.dataset.kind === 'table' ? LS_THEME : LS_DECK, btn.dataset.key); } catch (_) {}
      applyTheme();
      openThemePicker(); // re-render selection state
    }));
    overlay.style.display = 'flex';
  }
  function closeThemePicker() {
    const overlay = document.getElementById('theme-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // ---------- Animated Odia reactions ----------
  const STYLES = ['pop', 'bounce', 'swirl', 'wave', 'zoom', 'wobble', 'rise'];
  const PALETTES = [
    ['#ff9a3c', '#ff3d7f'], ['#ffd34d', '#ff7a18'], ['#4ade80', '#22d3ee'],
    ['#c084fc', '#f472b6'], ['#f87171', '#fbbf24'], ['#60a5fa', '#a78bfa'], ['#fde047', '#4ade80'],
  ];
  const EMOJI_RE = /(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/u;
  let lastStyle = null;

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function showReaction(phrase, opts = {}) {
    const el = document.getElementById('center-emoji');
    if (!el || !phrase) return;
    let style = opts.style;
    if (!style) {
      const choices = STYLES.filter(s => s !== lastStyle);
      style = choices[Math.floor(Math.random() * choices.length)];
    }
    lastStyle = style;
    const [c1, c2] = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    const duration = style === 'festival' ? 3.6 : (1.9 + Math.random() * 1.3); // varied timing
    // Split words so the gradient never swallows colour emoji; 'wave' animates word by word.
    const parts = String(phrase).split(EMOJI_RE).filter(Boolean);
    let wordIdx = 0;
    const html = parts.map(p => {
      if (EMOJI_RE.test(p)) return `<span class="rx-emoji">${p}</span>`;
      return p.split(/(\s+)/).map(w => /^\s+$/.test(w) ? w :
        `<span class="rx-word" style="--i:${wordIdx++}">${escapeHtml(w)}</span>`).join('');
    }).join('');
    const who = opts.name ? `<span class="rx-from ${opts.team ? 'team-' + opts.team.toLowerCase() : ''}">${escapeHtml(opts.name)}</span>` : '';
    el.className = 'center-emoji';
    el.style.setProperty('--c1', c1);
    el.style.setProperty('--c2', c2);
    el.style.setProperty('--dur', duration.toFixed(2) + 's');
    el.innerHTML = `<span class="rx-text">${html}</span>${who}`;
    void el.offsetWidth;
    el.classList.add('active', 'rx-' + style);
    clearTimeout(showReaction._t);
    showReaction._t = setTimeout(() => el.classList.remove('active'), duration * 1000 + 50);
  }

  // ---------- WhatsApp sharing ----------
  const SITE = 'https://nattice.vercel.app';

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // Draws a 1080×1350 scorecard image and returns a PNG Blob
  async function drawScorecard(card) {
    const W = 1080, H = 1350;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (_) {}
    const theme = activeTheme();
    const bg = theme === 'dussehra' ? ['#7a1219', '#2a0508'] : theme === 'kumar' ? ['#26357a', '#090d2a'] : ['#1f7a3c', '#082a14'];
    const g = ctx.createRadialGradient(W / 2, H * 0.4, 80, W / 2, H * 0.45, H * 0.8);
    g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // card panel
    ctx.fillStyle = 'rgba(13,18,25,0.88)'; roundedRect(ctx, 70, 150, W - 140, H - 300, 48); ctx.fill();
    ctx.strokeStyle = '#f0c040'; ctx.lineWidth = 4; roundedRect(ctx, 70, 150, W - 140, H - 300, 48); ctx.stroke();

    // logo + brand
    ctx.fillStyle = '#f0c040'; roundedRect(ctx, W / 2 - 50, 70, 100, 100, 24); ctx.fill();
    ctx.fillStyle = '#0a0f1a'; ctx.font = '900 64px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', W / 2, 123);
    ctx.fillStyle = '#f0c040'; ctx.font = '700 40px "Playfair Display", serif'; ctx.fillText('Nattis', W / 2, 225);

    // headline — derived from the actual trick count, from the sharer's point of view
    const bt = card.biddingTeam, took = (card.tricks && card.tricks[bt]) || 0;
    const made = took >= card.bid, ours = bt === card.myTeam;
    const headline = card.headline || (made ? (ours ? 'Bid made!' : 'They made it') : (ours ? 'Bid missed' : 'Bid broken!'));
    const good = made === ours;
    ctx.fillStyle = good ? '#fcd34d' : '#fca5a5';
    ctx.font = '800 92px Inter, sans-serif'; ctx.fillText(headline, W / 2, 335);
    ctx.fillStyle = '#cbd5e1'; ctx.font = '600 38px Inter, sans-serif'; ctx.fillText(card.subtitle, W / 2, 410);

    // team scores
    const teams = [['A', '#7dd3fc', 300], ['B', '#fdba74', W - 300]];
    for (const [t, col, x] of teams) {
      ctx.strokeStyle = col; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(x, 530, 62, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = col; ctx.font = '800 60px Inter, sans-serif'; ctx.fillText(t, x, 532);
      ctx.fillStyle = '#e2e8f0'; ctx.font = '600 34px Inter, sans-serif';
      ctx.fillText(`Team ${t}${card.myTeam === t ? ' (you)' : ''}`, x, 640);
      ctx.fillStyle = col; ctx.font = '800 120px Inter, sans-serif'; ctx.fillText(String(card.scores[t]), x, 750);
      const delta = card.delta[t];
      if (delta > 0) { ctx.fillStyle = '#86efac'; ctx.font = '700 40px Inter, sans-serif'; ctx.fillText(`+${delta}`, x, 840); }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(W / 2, 480); ctx.lineTo(W / 2, 850); ctx.stroke();

    // trick dots
    ctx.fillStyle = '#94a3b8'; ctx.font = '700 30px Inter, sans-serif'; ctx.fillText('TRICKS', W / 2, 920);
    const bidCol = card.biddingTeam === 'A' ? '#7dd3fc' : '#fdba74';
    const defCol = card.biddingTeam === 'A' ? '#fdba74' : '#7dd3fc';
    const won = card.tricks[card.biddingTeam], lost = 9 - won;
    for (let i = 0; i < 9; i++) {
      const x = W / 2 - 4 * 86 + i * 86;
      ctx.fillStyle = i < won ? bidCol : (i >= 9 - lost ? defCol : '#334155');
      ctx.globalAlpha = (i < won || i >= 9 - lost) ? 1 : 0.55;
      ctx.beginPath(); ctx.arc(x, 990, 28, 0, Math.PI * 2); ctx.fill();
      if (i === card.bid - 1) { ctx.globalAlpha = 1; ctx.strokeStyle = '#f0c040'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x, 990, 38, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e2e8f0'; ctx.font = '600 32px Inter, sans-serif';
    ctx.fillText(`Team ${card.biddingTeam} bid ${card.bid} · took ${won}`, W / 2, 1075);

    // festival line + footer
    const t = TABLE_THEMES[theme];
    if (t && t.greeting) { ctx.fillStyle = '#fcd34d'; ctx.font = '700 40px "Noto Sans Oriya", sans-serif'; ctx.fillText(t.greeting, W / 2, 1140); }
    ctx.fillStyle = '#f0c040'; ctx.font = '700 34px Inter, sans-serif'; ctx.fillText('Play Nattis · nattice.vercel.app', W / 2, H - 90);
    return new Promise(res => c.toBlob(res, 'image/png'));
  }

  async function shareScorecard(card) {
    const text = `${card.headline || card.title} — ${card.subtitle}. Team A ${card.scores.A} · Team B ${card.scores.B}. Play Nattis: ${SITE}`;
    try {
      const blob = await drawScorecard(card);
      const file = new File([blob], 'nattis-scorecard.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, title: 'Nattis' });
        return 'shared';
      }
      // Desktop / unsupported: save the image and open WhatsApp with the text
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'nattis-scorecard.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    return 'whatsapp-link';
  }

  function inviteOnWhatsApp(joinUrl, roomCode) {
    const text = `Join my Nattis card game 🃏 Room ${roomCode}: ${joinUrl}`;
    if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
      navigator.share({ text, title: 'Nattis' }).catch(() => {});
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  function init() {
    applyTheme();
    const tb = document.getElementById('theme-toggle');
    if (tb) tb.addEventListener('click', openThemePicker);
    const tt = document.getElementById('title-theme-btn');
    if (tt) tt.addEventListener('click', openThemePicker);
    const close = document.getElementById('theme-close');
    if (close) close.addEventListener('click', closeThemePicker);
    const ov = document.getElementById('theme-overlay');
    if (ov) ov.addEventListener('click', (e) => { if (e.target === ov) closeThemePicker(); });
    // Re-check the festival at midnight-ish (long sessions)
    setInterval(() => { if (getThemePref() === 'auto') applyTheme(); }, 30 * 60 * 1000);
  }

  return {
    init, applyTheme, activeTheme, festivalToday, greetIfFestival, openThemePicker,
    showReaction, shareScorecard, drawScorecard, inviteOnWhatsApp,
  };
})();
