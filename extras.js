// ============================================================
// EXTRAS — festival/table themes, card decks, WhatsApp sharing,
// and animated Odia reactions. Pure presentation: nothing here
// touches game rules or network state.
// ============================================================

const Extras = (() => {
  // ---------- Themes ----------
  // Festival windows are local dates (inclusive). Auto mode picks the
  // festival whose window contains today, otherwise Classic.
  // Dates: odiacalendar.com (2026), dekhopanchang.com Odia calendar (2027),
  // drikpanchang (Rath Yatra), timeanddate (Holi, Vasant Panchami),
  // officeholidays/bhaktibharat (Nuakhai — sources differ by a day, window covers both).
  const FESTIVALS = [
    { theme: 'dussehra',  from: '2026-10-10', to: '2026-10-22' , day: '2026-10-20' }, // Durga Puja 18 Oct → Dussehra 20 Oct 2026
    { theme: 'kumar',     from: '2026-10-23', to: '2026-10-27' , day: '2026-10-25' }, // Kumar Purnima 25 Oct 2026
    { theme: 'diwali',    from: '2026-11-05', to: '2026-11-10' , day: '2026-11-08' }, // Diwali 8 Nov 2026
    { theme: 'boita',     from: '2026-11-21', to: '2026-12-01' , day: '2026-11-24' }, // Kartika Purnima · Boita Bandana · Bali Jatra 24 Nov 2026
    { theme: 'makar',     from: '2027-01-12', to: '2027-01-16' , day: '2027-01-14' }, // Makar Sankranti 14 Jan 2027
    { theme: 'saraswati', from: '2027-02-09', to: '2027-02-12' , day: '2027-02-11' }, // Saraswati Puja 11 Feb 2027
    { theme: 'dola',      from: '2027-03-19', to: '2027-03-23' , day: '2027-03-22' }, // Dola Purnima / Holi 22 Mar 2027
    { theme: 'utkal',     from: '2027-03-30', to: '2027-04-02' , day: '2027-04-01' }, // Utkal Divas 1 Apr
    { theme: 'pana',      from: '2027-04-12', to: '2027-04-15' , day: '2027-04-14' }, // Pana Sankranti (Odia New Year) 14 Apr 2027
    { theme: 'raja',      from: '2027-06-13', to: '2027-06-17' , day: '2027-06-14' }, // Raja Parba 14–16 Jun 2027
    { theme: 'rath',      from: '2027-07-03', to: '2027-07-16' , day: '2027-07-05' }, // Rath Yatra 5 Jul → Niladri Bije 16 Jul 2027
    { theme: 'nuakhai',   from: '2027-09-03', to: '2027-09-07' , day: '2027-09-05' }, // Nuakhai 4/5 Sep 2027
    { theme: 'dussehra',  from: '2027-10-02', to: '2027-10-11' , day: '2027-10-09' }, // Dussehra 9 Oct 2027
    { theme: 'kumar',     from: '2027-10-12', to: '2027-10-16' , day: '2027-10-14' }, // Kumar Purnima 14 Oct 2027
    { theme: 'diwali',    from: '2027-10-26', to: '2027-10-31' , day: '2027-10-29' }, // Diwali 29 Oct 2027
    { theme: 'boita',     from: '2027-11-11', to: '2027-11-21' , day: '2027-11-14' }, // Kartika Purnima 14 Nov 2027
  ];

  // art: illustrated scene in assets/themes/<art>_p.webp (upright) and _l.webp (wide).
  // mat: colours of the cloth/mat drawn in perspective under the cards.
  // fx: ambient particles. bg: scorecard / reel colours.
  const TABLE_THEMES = {
    classic:  { label: 'Classic', sub: 'Green felt', swatch: 'linear-gradient(135deg,#1f7a3c,#0a3318)', bg: ['#1f7a3c', '#0a3318'] },
    chaupal:  { label: 'Village Chaupal', sub: 'Banyan tree · dusk falls as you play', art: 'chaupal_day', night: 'chaupal_night', thumb: 'chaupal',
                mat: ['#c8955a', '#7a4c22', '#5a3414'], fx: 'motes', bg: ['#e9934a', '#2a1a0c'] },
    dussehra: { label: 'Durga Puja', sub: 'Dussehra · silver filigree', art: 'dussehra', fest: true, emoji: '🪔',
                greeting: 'ଶୁଭ ଦଶହରା', greetingEn: 'Happy Dussehra', mat: ['#9b1c1c', '#5e0d12', '#e3a43a'], fx: 'embers', bg: ['#9b1c1c', '#3a0709'] },
    kumar:    { label: 'Kumar Purnima', sub: 'Full-moon night', art: 'kumar', fest: true, emoji: '🌕',
                greeting: 'ଶୁଭ କୁମାର ପୂର୍ଣ୍ଣିମା', greetingEn: 'Happy Kumar Purnima', mat: ['#26357a', '#141c4d', '#e8ecff'], fx: 'stars', bg: ['#2b3a7a', '#0b1033'] },
    diwali:   { label: 'Diwali', sub: 'Diyas & kaunria kathi', art: 'diwali', fest: true, emoji: '🪔',
                greeting: 'ଶୁଭ ଦୀପାବଳି', greetingEn: 'Happy Diwali', mat: ['#7a2e0e', '#3d1406', '#f59e0b'], fx: 'embers', bg: ['#b45309', '#1c0a03'] },
    boita:    { label: 'Boita Bandana', sub: 'Kartika Purnima · Bali Jatra', art: 'boita', fest: true, emoji: '⛵',
                greeting: 'ଆ କା ମା ବୈ!', greetingEn: 'Happy Boita Bandana', mat: ['#8a5a2e', '#4a2d14', '#f6c453'], fx: 'glints', bg: ['#1d4e89', '#0a1630'] },
    makar:    { label: 'Makar Sankranti', sub: 'Kites & makara chaula', art: 'makar', fest: true, emoji: '🪁',
                greeting: 'ଶୁଭ ମକର ସଂକ୍ରାନ୍ତି', greetingEn: 'Happy Makar Sankranti', mat: ['#d9a441', '#8a5a1c', '#fff1c2'], fx: 'motes', bg: ['#e0a83a', '#3a2408'] },
    saraswati:{ label: 'Saraswati Puja', sub: 'Basanta Panchami', art: 'saraswati', fest: true, emoji: '📚',
                greeting: 'ଶୁଭ ସରସ୍ୱତୀ ପୂଜା', greetingEn: 'Happy Saraswati Puja', mat: ['#f2c230', '#b58410', '#fff6c8'], fx: 'motes', bg: ['#e8b81e', '#3a2a05'] },
    dola:     { label: 'Dola Purnima', sub: 'Colours & palanquins', art: 'dola', fest: true, emoji: '🌈',
                greeting: 'ଶୁଭ ଦୋଳ ପୂର୍ଣ୍ଣିମା', greetingEn: 'Happy Dola Purnima', mat: ['#c0267a', '#6a1046', '#ffd166'], fx: 'colours', bg: ['#c0267a', '#2a0820'] },
    utkal:    { label: 'Utkal Divas', sub: 'Odisha Day · Konark', art: 'utkal', fest: true, emoji: '☸️',
                greeting: 'ଶୁଭ ଉତ୍କଳ ଦିବସ', greetingEn: 'Happy Odisha Day', mat: ['#b5652a', '#6b3412', '#2bb3a3'], fx: 'motes', bg: ['#c2702e', '#2a1406'] },
    pana:     { label: 'Pana Sankranti', sub: 'Odia New Year', art: 'pana', fest: true, emoji: '🏺',
                greeting: 'ଶୁଭ ପଣା ସଂକ୍ରାନ୍ତି', greetingEn: 'Happy Odia New Year', mat: ['#b4532a', '#6e2d12', '#f5d29a'], fx: 'motes', bg: ['#c0602e', '#2a1206'] },
    raja:     { label: 'Raja Parba', sub: 'Swings & poda pitha', art: 'raja', fest: true, emoji: '🌿',
                greeting: 'ରଜର ଶୁଭେଚ୍ଛା', greetingEn: 'Happy Raja', mat: ['#2f7d4a', '#174a2a', '#f4a6c0'], fx: 'petals', bg: ['#2f7d4a', '#0a2414'] },
    rath:     { label: 'Rath Yatra', sub: 'Chariots on Bada Danda', art: 'rath', fest: true, emoji: '🛕',
                greeting: 'ଜୟ ଜଗନ୍ନାଥ', greetingEn: 'Jai Jagannath', mat: ['#c81e1e', '#111111', '#f6c400'], fx: 'motes', bg: ['#c81e1e', '#2a0606'] },
    utsav:    { label: 'Odisha Utsav', sub: 'Live video · test', art: 'utsav', video: 'utsav_konark', mat: ['#b5652a', '#6b3412', '#2bb3a3'], fx: null, bg: ['#c2702e', '#2a1406'] },
    nuakhai:  { label: 'Nuakhai', sub: 'New rice harvest', art: 'nuakhai', fest: true, emoji: '🌾',
                greeting: 'ନୂଆଖାଇ ଜୁହାର', greetingEn: 'Nuakhai Juhar', mat: ['#8a1c2b', '#4a0c16', '#f5efe0'], fx: 'motes', bg: ['#8a6a1c', '#1e1606'] },
  };
  for (const [k, t] of Object.entries(TABLE_THEMES)) {
    if (t.art) t.swatch = `url(assets/themes/${t.thumb || t.art}_t.webp) center/cover`;
  }
  function festOrder(theme) {
    const t = todayISO(); const i = FESTIVALS.findIndex(f => f.theme === theme && f.to >= t);
    return i < 0 ? 999 : i;
  }
  function nextDate(theme) {
    const t = todayISO();
    const f = FESTIVALS.find(f => f.theme === theme && f.to >= t);
    if (!f) return '';
    const [, m, d] = (f.day || f.from).split('-').map(Number);
    return `${d} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]}`;
  }
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

  function fxLayer(kind) {
    if (!kind) return '';
    const n = { stars: 26, colours: 9, petals: 12, embers: 14, glints: 12, motes: 16 }[kind] || 12;
    const items = Array.from({ length: n }, (_, i) => {
      const x = (i * 37 + 11) % 96 + 2, y = kind === 'stars' ? (i * 53) % 26 + 2 : (i * 29 + 7) % 70 + 15;
      return `<span class="fx-${kind}" style="left:${x}%;top:${y}%;animation-delay:-${((i * 1.7) % 9).toFixed(1)}s;--i:${i % 5}"></span>`;
    }).join('');
    return `<div class="scene-fx">${items}</div>`;
  }

  // The cloth under the cards, drawn as a trapezoid with lines converging
  // toward the far edge: real perspective without 3D transforms, so every
  // browser renders it the same way.
  const MAT_WEAVE = { chaupal: [30, 16, .22], boita: [11, 0, .55], nuakhai: [13, 8, .32], raja: [13, 8, .26] };
  function matSvg(theme, t) {
    const [a, b, c] = t.mat, [nv, nh, op] = MAT_WEAVE[theme] || [18, 10, .12];
    const T = 13;                                   // top inset (%) — the far edge is narrower
    const lx = y => T * (1 - y / 100);              // left edge x at height y
    const trap = k => { const y0 = k * 1.2, y1 = 100 - k * 1.6, x0 = lx(y0) + k, x1 = lx(y1) + k;
      return `${x0},${y0} ${100 - x0},${y0} ${100 - x1},${y1} ${x1},${y1}`; };
    let lines = '';
    for (let i = 1; i < nv; i++) { const f = i / nv; lines += `M${(T + f * (100 - 2 * T)).toFixed(2)},0 L${(f * 100).toFixed(2)},100 `; }
    for (let k = 1; k < nh; k++) { const y = 100 * Math.pow(k / nh, 1.45); lines += `M${lx(y).toFixed(2)},${y.toFixed(2)} L${(100 - lx(y)).toFixed(2)},${y.toFixed(2)} `; }
    const lineCol = theme === 'boita' ? '#2e1a0a' : c;
    return `<svg class="mat-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="matg-${theme}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b}" stop-opacity=".10"/><stop offset="1" stop-color="${a}" stop-opacity=".30"/></linearGradient></defs>
      <polygon points="${trap(0)}" fill="url(#matg-${theme})"/>
      <path d="${lines}" stroke="${lineCol}" stroke-opacity="${(op * 0.7).toFixed(2)}" stroke-width="1" vector-effect="non-scaling-stroke" fill="none"/>
      <polygon points="${trap(1.4)}" fill="none" stroke="${c}" stroke-opacity=".45" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
      <polygon points="${trap(3)}" fill="none" stroke="${c}" stroke-opacity=".28" stroke-width="1" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
    </svg>`;
  }

  function renderDeco(theme) {
    const el = document.getElementById('theme-deco');
    if (!el) return;
    const t = TABLE_THEMES[theme];
    if (!t || !t.art) { el.innerHTML = ''; el.removeAttribute('style'); delete document.body.dataset.art; return; }
    document.body.dataset.art = t.art;
    const art = n => `url(assets/themes/${n}_p.webp)`, artL = n => `url(assets/themes/${n}_l.webp)`;
    el.style.setProperty('--art-p', art(t.art));
    el.style.setProperty('--art-l', artL(t.art));
    if (t.night) { el.style.setProperty('--night-p', art(t.night)); el.style.setProperty('--night-l', artL(t.night)); }
    const [m1, m2, m3] = t.mat, bs = document.body.style;
    bs.setProperty('--mat-a', m1); bs.setProperty('--mat-b', m2); bs.setProperty('--mat-c', m3);
    const flies = theme === 'chaupal' ? `<div class="flies">${Array.from({ length: 12 }, (_, i) =>
      `<span class="firefly" style="left:${(i * 29 + 7) % 92 + 3}%;top:${(i * 37 + 12) % 46 + 8}%;animation-delay:${(i % 5) * 0.9}s"></span>`).join('')}</div>` : '';
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = navigator.connection && navigator.connection.saveData;
    const upright = !window.matchMedia || matchMedia('(orientation: portrait)').matches;
    const vid = t.video && upright && !reduce && !saveData
      ? `<video class="scene-video" muted playsinline autoplay preload="auto" src="assets/themes/${t.video}.mp4"></video>` : '';
    el.innerHTML = `<div class="scene"><div class="scene-img"></div>${t.night ? '<div class="scene-img scene-night"></div>' : ''}${vid}</div>
      <div class="scene-tint"></div>
      <div class="persp">${matSvg(theme, t)}</div>
      <div class="scene-pool"></div><div class="scene-shade"></div>${fxLayer(t.fx)}${flies}`;
    if (theme === 'chaupal') updateLight(lastLightState);
    const v = el.querySelector('.scene-video');
    if (v) loopWithFade(v);
  }

  // Muted ambient clip that dissolves back into its own first frame (the
  // still behind it) at the end of each pass, so the restart never jumps.
  function loopWithFade(v) {
    v.muted = true; v.defaultMuted = true;
    const play = () => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
    v.addEventListener('playing', () => v.classList.add('on'));
    v.addEventListener('timeupdate', () => { if (v.duration && v.currentTime > v.duration - 1.1) v.classList.remove('on'); });
    v.addEventListener('ended', () => setTimeout(() => { v.currentTime = 0; play(); }, 900));
    document.addEventListener('visibilitychange', () => { if (!v.isConnected) return; document.hidden ? v.pause() : play(); });
    play();
  }

  // ---------- Chaupal evening light ----------
  // Dusk deepens with game progress: golden afternoon -> sunset -> dusk -> night
  // over roughly four rounds (36 tricks), then stays night.
  const SKY_STOPS = [
    [0.00, [255, 214, 130]], [0.35, [255, 150, 80]], [0.65, [150, 78, 140]], [1.00, [24, 32, 80]],
  ];
  let lastLightState = null;
  function lerp(a, b, t) { return a + (b - a) * t; }
  function skyAt(p) {
    for (let i = 1; i < SKY_STOPS.length; i++) {
      const [p1, c1] = SKY_STOPS[i], [p0, c0] = SKY_STOPS[i - 1];
      if (p <= p1) { const t = (p - p0) / (p1 - p0); return c0.map((v, k) => Math.round(lerp(v, c1[k], t))); }
    }
    return SKY_STOPS[SKY_STOPS.length - 1][1];
  }
  function gameProgress(state) {
    if (!state) return 0;
    const rounds = Array.isArray(state.roundHistory) ? state.roundHistory.length : 0;
    const tricks = (state.currentRound && state.currentRound.tricksPlayed) || 0;
    return Math.max(0, Math.min(1, (rounds * 9 + tricks) / 36));
  }
  function updateLight(state) {
    lastLightState = state || lastLightState;
    if (document.body.dataset.theme !== 'chaupal') return;
    const p = typeof window.__duskOverride === 'number' ? window.__duskOverride : gameProgress(lastLightState);
    const [r, g, b] = skyAt(p);
    const s = document.body.style;
    s.setProperty('--dusk', p.toFixed(3));
    s.setProperty('--sky', `rgb(${r},${g},${b})`);
    s.setProperty('--sun-top', `${(4 + p * 46).toFixed(1)}%`);
    s.setProperty('--sun-op', Math.max(0, 1 - p * 1.35).toFixed(2));
    s.setProperty('--moon-op', Math.max(0, (p - 0.62) * 2.6).toFixed(2));
    s.setProperty('--shade', (0.04 + p * 0.5).toFixed(2));
    s.setProperty('--lamp', Math.max(0, Math.min(1, (p - 0.25) * 1.6)).toFixed(2));
    s.setProperty('--fly', Math.max(0, (p - 0.6) * 2.5).toFixed(2));
    s.setProperty('--night', Math.max(0, Math.min(1, (p - 0.3) / 0.55)).toFixed(3));
    s.setProperty('--tint', (Math.sin(Math.min(1, p / 0.7) * Math.PI) * 0.5).toFixed(2));
    document.body.dataset.daypart = p < 0.3 ? 'afternoon' : p < 0.6 ? 'sunset' : p < 0.85 ? 'dusk' : 'night';
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
    showReaction(`${t.greeting} ${t.emoji || '🪔'}`, { style: 'festival' });
  }

  // ---------- Bot speed & names (per device; host's settings drive online bots) ----------
  const LS_SPEED = 'nattis.botSpeed', LS_NAMES = 'nattis.botNames', LS_FRIENDS = 'nattis.friendNames';
  const SPEEDS = {
    fast:    { label: 'Fast',    sub: '1 sec · default', ms: 1000 },
    normal:  { label: 'Normal',  sub: '2 sec',   ms: 2000 },
    relaxed: { label: 'Relaxed', sub: '3.5 sec', ms: 3500 },
    slow:    { label: 'Slow',    sub: '5 sec',   ms: 5000 },
  };
  const NAME_MODES = {
    hostel:  { label: 'Hostel room', sub: 'Random nicknames' },
    friends: { label: 'My friends',  sub: 'Type their names' },
    classic: { label: 'Classic',     sub: 'Arjun, Priya…' },
  };
  const HOSTEL_NAMES = ['Pappu', 'Golu', 'Chintu', 'Bunty', 'Tinku', 'Lambu', 'Chhotu', 'Professor', 'Topper',
    'Bapi', 'Tukuna', 'Babuli', 'Pintu', 'Bulu', 'Raja', 'Netaji', 'Doctor', 'Hero', 'Dada', 'Mama', 'Sirji',
    'Maggi', 'Senior', 'Fresher', 'Warden', 'Bablu', 'Litu', 'Munna', 'Guddu', 'Night Owl'];
  const lsGet = (k, dflt) => { try { const v = localStorage.getItem(k); return v == null ? dflt : v; } catch (_) { return dflt; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  // Tester trial (Oct 2026): 1-second bot play is the default; a saved choice is kept
  const DEFAULT_SPEED = 'fast';
  function getSpeedPref() { const v = lsGet(LS_SPEED, DEFAULT_SPEED); return SPEEDS[v] ? v : DEFAULT_SPEED; }
  function getBotDelayMs() { return SPEEDS[getSpeedPref()].ms; }
  // Raise discussion time after 5 tricks (host's setting drives online games)
  const LS_RAISE = 'nattis.raiseSecs';
  const RAISE_TIMES = { '10': 'Quick', '20': 'Default', '30': 'Relaxed', '45': 'Long' };
  const DEFAULT_RAISE = '20';
  function getRaisePref() { const v = lsGet(LS_RAISE, DEFAULT_RAISE); return RAISE_TIMES[v] ? v : DEFAULT_RAISE; }
  function getRaiseSecs() { return +getRaisePref(); }
  function getNameMode() { const v = lsGet(LS_NAMES, 'hostel'); return NAME_MODES[v] ? v : 'hostel'; }
  function getFriendNames() {
    try { const a = JSON.parse(lsGet(LS_FRIENDS, '[]')); return Array.isArray(a) ? a.map(s => String(s || '').trim().slice(0, 14)) : []; } catch (_) { return []; }
  }
  function shuffled(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  // Returns n bot names, or null for the game's built-in classic names.
  function getBotNames(n, avoid) {
    const mode = getNameMode();
    if (mode === 'classic') return null;
    const taken = new Set((avoid || []).map(s => String(s).toLowerCase()));
    const out = [];
    if (mode === 'friends') {
      for (const f of getFriendNames()) {
        if (out.length >= n) break;
        if (f && !taken.has(f.toLowerCase())) { out.push(f); taken.add(f.toLowerCase()); }
      }
    }
    for (const h of shuffled(HOSTEL_NAMES)) {
      if (out.length >= n) break;
      if (!taken.has(h.toLowerCase())) { out.push(h); taken.add(h.toLowerCase()); }
    }
    return out;
  }
  function renameBotsNow() {
    try { if (typeof Game !== 'undefined' && Game.applyBotNames) Game.applyBotNames(); } catch (_) {}
  }

  function renderSettings() {
    const sp = getSpeedPref();
    const spEl = document.getElementById('speed-options');
    if (spEl) spEl.innerHTML = Object.entries(SPEEDS).map(([k, s]) =>
      `<button class="seg-opt ${sp === k ? 'selected' : ''}" data-speed="${k}"><b>${s.label}</b><small>${s.sub}</small></button>`).join('');
    const rs = getRaisePref();
    const rsEl = document.getElementById('raise-options');
    if (rsEl) rsEl.innerHTML = Object.entries(RAISE_TIMES).map(([k, l]) =>
      `<button class="seg-opt ${rs === k ? 'selected' : ''}" data-raise="${k}"><b>${k} sec</b><small>${l}</small></button>`).join('');
    const nm = getNameMode();
    const nmEl = document.getElementById('botname-options');
    if (nmEl) nmEl.innerHTML = Object.entries(NAME_MODES).map(([k, s]) =>
      `<button class="seg-opt ${nm === k ? 'selected' : ''}" data-names="${k}"><b>${s.label}</b><small>${s.sub}</small></button>`).join('');
    const fr = document.getElementById('friend-names');
    if (fr) {
      fr.style.display = nm === 'friends' ? 'grid' : 'none';
      if (!fr.dataset.built) {
        const saved = getFriendNames();
        fr.innerHTML = [0, 1, 2, 3, 4].map(i =>
          `<input class="friend-input" maxlength="14" autocomplete="off" placeholder="Friend ${i + 1}" value="${escapeHtml(saved[i] || '')}" aria-label="Friend ${i + 1} name">`).join('');
        fr.dataset.built = '1';
        let t = null;
        fr.addEventListener('input', () => {
          lsSet(LS_FRIENDS, JSON.stringify([...fr.querySelectorAll('input')].map(i => i.value.trim())));
          clearTimeout(t); t = setTimeout(renameBotsNow, 500);
        });
      }
    }
    if (typeof Sound !== 'undefined') {
      const seg = (id, opts, cur, set, after) => {
        const el = document.getElementById(id); if (!el) return;
        el.innerHTML = opts.map(([k, l, s]) => `<button class="seg-opt ${cur === k ? 'selected' : ''}" data-v="${k}"><b>${l}</b><small>${s}</small></button>`).join('');
        el.querySelectorAll('.seg-opt').forEach(b => b.onclick = () => { set(b.dataset.v); Sound.unlock(); renderSettings(); if (after) after(b.dataset.v); });
      };
      seg('sfx-options', [['voice', 'Voice + music', 'Phrases spoken'], ['music', 'Music only', 'No voices'], ['off', 'Off', 'Silent']],
        Sound.getSfx(), Sound.setSfx, v => { if (v !== 'off') Sound.sting('celebrate'); });
      seg('host-options', [['or', 'ଓଡ଼ିଆ', 'Odia host'], ['en', 'English', 'English host'], ['off', 'Off', 'No host']],
        Sound.getHost(), Sound.setHost, v => { if (v !== 'off') Sound.host('trump_hearts'); });
      seg('talk-options', [['on', 'On', 'Bots chatter'], ['off', 'Off', 'Quiet bots']], Sound.getTalk(), Sound.setTalk);
    }
    const hEl = document.getElementById('history-options');
    if (hEl && typeof History !== 'undefined') {
      const cur = History.getPref();
      hEl.innerHTML = [['on', 'On', 'Save rounds'], ['off', 'Off', 'Don\'t save']].map(([k, l, s]) =>
        `<button class="seg-opt ${cur === k ? 'selected' : ''}" data-hist="${k}"><b>${l}</b><small>${s}</small></button>`).join('');
      hEl.querySelectorAll('.seg-opt').forEach(b => b.onclick = () => { History.setPref(b.dataset.hist); renderSettings(); });
      const sm = History.summary();
      const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '–');
      const sumEl = document.getElementById('history-summary');
      if (sumEl) sumEl.textContent = sm.rounds
        ? `${sm.rounds} round${sm.rounds === 1 ? '' : 's'} saved since ${new Date(sm.since).toLocaleDateString()}. Your bids made: ${pct(sm.myMade, sm.myBids)} of ${sm.myBids}. Your team's bids made: ${pct(sm.teamMade, sm.teamBids)} of ${sm.teamBids}.`
        : 'No rounds saved yet.';
      const lEl = document.getElementById('history-learned');
      if (lEl && Game.learned) {
        const L = Game.learned();
        const line = (label, x, what) => {
          if (!x || !x.n) return `${label}: no examples yet.`;
          const rate = Math.round((100 * x.made) / x.n);
          if (x.adopted) return `${label}: learned. People here made ${x.made} of ${x.n} (${rate}%), clearly above the ${Math.round(100 * x.need)}% needed to beat the bots' way, so bots now ${what}.`;
          if (x.n < 15) return `${label}: ${x.n} example${x.n === 1 ? '' : 's'} so far (${rate}% made). Needs 15 before it can count.`;
          return `${label}: not learned. ${x.made} of ${x.n} made (${rate}%); it has to be clearly above ${Math.round(100 * x.need)}% to beat the bots' way.`;
        };
        lEl.innerHTML = ['<b>What the bots learned here</b>',
          line('Bolder bids (one above what a bot would bid)', L.bid, 'bid one level higher on hands like these'),
          line('Raising to LS', L.ls, 'raise to LS one trick sooner'),
          line('Raising to GS', L.gs, 'raise to GS one trick sooner')].join('<br>');
      }
      const shareBtn = document.getElementById('history-share-btn');
      const clearBtn = document.getElementById('history-clear-btn');
      if (shareBtn) { shareBtn.disabled = !sm.rounds; shareBtn.onclick = () => History.share().catch(() => {}); }
      if (clearBtn) { clearBtn.disabled = !sm.rounds; clearBtn.onclick = () => { if (confirm('Delete all saved rounds on this phone?')) { History.clear(); renderSettings(); } }; }
    }
    const vEl = document.getElementById('voice-options');
    if (vEl && typeof Voice !== 'undefined') {
      const cur = Voice.getPref();
      vEl.innerHTML = [['on', 'On', 'Hold to talk'], ['off', 'Off', 'No voice']].map(([k, l, s]) =>
        `<button class="seg-opt ${cur === k ? 'selected' : ''}" data-voice="${k}"><b>${l}</b><small>${s}</small></button>`).join('');
      vEl.querySelectorAll('.seg-opt').forEach(b => b.onclick = () => { Voice.setPref(b.dataset.voice); renderSettings(); });
    }
    document.querySelectorAll('#speed-options .seg-opt').forEach(b => b.onclick = () => { lsSet(LS_SPEED, b.dataset.speed); renderSettings(); });
    document.querySelectorAll('#raise-options .seg-opt').forEach(b => b.onclick = () => { lsSet(LS_RAISE, b.dataset.raise); renderSettings(); });
    document.querySelectorAll('#botname-options .seg-opt').forEach(b => b.onclick = () => { lsSet(LS_NAMES, b.dataset.names); renderSettings(); renameBotsNow(); });
  }

  function openThemePicker() {
    renderSettings();
    const overlay = document.getElementById('theme-overlay');
    if (!overlay) return;
    const fest = festivalToday();
    const pref = getThemePref();
    const tableOpts = [['auto', { label: 'Auto', sub: fest ? `${TABLE_THEMES[fest].label} now` : 'Festivals when on',
      swatch: 'conic-gradient(#9b1c1c,#f59e0b,#2b3a7a,#1f7a3c,#9b1c1c)' }],
      ...Object.entries(TABLE_THEMES).filter(([, t]) => !t.fest),
      ...Object.entries(TABLE_THEMES).filter(([, t]) => t.fest)
        .map(([k, t]) => [k, Object.assign({}, t, { sub: fest === k ? 'On now' : (nextDate(k) ? `Next · ${nextDate(k)}` : t.sub) })])
        .sort((a, b) => festOrder(a[0]) - festOrder(b[0]))];
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

  // ---------- Reaction catalogue (bar shows your 6 most recent) ----------
  const REACTIONS = {
    odia: { label: 'ଓଡ଼ିଆ', items: [
      {"id": "o1", "label": "👍 ସହି!", "phrase": "ସହି ବାତ! 👍", "entrance": "nod", "mood": "celebrate"},
      {"id": "o2", "label": "😮 କଣ କଲା ସେ!", "phrase": "କଣ କଲା ସେ! 😮", "entrance": "shock", "mood": "shock"},
      {"id": "o3", "label": "🔥 ଧମାକା!", "phrase": "ଏଇଟା ଧମାକା! 🔥", "entrance": "drumroll", "mood": "celebrate"},
      {"id": "o4", "label": "😂 ଦାଦା!", "phrase": "ଦାଦା, କଣ କଲେ? 😂", "entrance": "laugh", "mood": "tease"},
      {"id": "o5", "label": "🃏 ଜୋକର!", "phrase": "ଜୋକର ଦେବ ନାହିଁ! 🃏", "entrance": "flip", "mood": "tease"},
      {"id": "o6", "label": "😤 ହୁଁ!", "phrase": "ହଁ ହଁ! ହୁଁ! 😤", "entrance": "stomp", "mood": "frustrated"},
      {"id": "o7", "label": "💪 ଜବରଦସ୍ତ!", "phrase": "ଜବରଦସ୍ତ ଖେଳ! 💪", "entrance": "flex", "mood": "celebrate"},
      {"id": "o8", "label": "🤔 କଣ?", "phrase": "ଏଇଟା କଣ କଲ? 🤔", "entrance": "shrug", "mood": "puzzled"},
      {"id": "o9", "label": "😎 ବାପ୍ରେ!", "phrase": "ବାପ୍ରେ ବାପ୍! 😎", "entrance": "swagger", "mood": "brag"},
      {"id": "o10", "label": "🎯 ସଟ୍!", "phrase": "ଏକଦମ୍ ସଟ୍! 🎯", "entrance": "target", "mood": "celebrate"},
      {"id": "o11", "label": "👏 ବାହା!", "phrase": "ବାହା ରେ ବାହା! 👏", "entrance": "clap", "mood": "celebrate"},
      {"id": "o12", "label": "🤝 ସାଥୀ!", "phrase": "ସାଥୀ, ମୋ ସହ ଅଛୁ ତ? 🤝", "entrance": "rise", "mood": "calm"},
      {"id": "o13", "label": "🙄 କି ଚାଲ୍?", "phrase": "ଏଇଟା କି ଚାଲ୍? 🙄", "entrance": "shrug", "mood": "puzzled"},
      {"id": "o14", "label": "😏 ଦେଖିଲୁ?", "phrase": "ଦେଖିଲୁ ନା, କେମିତି ନେଲି! 😏", "entrance": "swagger", "mood": "brag"},
      {"id": "o15", "label": "😱 ଆରେ ବାପା!", "phrase": "ଆରେ ବାପା ରେ! 😱", "entrance": "shock", "mood": "shock"},
    ] },
    village: { label: 'Village taunts', items: [
      {"id": "v1", "label": "☕ ଚା ପିଇ ଆସ!", "phrase": "ଯା, ଚା ପିଇ ଆସ! ☕", "entrance": "steam", "mood": "tease"},
      {"id": "v2", "label": "🙈 ଆଖି ଖୋଲ!", "phrase": "ଆଖି ଖୋଲି ଖେଳ! 🙈", "entrance": "blink", "mood": "tease"},
      {"id": "v3", "label": "🐟 ଖସିଗଲା!", "phrase": "ମାଛ ପରି ଖସିଗଲା! 🐟", "entrance": "slip", "mood": "frustrated"},
      {"id": "v4", "label": "😩 କପାଳ!", "phrase": "କପାଳ ଖରାପ! 😩", "entrance": "slump", "mood": "frustrated"},
      {"id": "v5", "label": "🍀 ଭାଗ୍ୟ!", "phrase": "ତୋ ଭାଗ୍ୟ ଭଲ, ଖେଳ ନୁହେଁ! 🍀", "entrance": "sparkle", "mood": "tease"},
      {"id": "v6", "label": "🏠 ଘରକୁ ଯା!", "phrase": "ଘରକୁ ଯା, ପିଲା! 🏠", "entrance": "shoo", "mood": "tease"},
      {"id": "v7", "label": "🤫 ଚୁପ୍!", "phrase": "ଚୁପ୍ ରହ, ଦେଖ! 🤫", "entrance": "hush", "mood": "tease"},
      {"id": "v8", "label": "💥 ଦମ୍ ଅଛି?", "phrase": "ଦମ୍ ଅଛି ତ ଆ! 💥", "entrance": "stomp", "mood": "brag"},
      {"id": "v9", "label": "😴 ଶୋଇଛୁ?", "phrase": "ଶୋଇଛୁ କି ଖେଳୁଛୁ? 😴", "entrance": "snooze", "mood": "tease"},
      {"id": "v10", "label": "🤦 ପୁଣି ସେଇ!", "phrase": "ପୁଣି ସେଇ ଭୁଲ! 🤦", "entrance": "facepalm", "mood": "frustrated"},
      {"id": "v11", "label": "🧓 ଜେଜେ ଭଲ!", "phrase": "ମୋ ଜେଜେ ତୋଠୁ ଭଲ ଖେଳନ୍ତି! 🧓", "entrance": "wobble", "mood": "tease"},
      {"id": "v12", "label": "🌶️ ମୁଣ୍ଡ ଗରମ!", "phrase": "ମୁଣ୍ଡ ଗରମ କର ନା! 🌶️", "entrance": "boil", "mood": "frustrated"},
      {"id": "v13", "label": "⏳ ଦେଖିବା!", "phrase": "ଆସନ୍ତା ଥର ଦେଖିବା! ⏳", "entrance": "tick", "mood": "brag"},
      {"id": "v14", "label": "🙏 ଦୟା କର!", "phrase": "ଭାଇ, ଟିକେ ଦୟା କର! 🙏", "entrance": "plead", "mood": "frustrated"},
      {"id": "v15", "label": "🃏 ଟ୍ରମ୍ପ କାହିଁ?", "phrase": "ଟ୍ରମ୍ପ କାହିଁ ଲୁଚାଇଛୁ? 🃏", "entrance": "search", "mood": "puzzled"},
      {"id": "v16", "label": "👀 ଚୋରି!", "phrase": "ଚୋରି ଚୋରି ଦେଖୁଛୁ କି? 👀", "entrance": "peek", "mood": "tease"},
      {"id": "v17", "label": "🧑‍🏫 କିଏ ଶିଖାଇଲା?", "phrase": "କିଏ ଶିଖାଇଲା ତତେ ଖେଳିବା? 🧑‍🏫", "entrance": "facepalm", "mood": "tease"},
      {"id": "v18", "label": "🃏 ତାସ୍ ଧର!", "phrase": "ଆଗ ତାସ୍ ଧରିବା ଶିଖ! 🃏", "entrance": "wobble", "mood": "tease"},
      {"id": "v19", "label": "⚔️ ମହାରଥୀ!", "phrase": "ବାହା ମହାରଥୀ, ବାହା! ⚔️", "entrance": "swagger", "mood": "tease"},
    ] },
    english: { label: 'English', items: [
      {"id": "e1", "label": "👏 Well played", "phrase": "Well played! 👏", "entrance": "clap", "mood": "celebrate"},
      {"id": "e16", "label": "😮 What?!", "phrase": "What did he just do?! 😮", "entrance": "shock", "mood": "shock"},
      {"id": "e2", "label": "☕ Chai break?", "phrase": "Go have some chai! ☕", "entrance": "steam", "mood": "tease"},
      {"id": "e3", "label": "👵 Grandma", "phrase": "My grandma plays better! 👵", "entrance": "wobble", "mood": "tease"},
      {"id": "e4", "label": "😴 Wake up", "phrase": "Sleeping or playing? 😴", "entrance": "snooze", "mood": "tease"},
      {"id": "e5", "label": "🍀 Lucky", "phrase": "Pure luck, no skill! 🍀", "entrance": "sparkle", "mood": "tease"},
      {"id": "e6", "label": "🤦 Again?", "phrase": "Same mistake again?! 🤦", "entrance": "facepalm", "mood": "frustrated"},
      {"id": "e7", "label": "⏳ Wait", "phrase": "Wait and watch! ⏳", "entrance": "tick", "mood": "brag"},
      {"id": "e8", "label": "👉 Bas?", "phrase": "Bas? That's all you got? 👉", "entrance": "swagger", "mood": "tease"},
      {"id": "e9", "label": "🐢 Faster", "phrase": "Play fast, yaar! 🐢", "entrance": "snooze", "mood": "frustrated"},
      {"id": "e10", "label": "🧐 Recount", "phrase": "Recount! Something's fishy 🧐", "entrance": "search", "mood": "puzzled"},
      {"id": "e11", "label": "🤝 Partner?", "phrase": "Partner, are you with me? 🤝", "entrance": "rise", "mood": "calm"},
      {"id": "e12", "label": "😭 No crying", "phrase": "Don't cry now! 😭", "entrance": "laugh", "mood": "tease"},
      {"id": "e13", "label": "🔥 Revenge", "phrase": "Revenge next round! 🔥", "entrance": "stomp", "mood": "brag"},
      {"id": "e14", "label": "🙌 Teamwork", "phrase": "That's teamwork! 🙌", "entrance": "flex", "mood": "celebrate"},
      {"id": "e15", "label": "😏 Easy", "phrase": "Too easy! 😏", "entrance": "swagger", "mood": "brag"},
      {"id": "e17", "label": "🧑‍🏫 Who taught you?", "phrase": "Who taught you to play? 🧑‍🏫", "entrance": "facepalm", "mood": "tease"},
    ] },
  };
  const ALL_REACTIONS = Object.values(REACTIONS).flatMap(c => c.items);
  // Old phrases (before the rename) still resolve, so older clients' reactions keep their personality
  const ALIASES = { 'ଏ କି ହେଲା?! 😮': 'o2' };
  function findReaction(phrase) {
    const r = ALL_REACTIONS.find(x => x.phrase === phrase);
    if (r) return r;
    const id = ALIASES[phrase];
    return id ? ALL_REACTIONS.find(x => x.id === id) : null;
  }
  const LS_RECENT = 'nattis.recentReacts';
  const DEFAULT_BAR = ['ସହି ବାତ! 👍', 'କଣ କଲା ସେ! 😮', 'ଏଇଟା ଧମାକା! 🔥', 'ଯା, ଚା ପିଇ ଆସ! ☕', 'କପାଳ ଖରାପ! 😩', 'Well played! 👏'];
  function getBarReactions() {
    let recent = [];
    try { recent = JSON.parse(lsGet(LS_RECENT, '[]')); } catch (_) {}
    const list = [...(Array.isArray(recent) ? recent : []), ...DEFAULT_BAR];
    const out = [], seen = new Set();
    for (const ph of list) {
      const r = findReaction(ph);
      if (r && !seen.has(r.phrase)) { out.push(r); seen.add(r.phrase); }
      if (out.length >= 6) break;
    }
    return out;
  }
  function noteReactionUsed(phrase) {
    let recent = [];
    try { recent = JSON.parse(lsGet(LS_RECENT, '[]')); } catch (_) {}
    recent = [phrase, ...(Array.isArray(recent) ? recent : []).filter(p => p !== phrase)].slice(0, 6);
    lsSet(LS_RECENT, JSON.stringify(recent));
  }
  let pickerCb = null, pickerTab = 'village';
  function openReactionPicker(onPick) {
    pickerCb = onPick;
    const ov = document.getElementById('react-overlay');
    if (!ov) return;
    const render = () => {
      ov.querySelector('.rp-tabs').innerHTML = Object.entries(REACTIONS).map(([k, c]) =>
        `<button class="rp-tab ${k === pickerTab ? 'selected' : ''}" data-tab="${k}">${c.label}</button>`).join('');
      ov.querySelector('.rp-grid').innerHTML = REACTIONS[pickerTab].items.map(({ phrase, mood }) =>
        `<button class="rp-item mood-${mood}" data-phrase="${escapeHtml(phrase)}"><span>${escapeHtml(phrase)}</span></button>`).join('');
      ov.querySelectorAll('.rp-tab').forEach(t => t.onclick = () => { pickerTab = t.dataset.tab; render(); });
      ov.querySelectorAll('.rp-item').forEach(b => b.onclick = () => {
        const ph = b.dataset.phrase; closeReactionPicker(); if (pickerCb) pickerCb(ph);
      });
    };
    render();
    ov.classList.add('open');
  }
  function closeReactionPicker() { const ov = document.getElementById('react-overlay'); if (ov) ov.classList.remove('open'); }

  // ---------- Animated Odia reactions ----------
  const STYLES = ['pop', 'bounce', 'swirl', 'wave', 'zoom', 'wobble', 'rise'];
  const PALETTES = [
    ['#ff9a3c', '#ff3d7f'], ['#ffd34d', '#ff7a18'], ['#4ade80', '#22d3ee'],
    ['#c084fc', '#f472b6'], ['#f87171', '#fbbf24'], ['#60a5fa', '#a78bfa'], ['#fde047', '#4ade80'],
  ];
  // Personality entrances (seconds on screen). Slow ones (shrug, snooze, slump) linger on purpose.
  const ENTRANCES = {
    nod: 2.2, shock: 2.2, drumroll: 2.8, laugh: 2.4, flip: 2.4, stomp: 2.3, flex: 2.4, shrug: 3.2,
    swagger: 2.6, target: 2.2, clap: 2.4, rise: 2.6, steam: 3.0, blink: 2.4, slip: 2.6, slump: 3.2,
    sparkle: 2.6, shoo: 2.4, hush: 2.8, snooze: 3.4, facepalm: 2.8, wobble: 2.6, boil: 2.6, tick: 2.8,
    plead: 3.0, search: 2.8, peek: 2.6,
  };
  const MOOD_PALETTES = {
    celebrate: ['#ffd34d', '#ff7a18'], shock: ['#fde047', '#f43f5e'], tease: ['#f472b6', '#a78bfa'],
    frustrated: ['#94a3b8', '#ef4444'], puzzled: ['#5eead4', '#60a5fa'], brag: ['#fbbf24', '#c084fc'], calm: ['#86efac', '#38bdf8'],
  };
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
    // Catalogue phrases get their own personality: entrance, mood colours, music and voice
    const entry = opts.style ? null : findReaction(phrase);
    let style = opts.style || (entry && ENTRANCES[entry.entrance] ? 'p-' + entry.entrance : null);
    if (!style) {
      const choices = STYLES.filter(s => s !== lastStyle);
      style = choices[Math.floor(Math.random() * choices.length)];
    }
    lastStyle = style;
    const pal = entry && MOOD_PALETTES[entry.mood];
    const [c1, c2] = pal || PALETTES[Math.floor(Math.random() * PALETTES.length)];
    const duration = style === 'festival' ? 3.6
      : entry && ENTRANCES[entry.entrance] ? ENTRANCES[entry.entrance]
      : (1.9 + Math.random() * 1.3); // varied timing
    if (entry && !opts.silent && typeof Sound !== 'undefined') Sound.reaction(entry, opts.seat);
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
    if (entry) el.dataset.mood = entry.mood; else delete el.dataset.mood;
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

  function loadImg(src) {
    return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; setTimeout(() => res(null), 3000); });
  }
  // Draws a 1080×1350 scorecard image and returns a PNG Blob
  async function drawScorecard(card) {
    const W = 1080, H = 1350;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (_) {}
    const theme = activeTheme();
    const bg = (TABLE_THEMES[theme] && TABLE_THEMES[theme].bg) || ['#1f7a3c', '#082a14'];
    const g = ctx.createRadialGradient(W / 2, H * 0.4, 80, W / 2, H * 0.45, H * 0.8);
    g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const art = TABLE_THEMES[theme] && TABLE_THEMES[theme].art;
    if (art) {
      const img = await loadImg(`assets/themes/${art}_p.webp`);
      if (img) {
        const sc = Math.max(W / img.width, H / img.height), iw = img.width * sc, ih = img.height * sc;
        ctx.drawImage(img, (W - iw) / 2, 0, iw, ih);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, W, H);
      }
    }

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
    const ro = document.getElementById('react-overlay');
    if (ro) ro.addEventListener('click', (e) => { if (e.target === ro || e.target.closest('.rp-close')) closeReactionPicker(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeReactionPicker(); });
    // Re-check the festival at midnight-ish (long sessions)
    setInterval(() => { if (getThemePref() === 'auto') applyTheme(); }, 30 * 60 * 1000);
  }

  return {
    init, applyTheme, activeTheme, festivalToday, themeColors: k => (TABLE_THEMES[k] && TABLE_THEMES[k].bg) || TABLE_THEMES.classic.bg, FESTIVALS, TABLE_THEMES, greetIfFestival, openThemePicker, updateLight, gameProgress,
    getBotDelayMs, getRaiseSecs, getBotNames, getNameMode, getBarReactions, noteReactionUsed, openReactionPicker, closeReactionPicker,
    REACTIONS, findReaction, ALL_REACTIONS,
    showReaction, shareScorecard, drawScorecard, inviteOnWhatsApp,
  };
})();
