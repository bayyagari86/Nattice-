// ============================================================
// SOUND — voice clips for reactions, the table-host voice and
// small synthesized music stings matched to each phrase's mood.
// Everything is optional and per device; nothing here touches
// game rules. Clips live in assets/voice/ and can be swapped for
// real recordings with the same file names.
// ============================================================

const Sound = (() => {
  const LS_SFX = 'nattis.sfx';        // 'voice' (voice + music) | 'music' (music only) | 'off'
  const LS_HOST = 'nattis.host';      // 'or' | 'en' | 'off'
  const LS_TALK = 'nattis.botTalk';   // 'on' | 'off'
  const BASE = './assets/voice/';

  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const getSfx = () => { const v = lsGet(LS_SFX, 'voice'); return ['voice', 'music', 'off'].includes(v) ? v : 'voice'; };
  const getHost = () => { const v = lsGet(LS_HOST, 'or'); return ['or', 'en', 'off'].includes(v) ? v : 'or'; };
  const getTalk = () => lsGet(LS_TALK, 'on') === 'off' ? 'off' : 'on';

  let ctx = null, master = null, recDest = null;
  const buffers = new Map();   // url -> Promise<AudioBuffer|null>

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    return ctx;
  }
  // Browsers only allow sound after a user gesture
  function unlock() {
    const c = ensureCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  }
  ['pointerdown', 'touchstart', 'keydown'].forEach(ev => window.addEventListener(ev, unlock, { passive: true }));

  function canPlay() { const c = ensureCtx(); return !!(c && c.state === 'running'); }

  function load(url) {
    if (!buffers.has(url)) {
      buffers.set(url, (async () => {
        const c = ensureCtx(); if (!c) return null;
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          const arr = await res.arrayBuffer();
          return await new Promise((ok, bad) => c.decodeAudioData(arr, ok, bad));
        } catch (_) { return null; }
      })());
    }
    return buffers.get(url);
  }

  async function playUrl(url, { delay = 0, gain = 1 } = {}) {
    if (!canPlay()) return 0;
    const buf = await load(url);
    if (!buf) return 0;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(master);
    src.start(ctx.currentTime + delay);
    return buf.duration;
  }

  // ---------- Synth helpers ----------
  function tone(t, freq, dur, { type = 'sine', vol = 0.18, attack = 0.01, glideTo = null, vibrato = 0, filter = null } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    if (vibrato) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 5.5; lg.gain.value = vibrato;
      lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); node = f; }
    node.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // tabla-like hit: pitched sine that drops quickly
  function drum(t, freq = 180, vol = 0.35, dur = 0.22) { tone(t, freq, dur, { vol, attack: 0.003, glideTo: freq * 0.45 }); }
  function noise(t, dur, vol = 0.12, hp = 1200) {
    const len = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = b; f.type = 'highpass'; f.frequency.value = hp; g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(master); s.start(t);
  }

  // Short music stings, chosen by the phrase's mood (or its entrance for a few special ones)
  const STINGS = {
    celebrate(t) { // bright rising raga-ish run + dha hits
      [392, 440, 523, 587, 784].forEach((f, i) => tone(t + i * 0.07, f, 0.28, { type: 'sawtooth', vol: 0.07, filter: 2600, vibrato: 4 }));
      drum(t, 170); drum(t + 0.36, 120, 0.4, 0.35);
    },
    drumroll(t) { // ଧମାକା: a quick dholak roll that lands on a big hit
      for (let i = 0; i < 12; i++) drum(t + i * 0.045, 210 + (i % 2) * 30, 0.12 + i * 0.015, 0.08);
      drum(t + 0.58, 110, 0.5, 0.45); noise(t + 0.58, 0.35, 0.12, 2500);
    },
    shock(t) { // dun-dun!
      drum(t, 95, 0.45, 0.35); drum(t + 0.28, 80, 0.5, 0.55);
      tone(t + 0.28, 233, 0.6, { type: 'sawtooth', vol: 0.05, filter: 900, vibrato: 10 });
    },
    tease(t) { // playful na-na-na
      [659, 523, 659, 523].forEach((f, i) => tone(t + i * 0.12, f, 0.11, { type: 'square', vol: 0.045, filter: 3000 }));
      drum(t + 0.48, 260, 0.2, 0.12);
    },
    frustrated(t) { // sad descending wah-wah-wah-waaah
      [311, 294, 277, 262].forEach((f, i) => tone(t + i * 0.26, f, i === 3 ? 0.75 : 0.24,
        { type: 'sawtooth', vol: 0.07, filter: 700 + (i % 2) * 300, vibrato: i === 3 ? 7 : 2, glideTo: i === 3 ? 220 : null }));
    },
    puzzled(t) { // a questioning upward glide (shrug)
      tone(t, 330, 0.5, { type: 'triangle', vol: 0.12, glideTo: 520 });
      tone(t + 0.55, 520, 0.35, { type: 'triangle', vol: 0.08, glideTo: 470 });
    },
    brag(t) { // swaggering bass riff + snap
      [110, 110, 147, 165].forEach((f, i) => tone(t + i * 0.13, f, 0.14, { type: 'sawtooth', vol: 0.09, filter: 600 }));
      noise(t + 0.52, 0.06, 0.25, 3500);
    },
    calm(t) { // soft temple bell
      tone(t, 880, 1.2, { vol: 0.08 }); tone(t, 1320, 0.9, { vol: 0.03 });
    },
    host(t) { // gentle chime before the host speaks
      tone(t, 1046, 0.35, { vol: 0.05 }); tone(t + 0.09, 1568, 0.4, { vol: 0.035 });
    },
    joker(t) { // the joker slam
      drum(t, 90, 0.55, 0.5); noise(t, 0.4, 0.15, 1800);
      [523, 659, 784, 1046].forEach((f, i) => tone(t + 0.08 + i * 0.05, f, 0.35, { type: 'triangle', vol: 0.07 }));
    },
  };
  function sting(name, delay = 0) {
    if (getSfx() === 'off' || !canPlay()) return;
    const fn = STINGS[name] || STINGS.celebrate;
    try { fn(ctx.currentTime + delay); } catch (_) {}
  }

  // ---------- Reactions ----------
  // entry = { id, entrance, mood } from the Extras catalogue
  function reaction(entry) {
    if (!entry || getSfx() === 'off') return;
    unlock();
    const special = entry.entrance === 'drumroll' ? 'drumroll' : null;
    sting(special || entry.mood || 'celebrate');
    if (getSfx() === 'voice' && entry.id) playUrl(`${BASE}${entry.id}.mp3`, { delay: special ? 0.55 : 0.18, gain: 1 });
  }

  // ---------- Table host ----------
  let hostBusyUntil = 0;
  const hostQueue = [];
  function host(event, { music = true } = {}) {
    const lang = getHost();
    if (lang === 'off') return;
    unlock();
    if (!canPlay()) return;
    const now = ctx.currentTime;
    const start = Math.max(now, hostBusyUntil);
    if (start - now > 2.5) return; // don't pile up stale announcements
    if (music && getSfx() !== 'off') {
      if (event.startsWith('joker')) STINGS.joker(start); else STINGS.host(start);
    }
    hostBusyUntil = start + 1.6;
    playUrl(`${BASE}host_${lang}_${event}.mp3`, { delay: start - now + (event.startsWith('joker') ? 0.35 : 0.18), gain: 1 })
      .then(d => { if (d) hostBusyUntil = Math.max(hostBusyUntil, start + 0.3 + d); });
  }

  // ---------- Recording hook for the recap reel ----------
  function startCapture() {
    const c = ensureCtx(); if (!c || !c.createMediaStreamDestination) return null;
    if (!recDest) recDest = c.createMediaStreamDestination();
    master.connect(recDest);
    return recDest.stream;
  }
  function stopCapture() { if (recDest && master) { try { master.disconnect(recDest); } catch (_) {} } }

  // ---------- Reel audio (ignores the sound setting: the user asked for a clip) ----------
  function reelSting(name, delay = 0) { if (!canPlay()) return; try { (STINGS[name] || STINGS.celebrate)(ctx.currentTime + delay); } catch (_) {} }
  function reelVoice(event, delay = 0) {
    const lang = getHost() === 'en' ? 'en' : 'or';
    return playUrl(`${BASE}host_${lang}_${event}.mp3`, { delay, gain: 1 });
  }
  // A soft dholak-and-drone bed under the whole reel
  function reelBed(seconds) {
    if (!canPlay()) return;
    const t0 = ctx.currentTime + 0.05, beat = 0.3;
    const pattern = [1, 0, 0.5, 0, 1, 0.5, 0, 0.5]; // dha . ti . dha ti . ti
    for (let i = 0; i * beat < seconds - 0.4; i++) {
      const v = pattern[i % pattern.length]; if (!v) continue;
      const t = t0 + i * beat;
      if (v === 1) drum(t, 140, 0.16, 0.2); else drum(t, 300, 0.07, 0.08);
    }
    // drone: Sa + Pa, faded in and out
    [[130.8, 0.035], [196, 0.022]].forEach(([f, vol]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 650;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 1.2);
      g.gain.setValueAtTime(vol, t0 + seconds - 1.5); g.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds - 0.1);
      o.connect(lp); lp.connect(g); g.connect(master); o.start(t0); o.stop(t0 + seconds);
    });
  }

  function preload(ids) { if (!ensureCtx()) return; ids.forEach(id => load(`${BASE}${id}.mp3`)); }

  return {
    getSfx, getHost, getTalk,
    setSfx: v => lsSet(LS_SFX, v), setHost: v => lsSet(LS_HOST, v), setTalk: v => lsSet(LS_TALK, v),
    reaction, host, sting, playUrl, unlock, canPlay, startCapture, stopCapture, preload,
    reelSting, reelVoice, reelBed,
    _ctx: () => ctx,
  };
})();
