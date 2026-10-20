// Win celebrations: a random full-screen effect when your team wins a round,
// and a bigger two-effect show when it wins the game. Drawn on one canvas that
// never blocks taps. Respects "reduce motion" (gentle petals only).
const Celebrate = (() => {
  const KINDS = ['fireworks', 'flowers', 'confetti', 'lanterns', 'balloons', 'sparkles'];
  const COLOURS = ['#ffd54f', '#ff7043', '#ec407a', '#ab47bc', '#42a5f5', '#26c6da', '#66bb6a', '#fff176', '#ffffff'];
  const FLOWERS = ['🌼', '🌸', '🌺', '🏵️', '🌷', '💮'];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  let canvas = null, ctx = null, W = 0, H = 0, dpr = 1, raf = 0;
  let parts = [], emitters = [], endAt = 0, lastKind = null;
  const history = [];

  function reduced() { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }

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
  const scale = () => Math.max(0.6, Math.min(1.4, Math.min(W, H) / 420));

  // ---------- effects: each adds emitters/particles ----------
  const FX = {
    fireworks(dur) {
      let next = 0;
      emitters.push({ until: dur - 900, tick(t) {
        if (t < next) return; next = t + rnd(260, 520);
        const x = rnd(W * 0.15, W * 0.85), ty = rnd(H * 0.12, H * 0.45);
        parts.push({ k: 'rocket', x, y: H + 10, vx: rnd(-0.6, 0.6), vy: -(H - ty) / 46, ty, c: pick(COLOURS), life: 1 });
      } });
    },
    flowers(dur, gentle) {
      let next = 0; const rate = gentle ? 260 : 70;
      emitters.push({ until: dur - 1500, tick(t) {
        if (t < next) return; next = t + rate;
        parts.push({ k: 'flower', ch: pick(FLOWERS), x: rnd(0, W), y: -30, vx: rnd(-0.4, 0.4), vy: rnd(1.1, 2.2) * (gentle ? 0.6 : 1),
          sway: rnd(0.6, 1.6), ph: rnd(0, 6.28), rot: rnd(0, 6.28), vr: rnd(-0.04, 0.04), size: rnd(18, 34) * scale(), life: 1 });
      } });
    },
    confetti(dur) {
      const burst = (x, dir) => { for (let i = 0; i < 70; i++) {
        const a = rnd(-1.3, -0.45), sp = rnd(8, 17) * scale(); // up and inwards from a bottom corner
        parts.push({ k: 'conf', x, y: H * 0.95, vx: Math.cos(a) * sp * dir, vy: Math.sin(a) * sp, c: pick(COLOURS),
          w: rnd(6, 11), h: rnd(3, 6), rot: rnd(0, 6.28), vr: rnd(-0.3, 0.3), flip: rnd(0, 6.28), life: 1 });
      } };
      burst(0, 1); burst(W, -1);
      setTimeout(() => { if (parts.length < 900) { burst(W * 0.1, 1); burst(W * 0.9, -1); } }, 650);
    },
    lanterns(dur) {
      let next = 0;
      emitters.push({ until: dur - 1800, tick(t) {
        if (t < next) return; next = t + rnd(180, 340);
        parts.push({ k: 'lantern', x: rnd(W * 0.05, W * 0.95), y: H + 40, vx: rnd(-0.25, 0.25), vy: -rnd(1.2, 2.3), ph: rnd(0, 6.28),
          size: rnd(16, 28) * scale(), life: 1 });
      } });
    },
    balloons(dur) {
      let next = 0;
      emitters.push({ until: dur - 1600, tick(t) {
        if (t < next) return; next = t + rnd(110, 220);
        parts.push({ k: 'balloon', x: rnd(W * 0.04, W * 0.96), y: H + 60, vx: rnd(-0.3, 0.3), vy: -rnd(2.2, 3.6) * scale(), ph: rnd(0, 6.28),
          c: pick(COLOURS.slice(0, 8)), size: rnd(18, 28) * scale(), life: 1 });
      } });
    },
    sparkles(dur) {
      const ring = (n, sp) => { for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.283 + rnd(-0.05, 0.05), v = sp * rnd(0.85, 1.15) * scale();
        parts.push({ k: 'star', x: W / 2, y: H * 0.42, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c: pick(['#ffd54f', '#fff176', '#ffffff', '#ffb300']),
          size: rnd(5, 10) * scale(), rot: rnd(0, 6.28), life: 1, decay: rnd(0.008, 0.013), g: 0.04 });
      } };
      ring(60, 7); setTimeout(() => ring(48, 5), 380); setTimeout(() => ring(36, 3.4), 760);
      let next = 0;
      emitters.push({ until: dur - 1200, tick(t) {
        if (t < next) return; next = t + 60;
        parts.push({ k: 'twinkle', x: rnd(0, W), y: rnd(0, H * 0.8), size: rnd(3, 7) * scale(), life: 1, decay: 0.03, c: '#fff8e1' });
      } });
    },
  };

  function explode(p) {
    const n = Math.round(rnd(46, 72)), shape = Math.random();
    const c2 = Math.random() < 0.4 ? pick(COLOURS) : p.c;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283, sp = (shape < 0.3 ? 4.2 : rnd(1.5, 4.8)) * scale();
      parts.push({ k: 'spark', x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c: i % 2 ? p.c : c2, life: 1, decay: rnd(0.011, 0.018), px: p.x, py: p.y });
    }
    parts.push({ k: 'flash', x: p.x, y: p.y, life: 1, decay: 0.08, c: p.c });
  }

  // ---------- simulation + drawing ----------
  function step(t0) {
    const t = performance.now() - t0;
    emitters.forEach(e => { if (t < e.until) e.tick(t); });
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    const out = [];
    for (const p of parts) {
      switch (p.k) {
        case 'rocket':
          p.x += p.vx; p.y += p.vy; p.vy *= 0.985;
          ctx.fillStyle = p.c; ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, 6.283); ctx.fill();
          ctx.globalAlpha = 0.35; ctx.fillRect(p.x - 1, p.y, 2, 16);
          if (p.y <= p.ty || p.vy > -1.2) { explode(p); continue; }
          break;
        case 'spark':
          p.px = p.x; p.py = p.y; p.vx *= 0.975; p.vy = p.vy * 0.975 + 0.055; p.x += p.vx; p.y += p.vy; p.life -= p.decay;
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.max(0, p.life);
          ctx.strokeStyle = p.c; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(p.px - p.vx * 2, p.py - p.vy * 2); ctx.lineTo(p.x, p.y); ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
          break;
        case 'flash':
          p.life -= p.decay; ctx.globalAlpha = Math.max(0, p.life) * 0.5;
          { const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 60 * scale()); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 60 * scale(), 0, 6.283); ctx.fill(); }
          break;
        case 'flower':
          p.ph += 0.03; p.x += p.vx + Math.sin(p.ph) * p.sway; p.y += p.vy; p.rot += p.vr;
          if (p.y > H + 40) p.life = 0;
          ctx.globalAlpha = 1; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.font = `${p.size | 0}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.ch, 0, 0); ctx.restore();
          break;
        case 'conf':
          p.vx *= 0.985; p.vy = p.vy * 0.985 + 0.22; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.flip += 0.18;
          if (p.y > H + 30) p.life = 0;
          ctx.globalAlpha = 1; ctx.fillStyle = p.c; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.flip)), p.w, p.h * Math.abs(Math.cos(p.flip)) + 0.5); ctx.restore();
          break;
        case 'lantern': {
          p.ph += 0.05; p.x += p.vx + Math.sin(p.ph * 0.4) * 0.3; p.y += p.vy;
          if (p.y < -60) p.life = 0;
          const s = p.size, fl = 0.85 + Math.sin(p.ph * 3) * 0.15;
          ctx.globalAlpha = 0.55 * fl;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 2.4); g.addColorStop(0, 'rgba(255,190,80,0.9)'); g.addColorStop(1, 'rgba(255,140,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, s * 2.4, 0, 6.283); ctx.fill();
          ctx.globalAlpha = 0.95; ctx.fillStyle = '#ff9f43';
          ctx.beginPath(); ctx.moveTo(p.x - s * 0.55, p.y - s * 0.8); ctx.lineTo(p.x + s * 0.55, p.y - s * 0.8);
          ctx.lineTo(p.x + s * 0.42, p.y + s * 0.7); ctx.lineTo(p.x - s * 0.42, p.y + s * 0.7); ctx.closePath(); ctx.fill();
          ctx.fillStyle = `rgba(255,245,200,${0.8 * fl})`; ctx.beginPath(); ctx.arc(p.x, p.y + s * 0.45, s * 0.18, 0, 6.283); ctx.fill();
          break; }
        case 'balloon': {
          p.ph += 0.04; p.x += p.vx + Math.sin(p.ph) * 0.5; p.y += p.vy;
          if (p.y < -p.size * 4) p.life = 0;
          const s = p.size; ctx.globalAlpha = 0.95;
          ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.x, p.y + s * 1.2); ctx.quadraticCurveTo(p.x + Math.sin(p.ph) * 8, p.y + s * 2.2, p.x, p.y + s * 3); ctx.stroke();
          ctx.fillStyle = p.c; ctx.beginPath(); ctx.ellipse(p.x, p.y, s * 0.82, s * 1.05, 0, 0, 6.283); ctx.fill();
          ctx.beginPath(); ctx.moveTo(p.x - 4, p.y + s * 1.12); ctx.lineTo(p.x + 4, p.y + s * 1.12); ctx.lineTo(p.x, p.y + s * 0.98); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(p.x - s * 0.3, p.y - s * 0.4, s * 0.16, s * 0.28, -0.5, 0, 6.283); ctx.fill();
          break; }
        case 'star':
          p.vx *= 0.97; p.vy = p.vy * 0.97 + p.g; p.x += p.vx; p.y += p.vy; p.rot += 0.1; p.life -= p.decay;
          ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c; drawStar(p.x, p.y, p.size, p.rot);
          break;
        case 'twinkle':
          p.life -= p.decay; ctx.globalAlpha = Math.max(0, Math.sin(p.life * 3.14)); ctx.fillStyle = p.c; drawStar(p.x, p.y, p.size, 0);
          break;
      }
      if (p.life > 0) out.push(p);
    }
    parts = out.length > 1400 ? out.slice(out.length - 1400) : out;
    ctx.globalAlpha = 1;
    // Fade out and finish shortly after the show ends, even if slow lanterns/petals are still on screen
    const over = performance.now() - endAt;
    if (over > 1800) canvas.style.opacity = String(Math.max(0, 1 - (over - 1800) / 700));
    if (over < 2500 && (over < 0 || parts.length)) raf = requestAnimationFrame(() => step(t0));
    else stop();
  }
  function drawStar(x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = rot + i * Math.PI / 4, rr = i % 2 ? r * 0.38 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  function stop() {
    cancelAnimationFrame(raf); raf = 0; parts = []; emitters = [];
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
      const dur = gentle ? 3000 : big ? 7000 : 4200;
      if (!raf) { parts = []; emitters = []; }
      canvas.style.opacity = '1';
      kinds.forEach(k => FX[k](dur, gentle));
      endAt = performance.now() + dur;
      history.push({ kinds, big, at: Date.now() });
      if (!raf) { const t0 = performance.now(); raf = requestAnimationFrame(() => step(t0)); }
      return kinds;
    } catch (e) { console.warn('[Celebrate]', e); return []; }
  }

  return { play, stop, KINDS, history, get running() { return !!raf; }, get particles() { return parts.length; } };
})();
