// Win celebrations: a random full-screen effect when your team wins a round,
// and a bigger two-effect show when it wins the game. Drawn on one canvas that
// never blocks taps. Respects "reduce motion" (gentle petals only).
//
// Realism notes: physics is time-based (same speed on 60/90/120 Hz screens),
// with gravity, air drag and terminal velocity. Fireworks are real shell types
// (peony, chrysanthemum, willow, ring, crossette) whose stars cool from white-hot
// to colour and glitter as they die. Petals and confetti tumble in 3D and flutter
// as they fall; sky lanterns and balloons have depth (far ones smaller, slower).
const Celebrate = (() => {
  const KINDS = ['fireworks', 'flowers', 'confetti', 'lanterns', 'balloons', 'sparkles'];
  const STAR = {   // firework star colours (r,g,b)
    gold: [255, 190, 80], red: [255, 70, 60], green: [90, 255, 130], blue: [90, 150, 255],
    purple: [190, 110, 255], silver: [235, 240, 255], pink: [255, 110, 190], cyan: [90, 235, 255],
  };
  const STAR_KEYS = Object.keys(STAR);
  const CONF = ['#ffd54f', '#ff7043', '#ec407a', '#ab47bc', '#42a5f5', '#26c6da', '#66bb6a', '#fff176', '#ffffff', '#f4511e'];
  const BALLOON = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#d81b60', '#00acc1'];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let canvas = null, ctx = null, W = 0, H = 0, dpr = 1, raf = 0, last = 0, flashA = 0, flashX = 0, flashY = 0, flashRGB = '255,255,255';
  let parts = [], emitters = [], endAt = 0, lastKind = null, startT = 0;
  const history = [];

  function reduced() { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
  const saver = () => document.body && document.body.classList.contains('saver');
  const amount = () => (saver() ? 0.5 : 1);

  function ensureCanvas() {
    if (canvas && canvas.isConnected) return;
    canvas = document.createElement('canvas');
    canvas.id = 'celebrate-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000;';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }
  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const S = () => clamp(Math.min(W, H) / 400, 0.7, 1.8);   // size scale

  // ---------- pre-drawn sprites (fast: drawImage instead of gradients per particle) ----------
  const sprites = {};
  function glow(rgb) {                       // soft light dot
    const key = 'g' + rgb; if (sprites[key]) return sprites[key];
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(255,255,255,1)`); gr.addColorStop(0.18, `rgba(${rgb},0.95)`);
    gr.addColorStop(0.45, `rgba(${rgb},0.35)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (sprites[key] = c);
  }
  function petal(kind) {                     // shaded petal: marigold, rose or jasmine
    const key = 'p' + kind; if (sprites[key]) return sprites[key];
    const c = document.createElement('canvas'); c.width = 40; c.height = 56;
    const g = c.getContext('2d');
    const col = { marigold: ['#ffb300', '#ef6c00'], saffron: ['#ffd54f', '#ff8f00'], rose: ['#f06292', '#ad1457'], jasmine: ['#fffdf7', '#e8dcc0'] }[kind];
    const gr = g.createLinearGradient(20, 4, 20, 54); gr.addColorStop(0, col[0]); gr.addColorStop(1, col[1]);
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(20, 54);
    g.bezierCurveTo(-4, 38, 2, 6, 20, 3); g.bezierCurveTo(38, 6, 44, 38, 20, 54); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1; g.beginPath(); g.moveTo(20, 50); g.quadraticCurveTo(22, 28, 20, 8); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.ellipse(14, 20, 4, 10, -0.3, 0, 6.283); g.fill();
    return (sprites[key] = c);
  }
  function marigold() {                      // a whole marigold head (genda phool)
    if (sprites.mg) return sprites.mg;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); g.translate(32, 32);
    for (let ring = 3; ring >= 0; ring--) {
      const n = 10 + ring * 4, r = 8 + ring * 6.5;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.283 + ring * 0.4;
        g.save(); g.rotate(a); g.translate(r, 0);
        g.fillStyle = ring % 2 ? '#ff9800' : '#ffb300';
        g.beginPath(); g.ellipse(0, 0, 6.5, 4.2, 0, 0, 6.283); g.fill();
        g.fillStyle = 'rgba(180,60,0,0.25)'; g.beginPath(); g.ellipse(2, 0, 2.5, 3, 0, 0, 6.283); g.fill();
        g.restore();
      }
    }
    g.fillStyle = '#e65100'; g.beginPath(); g.arc(0, 0, 6, 0, 6.283); g.fill();
    return (sprites.mg = c);
  }

  // ---------- effects ----------
  // Fireworks: rockets climb under gravity and burst at the top of their arc
  function launch(big) {
    const s = S(), g = 0.16 * s;
    const x = rnd(W * 0.12, W * 0.88), top = rnd(H * 0.12, H * 0.42);
    const vy = -Math.sqrt(2 * g * (H - top)) * rnd(0.98, 1.03);
    const type = pick(big ? ['peony', 'chrys', 'willow', 'ring', 'crossette', 'peony', 'chrys'] : ['peony', 'chrys', 'willow', 'ring', 'crossette']);
    parts.push({ k: 'rocket', x, y: H + 8, vx: rnd(-0.35, 0.35) * s + (W / 2 - x) * 0.0006, vy, g, type, c: pick(STAR_KEYS), c2: Math.random() < 0.35 ? pick(STAR_KEYS) : null, life: 1, wob: rnd(0, 6.28) });
  }
  function burst(p) {
    const s = S(), n0 = { peony: 90, chrys: 80, willow: 70, ring: 60, crossette: 26 }[p.type];
    const n = Math.round(n0 * amount());
    const speed = { peony: 5.6, chrys: 5.8, willow: 4.6, ring: 5.8, crossette: 4.6 }[p.type] * s * rnd(0.85, 1.15);
    const rgb = STAR[p.type === 'willow' ? 'gold' : p.c], rgb2 = p.c2 ? STAR[p.c2] : rgb;
    const tilt = rnd(-0.9, 0.9), ringFlat = rnd(0.3, 0.6);
    for (let i = 0; i < n; i++) {
      let vx, vy;
      if (p.type === 'ring') {              // a tilted flat ring
        const a = (i / n) * 6.283, cx = Math.cos(a), cy = Math.sin(a) * ringFlat;
        vx = (cx * Math.cos(tilt) - cy * Math.sin(tilt)) * speed; vy = (cx * Math.sin(tilt) + cy * Math.cos(tilt)) * speed;
      } else {                               // a sphere seen from the side: denser in the middle, like the real thing
        const z = rnd(-1, 1), ph = rnd(0, 6.283), r = Math.sqrt(1 - z * z);
        vx = Math.cos(ph) * r * speed; vy = Math.sin(ph) * r * speed;
      }
      const willow = p.type === 'willow';
      parts.push({ k: 'star', x: p.x, y: p.y, vx: vx + p.vx * 0.3, vy: vy + p.vy * 0.2, rgb: (i % 2 && p.c2) ? rgb2 : rgb,
        life: 1, decay: willow ? rnd(0.0045, 0.0065) : rnd(0.0085, 0.0125), drag: willow ? 0.955 : 0.962, g: willow ? 0.028 * s : 0.04 * s,
        tr: [], trLen: willow ? 14 : p.type === 'chrys' ? 9 : 4, glitter: willow || Math.random() < 0.35, split: p.type === 'crossette', size: rnd(0.85, 1.15) });
    }
    flashA = Math.min(0.32, flashA + 0.22); flashX = p.x; flashY = p.y; flashRGB = rgb.join(',');
  }
  function splitStar(p) {                     // crossette: each star breaks into four
    const s = S();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + rnd(-0.2, 0.2) + Math.atan2(p.vy, p.vx), sp = 2.2 * s;
      parts.push({ k: 'star', x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rgb: p.rgb, life: 0.7, decay: rnd(0.012, 0.018),
        drag: 0.96, g: 0.04 * s, tr: [], trLen: 4, glitter: true, split: false, size: 0.8 });
    }
  }

  const FX = {
    fireworks(dur, _g, big) {
      let next = 0, first = true;
      emitters.push({ until: dur - 1500, tick(t) {
        if (t < next) return;
        if (first) { first = false; launch(big); setTimeout(() => { if (raf) launch(big); }, 160); }
        next = t + rnd(big ? 300 : 380, big ? 600 : 760);
        launch(big); if (big && Math.random() < 0.35) launch(big);
      } });
    },
    flowers(dur, gentle) {
      let next = 0, seeded = false; const rate = (gentle ? 230 : 55) / amount();
      emitters.push({ until: dur - 1500, tick(t) {
        // a first handful already partway down, as if thrown from above the screen
        if (!seeded) { seeded = true; if (!gentle) for (let i = 0; i < 16 * amount(); i++) add(rnd(-H * 0.05, H * 0.45)); }
        if (t < next) return; next = t + rate;
        add(-30);
      } });
      function add(y) {
        const s = S(), whole = Math.random() < 0.06;
        parts.push({ k: whole ? 'bloom' : 'petal', sp: whole ? null : pick(['marigold', 'marigold', 'saffron', 'rose', 'rose', 'jasmine']),
          x: rnd(-20, W + 20), y, vx: rnd(-0.3, 0.3), vy: rnd(0.8, 1.4) * s,
          term: (whole ? rnd(3, 3.8) : rnd(1.7, 2.5)) * s * (gentle ? 0.7 : 1),   // terminal fall speed
          ph: rnd(0, 6.28), fs: rnd(0.035, 0.07), amp: rnd(0.5, 1.2) * s,          // flutter
          rot: rnd(0, 6.28), vr: rnd(-0.03, 0.03), flip: rnd(0, 6.28), vf: rnd(0.04, 0.09),
          size: (whole ? rnd(11, 15) : rnd(16, 24)) * s, life: 1 });
      }
    },
    confetti(dur) {
      const s = S();
      const cannon = (x, dir, n) => { for (let i = 0; i < n * amount(); i++) {
        const a = rnd(-1.38, -0.95), sp = rnd(12, 24) * s;           // up and inwards from a bottom corner
        const round = Math.random() < 0.15;
        parts.push({ k: 'conf', x: x + rnd(-6, 6), y: H + 4, vx: Math.cos(a) * sp * dir, vy: Math.sin(a) * sp, c: pick(CONF),
          w: (round ? 7 : rnd(7, 12)) * s, h: (round ? 7 : rnd(4, 6)) * s, round,
          rot: rnd(0, 6.28), vr: rnd(-0.15, 0.15), flip: rnd(0, 6.28), vf: rnd(0.12, 0.3), ph: rnd(0, 6.28),
          term: rnd(1.6, 2.6) * s, life: 1 });
      } };
      cannon(0, 1, 90); cannon(W, -1, 90);
      setTimeout(() => { if (parts.length < 900) { cannon(0, 1, 60); cannon(W, -1, 60); } }, 700);
    },
    lanterns(dur) {
      let next = 0;
      emitters.push({ until: dur - 1800, tick(t) {
        if (t < next) return; next = t + rnd(160, 320) / amount();
        const z = rnd(0.45, 1);                                          // depth: 1 = near
        parts.push({ k: 'lantern', x: rnd(W * 0.04, W * 0.96), y: H + 50, z, vx: rnd(-0.15, 0.15), vy: -rnd(1.6, 2.4) * z * S(),
          ph: rnd(0, 6.28), tilt: 0, size: rnd(20, 28) * z * S(), life: 1 });
        parts.sort((a, b) => (a.z || 1) - (b.z || 1));                   // far ones drawn first
      } });
    },
    balloons(dur) {
      let next = 0;
      emitters.push({ until: dur - 1600, tick(t) {
        if (t < next) return; next = t + rnd(110, 220) / amount();
        const z = rnd(0.55, 1), s = S(), size = rnd(20, 27) * z * s, x = rnd(W * 0.04, W * 0.96), y = H + size * 2;
        const rope = []; for (let i = 0; i < 7; i++) rope.push({ x, y: y + size * 1.15 + i * size * 0.45 });
        parts.push({ k: 'balloon', x, y, z, vx: rnd(-0.2, 0.2), vy: -rnd(0.5, 1), term: rnd(2.1, 3.1) * z * s, ph: rnd(0, 6.28),
          c: pick(BALLOON), size, rope, life: 1 });
        parts.sort((a, b) => (a.z || 1) - (b.z || 1));
      } });
    },
    sparkles(dur) {
      const s = S(), cx = W / 2, cy = H * 0.42;
      const shell = (n, sp) => { for (let i = 0; i < n * amount(); i++) {
        const z = rnd(-1, 1), ph = rnd(0, 6.283), r = Math.sqrt(1 - z * z), v = sp * rnd(0.6, 1.1) * s;
        parts.push({ k: 'glint', x: cx, y: cy, vx: Math.cos(ph) * r * v, vy: Math.sin(ph) * r * v, size: rnd(5, 11) * s,
          rot: rnd(0, 6.28), vr: rnd(-0.08, 0.08), tw: rnd(0, 6.28), life: 1, decay: rnd(0.006, 0.01), g: 0.025 * s });
      } };
      shell(80, 7); setTimeout(() => shell(60, 4.5), 320);
      flashA = 0.25; flashX = cx; flashY = cy; flashRGB = '255,220,140';
      let next = 0;
      emitters.push({ until: dur - 1200, tick(t) {
        if (t < next) return; next = t + 70 / amount();
        if (Math.random() < 0.5) parts.push({ k: 'bokeh', x: rnd(0, W), y: rnd(H * 0.2, H), r: rnd(6, 18) * s, vy: -rnd(0.2, 0.6), life: 1, decay: rnd(0.008, 0.015) });
        parts.push({ k: 'glint', x: rnd(0, W), y: rnd(0, H * 0.85), vx: 0, vy: 0, size: rnd(4, 9) * s, rot: rnd(0, 6.28), vr: 0.03, tw: 0, life: 1, decay: 0.022, g: 0 });
      } });
    },
  };

  // ---------- simulation + drawing ----------
  function drawGlint(x, y, size, rot, a) {     // a 4-point lens flare with a soft core
    ctx.globalAlpha = a;
    ctx.drawImage(glow('255,214,120'), x - size, y - size, size * 2, size * 2);
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.strokeStyle = `rgba(255,248,225,${a})`; ctx.lineWidth = Math.max(1, size * 0.12);
    ctx.beginPath(); ctx.moveTo(-size * 1.6, 0); ctx.lineTo(size * 1.6, 0); ctx.moveTo(0, -size * 1.6); ctx.lineTo(0, size * 1.6); ctx.stroke();
    ctx.restore();
  }

  function step() {
    const now = performance.now(), t = now - startT;
    const dt = clamp((now - last) / 16.667, 0.4, 3); last = now;   // 1 = one 60 Hz frame
    emitters.forEach(e => { if (t < e.until) e.tick(t); });
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    // the sky lights up for a moment when a shell bursts
    if (flashA > 0.01) {
      const r = Math.max(W, H) * 0.7, g = ctx.createRadialGradient(flashX, flashY, 0, flashX, flashY, r);
      g.addColorStop(0, `rgba(${flashRGB},${flashA})`); g.addColorStop(1, `rgba(${flashRGB},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); flashA *= Math.pow(0.86, dt);
    }
    const out = [];
    for (const p of parts) {
      switch (p.k) {
        case 'rocket': {
          p.wob += 0.3 * dt; p.vy += p.g * dt; p.x += (p.vx + Math.sin(p.wob) * 0.15) * dt; p.y += p.vy * dt;
          // sparking tail
          if (Math.random() < 0.9) parts.push({ k: 'ember', x: p.x, y: p.y + 2, vx: rnd(-0.4, 0.4), vy: rnd(0.2, 1.2), life: rnd(0.5, 0.9), decay: rnd(0.03, 0.05) });
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.7;   // small warm head, not a white disc
          ctx.drawImage(glow('255,150,60'), p.x - 4, p.y - 4, 8, 8);
          if (p.vy >= -0.4) { burst(p); p.life = 0; }
          break; }
        case 'ember':
          p.vy += 0.03 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= p.decay * dt;
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(p.life, 0, 1) * (0.6 + Math.random() * 0.4);
          ctx.drawImage(glow('255,170,70'), p.x - 3, p.y - 3, 6, 6);
          break;
        case 'star': {
          const dragK = Math.pow(p.drag, dt);
          p.vx *= dragK; p.vy = p.vy * dragK + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= p.decay * dt;
          p.tr.push(p.x, p.y); if (p.tr.length > p.trLen * 2) p.tr.splice(0, 2);
          if (p.split && p.life < 0.55) { splitStar(p); p.life = 0; break; }
          const L = clamp(p.life, 0, 1);
          // white-hot at first, then its colour, then cooling to dim orange
          const hot = clamp((L - 0.82) / 0.18, 0, 1), cool = clamp((0.35 - L) / 0.35, 0, 1);
          const r = Math.round(p.rgb[0] + (255 - p.rgb[0]) * hot), gg = Math.round((p.rgb[1] + (255 - p.rgb[1]) * hot) * (1 - cool * 0.45)), b = Math.round((p.rgb[2] + (255 - p.rgb[2]) * hot) * (1 - cool * 0.8));
          let a = Math.pow(L, 0.6);
          if (p.glitter && L < 0.45) a *= Math.random() < 0.45 ? 1.4 : 0.15;   // crackling glitter as it dies
          ctx.globalCompositeOperation = 'lighter';
          if (p.tr.length >= 4) {
            ctx.strokeStyle = `rgba(${r},${gg},${b},${clamp(a * 0.45, 0, 1)})`; ctx.lineWidth = 1.6 * p.size * S();
            ctx.beginPath(); ctx.moveTo(p.tr[0], p.tr[1]);
            for (let i = 2; i < p.tr.length; i += 2) ctx.lineTo(p.tr[i], p.tr[i + 1]);
            ctx.stroke();
          }
          const sz = (4 + 3.6 * L) * p.size * S();
          ctx.globalAlpha = clamp(a, 0, 1);
          ctx.drawImage(glow(`${r},${gg},${b}`), p.x - sz, p.y - sz, sz * 2, sz * 2);
          break; }
        case 'petal': case 'bloom': {
          p.ph += p.fs * dt; p.flip += p.vf * dt; p.rot += p.vr * dt;
          const face = Math.cos(p.flip);                       // flat petals catch the air and fall slower
          const term = p.term * (0.55 + 0.45 * (1 - Math.abs(face)));
          p.vy += (term - p.vy) * 0.05 * dt;
          p.x += (p.vx + Math.sin(p.ph) * p.amp + face * 0.35) * dt; p.y += p.vy * dt;
          if (p.y > H + 40) p.life = 0;
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          if (p.k === 'bloom') {
            ctx.scale(0.75 + 0.25 * Math.abs(face), 1);
            const img = marigold(); ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
            ctx.drawImage(img, -p.size, -p.size, p.size * 2, p.size * 2);
          } else {
            ctx.scale(Math.max(0.08, Math.abs(face)), 1);       // 3D tumble
            if (face < 0) ctx.globalAlpha = 0.82;                        // the back of the petal is a touch duller
            const img = petal(p.sp); ctx.drawImage(img, -p.size * 0.36, -p.size * 0.5, p.size * 0.72, p.size);
          }
          ctx.restore();
          break; }
        case 'conf': {
          p.ph += 0.06 * dt; p.flip += p.vf * dt; p.rot += p.vr * dt;
          const fast = Math.hypot(p.vx, p.vy) > p.term * 1.5;
          const dk = Math.pow(fast ? 0.955 : 0.985, dt);
          p.vx *= dk; p.vy = p.vy * dk + 0.18 * S() * dt;
          if (!fast && p.vy > p.term) p.vy += (p.term - p.vy) * 0.12 * dt;  // paper falls at a gentle terminal speed
          if (!fast) p.x += Math.sin(p.ph) * 0.6 * dt;                        // and drifts side to side
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.y > H + 30 || (p.vy > 0 && (p.x < -40 || p.x > W + 40))) p.life = 0;
          const face = Math.cos(p.flip), shade = 0.55 + 0.45 * Math.abs(face);
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.max(0.06, Math.abs(face)));
          const dark = (1 - shade) * 0.6 + (face < 0 ? 0.12 : 0);   // the side turned away is in shadow
          ctx.beginPath();
          if (p.round) ctx.arc(0, 0, p.w / 2, 0, 6.283); else ctx.rect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.fillStyle = p.c; ctx.fill();
          if (dark > 0.02) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fill(); }
          ctx.restore();
          break; }
        case 'lantern': {
          p.ph += 0.04 * dt; p.vy *= Math.pow(0.9995, dt);
          p.x += (p.vx + Math.sin(p.ph * 0.5) * 0.25 * p.z) * dt; p.y += p.vy * dt; p.tilt = Math.sin(p.ph * 0.5) * 0.06;
          if (p.y < -p.size * 3) p.life = 0;
          const s = p.size, fl = 0.86 + Math.sin(p.ph * 5) * 0.06 + Math.random() * 0.08;   // flame flicker
          const fade = 0.55 + 0.45 * p.z;
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 * fl * fade;
          ctx.drawImage(glow('255,150,50'), p.x - s * 2.6, p.y - s * 2.4, s * 5.2, s * 5.2);
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = fade;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.tilt);
          const body = ctx.createLinearGradient(0, -s, 0, s * 0.8);
          body.addColorStop(0, `rgba(200,80,30,${0.95})`); body.addColorStop(0.55, `rgba(255,${Math.round(150 + 50 * fl)},70,1)`); body.addColorStop(1, `rgba(255,230,150,1)`);
          ctx.fillStyle = body;
          ctx.beginPath(); ctx.moveTo(-s * 0.5, -s * 0.85);
          ctx.quadraticCurveTo(0, -s * 1.15, s * 0.5, -s * 0.85);
          ctx.lineTo(s * 0.36, s * 0.75); ctx.quadraticCurveTo(0, s * 0.85, -s * 0.36, s * 0.75); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(120,40,10,0.35)'; ctx.lineWidth = 0.8;              // paper ribs
          ctx.beginPath(); ctx.moveTo(-s * 0.15, -s * 0.95); ctx.lineTo(-s * 0.12, s * 0.8); ctx.moveTo(s * 0.15, -s * 0.95); ctx.lineTo(s * 0.12, s * 0.8); ctx.stroke();
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = fl * fade;
          ctx.drawImage(glow('255,220,120'), -s * 0.35, s * 0.45, s * 0.7, s * 0.7);   // the burner
          ctx.restore();
          break; }
        case 'balloon': {
          p.ph += 0.03 * dt;
          p.vy += (-p.term - p.vy) * 0.02 * dt;                                    // buoyancy up to a steady rise
          p.x += (p.vx + Math.sin(p.ph) * 0.35 * p.z) * dt; p.y += p.vy * dt;
          if (p.y < -p.size * 6) p.life = 0;
          // string: each point trails the one above it
          let px = p.x + Math.sin(p.ph) * 1.5, py = p.y + p.size * 1.15;
          for (const q of p.rope) { const seg = p.size * 0.45, dx = q.x - px, dy = q.y - py, d = Math.hypot(dx, dy) || 1;
            q.x = px + dx / d * seg; q.y = py + dy / d * seg; q.x += Math.sin(p.ph * 2 + q.y * 0.02) * 0.15 * dt; px = q.x; py = q.y; }
          const s = p.size, tilt = Math.sin(p.ph) * 0.08;
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.6 + 0.4 * p.z;
          ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.x, p.y + s * 1.12);
          for (const q of p.rope) ctx.lineTo(q.x, q.y);
          ctx.stroke();
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(tilt);
          const g = ctx.createRadialGradient(-s * 0.32, -s * 0.42, s * 0.08, 0, 0, s * 1.15);
          g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.18, p.c); g.addColorStop(1, shadeHex(p.c, -0.45));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(0, s * 1.08);
          ctx.bezierCurveTo(s * 1.05, s * 0.55, s * 0.95, -s * 1.1, 0, -s * 1.1);
          ctx.bezierCurveTo(-s * 0.95, -s * 1.1, -s * 1.05, s * 0.55, 0, s * 1.08); ctx.fill();
          ctx.fillStyle = shadeHex(p.c, -0.3);                                     // knot
          ctx.beginPath(); ctx.moveTo(-s * 0.12, s * 1.2); ctx.lineTo(s * 0.12, s * 1.2); ctx.lineTo(0, s * 1.05); ctx.fill();
          ctx.restore();
          break; }
        case 'glint': {
          const dk = Math.pow(0.95, dt);
          p.vx *= dk; p.vy = p.vy * dk + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.tw += 0.25 * dt; p.life -= p.decay * dt;
          const a = clamp(p.life, 0, 1) * (0.55 + 0.45 * Math.abs(Math.sin(p.tw)));
          ctx.globalCompositeOperation = 'lighter'; drawGlint(p.x, p.y, p.size * (0.6 + 0.4 * p.life), p.rot, a);
          break; }
        case 'bokeh':
          p.y += p.vy * dt; p.life -= p.decay * dt;
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.sin(clamp(p.life, 0, 1) * 3.14) * 0.35;
          ctx.drawImage(glow('255,200,110'), p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
          break;
      }
      if (p.life > 0) out.push(p);
    }
    // (particles added during the loop — bursts, embers — are visited by the same loop)
    parts = out.length > 1600 ? out.slice(out.length - 1600) : out;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // Fade out and finish shortly after the show ends, even if slow lanterns/petals are still on screen
    const over = now - endAt;
    if (over > 1800) canvas.style.opacity = String(Math.max(0, 1 - (over - 1800) / 700));
    if (over < 2500 && (over < 0 || parts.length)) raf = requestAnimationFrame(step);
    else stop();
  }
  function shadeHex(hex, f) {
    const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const k = f < 0 ? 1 + f : 1; const add = f > 0 ? 255 * f : 0;
    r = Math.round(r * k + add); g = Math.round(g * k + add); b = Math.round(b * k + add);
    return `rgb(${clamp(r, 0, 255)},${clamp(g, 0, 255)},${clamp(b, 0, 255)})`;
  }
  function stop() {
    cancelAnimationFrame(raf); raf = 0; parts = []; emitters = []; flashA = 0;
    if (canvas) { ctx.clearRect(0, 0, W, H); canvas.remove(); canvas = null; }
  }

  // kind: one of KINDS (random if omitted). big: game win — fireworks plus a second effect.
  function play({ kind, big = false } = {}) {
    try {
      ensureCanvas(); resize();
      const gentle = reduced();
      let kinds;
      if (gentle) kinds = ['flowers'];
      else if (kind && FX[kind]) kinds = [kind];
      else {
        const pool = KINDS.filter(k => k !== lastKind);
        const first = big ? 'fireworks' : pick(pool);
        kinds = big ? [first, pick(KINDS.filter(k => k !== 'fireworks'))] : [first];
      }
      lastKind = kinds[kinds.length - 1];
      const dur = gentle ? 3000 : big ? 7000 : 4500;
      if (!raf) { parts = []; emitters = []; startT = performance.now(); last = startT; }
      canvas.style.opacity = '1';
      const t0 = performance.now() - startT;
      kinds.forEach(k => {                         // emitters run relative to the show start
        const before = emitters.length; FX[k](dur, gentle, big);
        for (let i = before; i < emitters.length; i++) { const e = emitters[i], tick = e.tick; e.until += t0; e.tick = (t) => tick(t - t0); }
      });
      endAt = performance.now() + dur;
      history.push({ kinds, big, at: Date.now() });
      if (!raf) raf = requestAnimationFrame(step);
      return kinds;
    } catch (e) { console.warn('[Celebrate]', e); return []; }
  }

  return { play, stop, KINDS, history, get running() { return !!raf; }, get particles() { return parts.length; } };
})();
