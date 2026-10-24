// ============================================================
// VOICE — push-to-talk for online games.
//
// Hold the mic button to talk; release to stop. Only the person holding
// the button sends audio: their phone opens a one-way audio call to each
// other human player. When two phones can't reach each other directly
// (common on 5G / mobile carriers), the host's phone passes the audio on:
// every phone is already connected to the host for the game itself.
// Last resort: if no audio line comes up at all (e.g. two phones on mobile
// data that can't open a second connection), the voice is sent in small
// chunks over the game's own connection, which is known to work.
// Nothing is recorded or sent while the button is up.
// Everyone else sees a green ring on the talker's seat.
//
// The microphone is opened on the first press, kept warm while you're
// talking now and then, and released after 30 s without talking (the
// phone's mic indicator then goes off).
// ============================================================

const Voice = (() => {
  const LS_KEY = 'nattis.voice';          // 'on' | 'off'
  const MAX_TALK_MS = 30000;               // one press can talk up to 30 s
  const IDLE_RELEASE_MS = 30000;           // release the mic after 30 s quiet
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const getPref = () => (lsGet(LS_KEY, 'on') === 'off' ? 'off' : 'on');

  let mic = null;                 // MediaStream from getUserMedia
  let micPromise = null;
  const outCalls = new Map();     // peerId -> MediaConnection (we talk to them)
  const inCalls = new Map();      // peerId -> { call, audio }
  const talking = new Set();      // seats currently talking (from VOICE messages)
  const talkTimers = {};
  let pressed = false, live = false, maxTimer = null, idleTimer = null, blocked = false;
  let pendingAudio = new Set();   // audio elements the browser refused to start
  // Relay through the host (for pairs that can't connect directly)
  const relayed = new Set();      // listener side: talker seats we hear via the host
  const relayAsked = {};          // listener side: talker seat -> last time we asked the host
  const fwd = new Map();          // host side: "T>L" -> MediaConnection forwarding T's audio to L
  const relayPairs = new Set();   // host side: "T>L" pairs that need the relay
  const directDead = new Map();   // talker side: peerId -> time the direct line last failed 3 times
  let relayStats = { asked: 0, forwarded: 0 };
  // Voice over the game connection (last resort)
  const DATA_RATE = 12000;        // phone-call quality, ~100 kbit/s
  const dataHear = new Set();     // listener side: talker seats we hear over the game connection
  const dataAsked = {};           // listener side: talker seat -> last time we asked
  const dataPairs = new Set();    // host side: "T>L" pairs using the game connection
  let feedOn = false;             // talker side (client): the host wants our audio as chunks
  let actx = null, cap = null, outGain = null, tapWarned = false;
  const play = {};                // talker seat -> { next, t, rms }
  const dataStats = { sent: 0, recv: 0, asked: 0, fed: 0 };

  const st = () => (typeof Game !== 'undefined' && Game.getState) ? Game.getState() : null;
  const me = () => (typeof Game !== 'undefined' && Game.getMySeat) ? Game.getMySeat() : -1;
  const toast = (t) => { try { UI.showToast(t); } catch (_) {} };

  // Other human players we can reach, by their main peer id
  function targets() {
    const s = st(); if (!s || !s.players) return [];
    const mine = me();
    return s.players.map((p, seat) => ({ p, seat }))
      .filter(({ p, seat }) => p && seat !== mine && !p.isAI && p.peerId && p.connected !== false)
      .map(({ p, seat }) => ({ peerId: p.peerId, seat }));
  }
  const amHost = () => { try { return !!(typeof Network !== 'undefined' && Network.getIsHost()); } catch (_) { return false; } };
  const peerOfSeat = (seat) => { const s = st(); return s && s.players && s.players[seat] && !s.players[seat].isAI ? s.players[seat].peerId : null; };
  const hostPeer = () => { try { return Game.getHostPeerId ? Game.getHostPeerId() : null; } catch (_) { return null; } };
  function seatOfPeer(peerId) {
    const s = st(); if (!s || !s.players) return -1;
    return s.players.findIndex((p, seat) => p && !p.isAI && p.peerId === peerId && seat !== me());
  }
  function available() {
    const s = st();
    return !!(s && s.players && typeof Network !== 'undefined' && Network.isReady() && getPref() === 'on' &&
      document.getElementById('game-screen')?.classList.contains('active') && targets().length > 0);
  }

  // ---------- microphone ----------
  async function getMic() {
    if (mic && mic.getAudioTracks().some(t => t.readyState === 'live')) return mic;
    if (micPromise) return micPromise;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('unsupported');
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (_) {}
    micPromise = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    }).then(s => { mic = s; s.getAudioTracks().forEach(t => { t.enabled = false; }); return s; })
      .finally(() => { micPromise = null; });
    return micPromise;
  }
  function releaseMic() {
    stopFeed();
    for (const c of outCalls.values()) { try { c.close(); } catch (_) {} }
    outCalls.clear();
    if (mic) { mic.getTracks().forEach(t => { try { t.stop(); } catch (_) {} }); mic = null; }
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
  }

  // ---------- talking ----------
  // Up = network path AND the encrypted media handshake are both done
  const isUp = (c) => {
    const pc = c && c.peerConnection; if (!pc) return false;
    if (pc.connectionState) return pc.connectionState === 'connected';
    return ['connected', 'completed'].includes(pc.iceConnectionState);
  };
  function dial(peerId, stream, tries) {
    const c = Network.callPeer(peerId, stream, { v: 1 });
    if (!c) return;
    outCalls.set(peerId, c);
    const drop = () => { if (outCalls.get(peerId) === c) outCalls.delete(peerId); };
    c.on('close', drop);
    c.on('error', () => { c._failed = true; drop(); });
    // A line that hasn't come up in 2.5 s is redialled (up to 3 tries)
    setTimeout(() => {
      if (outCalls.get(peerId) !== c || isUp(c) || !mic) return;
      try { c.close(); } catch (_) {}
      outCalls.delete(peerId);
      if (tries < 3 && targets().some(t => t.peerId === peerId)) dial(peerId, mic, tries + 1);
      else directDead.set(peerId, Date.now()); // the listener will be served through the host
    }, 2500);
  }
  function ensureCalls(stream) {
    const want = targets(), ids = new Set(want.map(t => t.peerId));
    for (const [pid, c] of outCalls) {        // drop calls to players who left or whose line died
      const ice = c.peerConnection && c.peerConnection.iceConnectionState;
      if (!ids.has(pid) || c._failed || ice === 'failed' || ice === 'closed' || ice === 'disconnected') { try { c.close(); } catch (_) {} outCalls.delete(pid); }
    }
    // Space the dials out a little: several offers in the same instant are less reliable
    let k = 0;
    for (const { peerId } of want) {
      if (outCalls.has(peerId)) continue;
      // Direct line failed recently: don't keep the phone busy retrying; the host relays to them
      if (directDead.has(peerId) && Date.now() - directDead.get(peerId) < 120000) continue;
      const delay = (k++) * 120;
      if (!delay) dial(peerId, stream, 1);
      else { outCalls.set(peerId, { _pending: true, peerConnection: null, close() { outCalls.delete(peerId); } });
        setTimeout(() => { const cur = outCalls.get(peerId); if (cur && cur._pending && mic) { outCalls.delete(peerId); dial(peerId, mic, 1); } }, delay); }
    }
  }
  // How many listener lines are up, out of how many we opened
  function linesUp() {
    let up = 0;
    for (const c of outCalls.values()) if (isUp(c)) up++;
    return { up, total: outCalls.size };
  }

  async function start() {
    if (pressed) return;
    if (!available()) return;
    pressed = true;
    clearTimeout(idleTimer);
    setButton('connecting');
    let stream;
    try { stream = await getMic(); }
    catch (e) {
      pressed = false; setButton('idle');
      blocked = true;
      toast(e && e.message === 'unsupported' ? 'This browser can\u2019t use the microphone' : 'Microphone blocked \u2014 allow it for this site in your browser settings');
      return;
    }
    blocked = false;
    if (!pressed) { scheduleIdle(); toast('Microphone ready \u2014 hold the mic button to talk'); return; }   // the permission prompt ended the press
    ensureCalls(stream);
    stream.getAudioTracks().forEach(t => { t.enabled = true; });
    live = true;
    sendState(true);
    duck(true);
    startFeed();
    // "Connecting" until every listener's line is up (or 1.5 s with at least one up,
    // so one slow phone doesn't hold everyone back)
    const began = Date.now();
    const check = () => {
      if (!pressed) return;
      const { up, total } = linesUp();
      if (cap || (up > 0 && (up === total || Date.now() - began > 1500))) setButton('live');
      else { setButton('connecting'); setTimeout(check, 150); }
    };
    check();
    clearTimeout(maxTimer);
    maxTimer = setTimeout(() => { if (pressed) { stop(); toast('Talk limit is 30 seconds \u2014 press again to keep talking'); } }, MAX_TALK_MS);
  }

  function stop() {
    if (!pressed) return;
    pressed = false;
    clearTimeout(maxTimer);
    if (mic) mic.getAudioTracks().forEach(t => { t.enabled = false; });
    if (live) { live = false; sendState(false); }
    stopFeed();
    duck(false);
    setButton('idle');
    scheduleIdle();
  }
  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!pressed) releaseMic(); }, IDLE_RELEASE_MS);
  }
  function sendState(on) {
    try { if (Game.sendVoiceState) Game.sendVoiceState(on); } catch (_) {}
    setTalking(me(), on);
  }

  // ---------- listening ----------
  function onIncomingCall(call) {
    const md = call.metadata || {};
    const viaHost = Number.isInteger(md.relayOf);
    // Relayed audio must come from the host; it belongs to the original talker's seat
    const seat = viaHost ? (call.peer === hostPeer() && md.relayOf !== me() ? md.relayOf : -1) : seatOfPeer(call.peer);
    if (window.__voiceLog) console.log('[Voice] incoming from', call.peer, 'seat', seat, viaHost ? '(relayed)' : '');
    // The host keeps talkers' lines even with its own voice off: other players may need them relayed
    const keepForRelay = !viaHost && amHost();
    if (seat < 0 || (getPref() === 'off' && !keepForRelay)) { try { call.close(); } catch (_) {} return; }
    const key = viaHost ? 'relay:' + seat : call.peer;
    const prev = inCalls.get(key);
    if (prev) { try { prev.call.close(); } catch (_) {} }
    const audio = new Audio();
    audio.autoplay = true; audio.setAttribute('playsinline', ''); audio.dataset.seat = seat;
    audio.muted = getPref() === 'off';
    const entry = { call, audio, seat, viaHost, stream: null };
    inCalls.set(key, entry);
    if (viaHost) { relayed.add(seat); muteDirect(seat); }
    if (dataHear.has(seat)) audio.muted = true;
    call.on('stream', (remote) => {
      entry.stream = remote;
      audio.srcObject = remote;
      if ((!viaHost && relayed.has(seat)) || dataHear.has(seat)) audio.muted = true;  // already hearing them another way
      const p = audio.play();
      if (p && p.catch) p.catch(() => { pendingAudio.add(audio); toast('Tap the screen to hear voice chat'); });
      if (!viaHost && amHost()) forwardAllFrom(seat);          // pass this talker on to anyone who needs it
    });
    const end = (why) => {
      if (window.__voiceLog) console.log('[Voice] incoming ended', call.peer, why && (why.type || why.message || why));
      if (inCalls.get(key) === entry) inCalls.delete(key);
      if (viaHost && !inCalls.has(key)) {           // relay ended: fall back to the direct line, if any
        relayed.delete(seat);
        const pid = peerOfSeat(seat), d = pid && inCalls.get(pid);
        if (d) d.audio.muted = getPref() === 'off';
      }
      try { audio.pause(); audio.srcObject = null; } catch (_) {}
      pendingAudio.delete(audio);
    };
    call.on('close', () => end('close')); call.on('error', e => end(e));
    call.answer();   // listen only: we send nothing back
  }
  function muteDirect(seat) {
    const pid = peerOfSeat(seat); const e = pid && inCalls.get(pid);
    if (e) e.audio.muted = true;
  }
  // ---------- relay through the host ----------
  // Listener: ask the host to pass this talker's audio on to us
  function askRelay(seat) {
    if (amHost() || relayed.has(seat)) return;
    const hp = hostPeer(); if (!hp || peerOfSeat(seat) === hp) return; // the host talks to us directly
    if (relayAsked[seat] && Date.now() - relayAsked[seat] < 1500) return;
    relayAsked[seat] = Date.now(); relayStats.asked++;
    try { Game.sendVoiceRelay && Game.sendVoiceRelay(seat); } catch (_) {}
  }
  // Host: a listener asked for a talker
  function onRelayRequest(listenerSeat, talkerSeat) {
    if (!amHost() || listenerSeat === talkerSeat || talkerSeat === me() || listenerSeat === me()) return;
    relayPairs.add(talkerSeat + '>' + listenerSeat);
    forward(talkerSeat, listenerSeat);
  }
  function streamFrom(seat) {
    const pid = peerOfSeat(seat); const e = pid && inCalls.get(pid);
    return e && e.stream && e.stream.getAudioTracks().some(t => t.readyState === 'live') ? e.stream : null;
  }
  function forward(T, L) {
    const key = T + '>' + L, stream = streamFrom(T), lp = peerOfSeat(L);
    if (!stream || !lp) return; // talker's line to us isn't up yet: forwarded when it is
    const cur = fwd.get(key);
    if (cur && !cur._failed && cur._stream === stream) {
      const ice = cur.peerConnection && cur.peerConnection.iceConnectionState;
      if (!['failed', 'closed', 'disconnected'].includes(ice)) return;   // already passing it on
    }
    if (cur) { try { cur.close(); } catch (_) {} fwd.delete(key); }
    const c = Network.callPeer(lp, stream, { v: 1, relayOf: T });
    if (!c) return;
    c._stream = stream; fwd.set(key, c); relayStats.forwarded++;
    const drop = () => { if (fwd.get(key) === c) fwd.delete(key); };
    c.on('close', drop); c.on('error', () => { c._failed = true; drop(); });
  }
  function forwardAllFrom(T) { for (const k of relayPairs) { const [t, l] = k.split('>').map(Number); if (t === T) forward(t, l); } }
  function pruneRelay() {
    const s = st();
    for (const k of Array.from(relayPairs)) {
      const [t, l] = k.split('>').map(Number);
      if (!amHost() || !peerOfSeat(t) || !peerOfSeat(l)) { relayPairs.delete(k); const c = fwd.get(k); if (c) { try { c.close(); } catch (_) {} fwd.delete(k); } }
    }
    if (!s) relayed.clear();
  }

  // ---------- voice over the game connection ----------
  function audioCtx() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      try { actx = new AC(); outGain = actx.createGain(); outGain.connect(actx.destination); } catch (_) { actx = null; return null; }
    }
    if (actx.state === 'suspended' || actx.state === 'interrupted') actx.resume().catch(() => {});
    return actx;
  }
  // G.711 mu-law: 8 bits per sample, good enough for speech
  function mulawEnc(x) {
    let v = Math.max(-1, Math.min(1, x)) * 32635, sign = v < 0 ? 0x80 : 0; if (sign) v = -v;
    v += 132; let e = 7; for (let m = 0x4000; (v & m) === 0 && e > 0; m >>= 1) e--;
    return ~(sign | (e << 4) | ((v >> (e + 3)) & 0x0f)) & 0xff;
  }
  const MU = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const u = ~i & 0xff, sign = u & 0x80, e = (u >> 4) & 7, m = u & 0x0f; const v = (((m << 3) + 132) << e) - 132; MU[i] = (sign ? -v : v) / 32768; }
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 4096) s += String.fromCharCode.apply(null, u8.subarray(i, i + 4096)); return btoa(s); };
  const unb64 = (str) => { const s = atob(str), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

  function needFeed() {
    if (amHost()) { for (const k of dataPairs) if (+k.split('>')[0] === me()) return true; return false; }
    return feedOn;
  }
  function startFeed() {
    if (cap || !live || !mic || !needFeed()) return;
    const c = audioCtx(); if (!c) return;
    try {
      const src = c.createMediaStreamSource(mic);
      const proc = c.createScriptProcessor(4096, 1, 1);
      const ratio = Math.max(1, Math.round(c.sampleRate / DATA_RATE)), rate = c.sampleRate / ratio;
      let seq = 0;
      proc.onaudioprocess = (ev) => {
        if (!live) return;
        const x = ev.inputBuffer.getChannelData(0), n = Math.floor(x.length / ratio), out = new Uint8Array(n);
        for (let i = 0; i < n; i++) { let a = 0; for (let j = 0; j < ratio; j++) a += x[i * ratio + j]; out[i] = mulawEnc(a / ratio); }
        sendChunk({ r: rate, q: seq++, d: b64(out) });
      };
      const sink = c.createGain(); sink.gain.value = 0;   // keeps the processor running, makes no sound
      src.connect(proc); proc.connect(sink); sink.connect(c.destination);
      cap = { src, proc, sink }; dataStats.fed++;
      if (pressed) setButton('live');
    } catch (_) { cap = null; }
  }
  function stopFeed() {
    if (!cap) return;
    try { cap.proc.onaudioprocess = null; cap.src.disconnect(); cap.proc.disconnect(); cap.sink.disconnect(); } catch (_) {}
    cap = null;
  }
  function sendChunk(chunk) {
    dataStats.sent++;
    try {
      if (!amHost()) { Game.sendVoicePcm && Game.sendVoicePcm(chunk); return; }
      for (const k of dataPairs) { const [t, l] = k.split('>').map(Number); if (t === me()) Game.sendVoicePcmTo(l, Object.assign({ seat: t }, chunk)); }
    } catch (_) {}
  }
  // Listener: ask for a talker's voice over the game connection
  function askData(seat) {
    dataHear.add(seat);
    if (dataAsked[seat] && Date.now() - dataAsked[seat] < 1500) return;
    dataAsked[seat] = Date.now(); dataStats.asked++;
    audioCtx();
    try { if (amHost()) onDataWant(me(), seat); else Game.sendVoiceWant && Game.sendVoiceWant(seat); } catch (_) {}
  }
  // Host: listener L needs talker T's voice as chunks
  function onDataWant(L, T) {
    if (!amHost() || L === T || !Number.isInteger(L) || !Number.isInteger(T)) return;
    dataPairs.add(T + '>' + L);
    if (T === me()) startFeed();
    else { try { Game.sendVoiceFeed && Game.sendVoiceFeed(T, true); } catch (_) {} }
  }
  // Talker (client): the host says someone needs our voice as chunks
  function onFeed(on) { feedOn = !!on; if (feedOn) startFeed(); else stopFeed(); }
  // Host: a chunk from talker T — play it if we need it, pass it on to others who do
  function onPcmFromClient(T, chunk) {
    if (!amHost() || !chunk || typeof chunk.d !== 'string') return;
    if (dataHear.has(T)) playPcm(T, chunk);
    for (const k of dataPairs) { const [t, l] = k.split('>').map(Number); if (t === T && l !== me()) { try { Game.sendVoicePcmTo(l, { seat: T, r: chunk.r, q: chunk.q, d: chunk.d }); } catch (_) {} } }
  }
  function onPcm(seat, chunk) {
    if (!Number.isInteger(seat) || seat === me() || !dataHear.has(seat) || !chunk || typeof chunk.d !== 'string') return;
    playPcm(seat, chunk);
  }
  function playPcm(seat, chunk) {
    if (getPref() === 'off') return;
    const c = audioCtx(); if (!c) return;
    if (c.state !== 'running') { if (!tapWarned) { tapWarned = true; toast('Tap the screen to hear voice chat'); } return; }
    let u; try { u = unb64(chunk.d); } catch (_) { return; }
    if (u.length > 20000) return;
    const r = +chunk.r > 3000 ? +chunk.r : DATA_RATE, up = c.sampleRate / r, n = Math.floor(u.length * up);
    if (n < 2) return;
    const buf = c.createBuffer(1, n, c.sampleRate), ch = buf.getChannelData(0);
    let e = 0;
    for (let i = 0; i < n; i++) { const p = i / up, k = Math.floor(p), f = p - k, a = MU[u[k]], b = k + 1 < u.length ? MU[u[k + 1]] : a; ch[i] = a + (b - a) * f; e += ch[i] * ch[i]; }
    const P = play[seat] || (play[seat] = { next: 0, t: 0, rms: 0 });
    const now = c.currentTime;
    if (P.next < now + 0.02 || P.next > now + 0.9) P.next = now + 0.2;   // small cushion against uneven arrival
    const src = c.createBufferSource(); src.buffer = buf; src.connect(outGain); src.start(P.next);
    P.next += buf.duration; P.t = Date.now(); P.rms = Math.sqrt(e / n);
    dataStats.recv++;
    muteDirect(seat); const rl = inCalls.get('relay:' + seat); if (rl) rl.audio.muted = true;
  }
  const dataRecent = (seat) => dataHear.has(seat) && play[seat] && Date.now() - play[seat].t < 1500;
  function pruneData() {
    for (const k of Array.from(dataPairs)) {
      const [t, l] = k.split('>').map(Number);
      if (!amHost() || !peerOfSeat(t) && t !== me() || !peerOfSeat(l) && l !== me()) {
        dataPairs.delete(k);
        if (amHost() && t !== me() && peerOfSeat(t) && ![...dataPairs].some(x => +x.split('>')[0] === t)) { try { Game.sendVoiceFeed(t, false); } catch (_) {} }
      }
    }
    if (amHost() && !needFeed()) stopFeed();
    if (!st()) { dataHear.clear(); feedOn = false; stopFeed(); }
  }

  // Browsers that refused to start audio without a tap get another go on the next tap
  ['pointerdown', 'touchend', 'click'].forEach(ev => window.addEventListener(ev, () => {
    for (const a of Array.from(pendingAudio)) { a.play().then(() => pendingAudio.delete(a)).catch(() => {}); }
    if (actx && (actx.state === 'closed' || actxStuck)) {          // rebuild a sound engine the phone broke
      try { if (actx.state !== 'closed') actx.close(); } catch (_) {}
      actx = null; actxStuck = false; for (const k in play) play[k].next = 0; audioCtx();
    } else if (actx && actx.state !== 'running') actx.resume().then(() => { tapWarned = false; }).catch(() => {});
  }, { passive: true, capture: true }));
  // Back from another app: restart incoming voice and check the sound engine still ticks
  let actxStuck = false;
  function wake() {
    if (document.hidden) return;
    for (const e of inCalls.values()) {
      const a = e.audio;
      if (a && a.srcObject && a.paused) { const p = a.play(); if (p && p.catch) p.catch(() => pendingAudio.add(a)); }
    }
    if (actx) {
      const c = actx, t0 = c.currentTime;
      if (c.state !== 'running') c.resume().catch(() => {});
      setTimeout(() => { if (actx === c && (c.state !== 'running' || c.currentTime === t0)) actxStuck = true; }, 600);
    }
  }
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('pageshow', wake);
  window.addEventListener('focus', wake);

  // Music and voice clips dip while someone talks
  function duck(on) { try { if (typeof Sound !== 'undefined' && Sound.duck) Sound.duck(on || talking.size > 0); } catch (_) {} }

  // ---------- who is talking ----------
  function setTalking(seat, on) {
    if (!Number.isInteger(seat) || seat < 0) return;
    clearTimeout(talkTimers[seat]);
    if (on) {
      talking.add(seat);
      talkTimers[seat] = setTimeout(() => setTalking(seat, false), MAX_TALK_MS + 3000); // safety net
      if (seat !== me()) watchIncoming(seat, 0);
      if (amHost()) forwardAllFrom(seat);
    } else talking.delete(seat);
    const el = document.querySelector(`#player-positions .table-player[data-seat="${seat}"]`);
    if (el) el.classList.toggle('talking', talking.has(seat));
    if (seat !== me()) duck(live);
  }
  function isTalking(seat) { return talking.has(seat); }

  // Listener-side check: someone is shown talking, so their audio should be
  // arriving. If it isn't after ~1.2 s, ask their phone to redial us.
  async function packetsOn(e) {
    if (!e || !e.call.peerConnection) return 0;
    let n = 0;
    try { (await e.call.peerConnection.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'audio') n = x.packetsReceived || 0; }); } catch (_) {}
    return n;
  }
  function directUp(seat) {
    const pid = peerOfSeat(seat), e = pid && inCalls.get(pid), pc = e && e.call.peerConnection;
    return !!(pc && (pc.connectionState === 'connected' || ['connected', 'completed'].includes(pc.iceConnectionState)));
  }
  async function packetsFrom(seat) {
    const pid = peerOfSeat(seat);
    return Math.max(await packetsOn(pid && inCalls.get(pid)), await packetsOn(inCalls.get('relay:' + seat)));
  }
  function watchIncoming(seat, tries) {
    if (getPref() === 'off') return;
    setTimeout(async () => {
      if (!talking.has(seat)) return;
      if (dataRecent(seat)) return;                       // arriving over the game connection
      if (!dataHear.has(seat) && await packetsFrom(seat) > 0) return;
      // Nothing arriving: ask the talker to redial, and the host to pass their audio on.
      // Whichever path works first is used; the host path is kept for the rest of the game.
      try { if (Game.sendVoiceNudge) Game.sendVoiceNudge(seat); } catch (_) {}
      // Give the direct line a fair chance first (~2 s); a line still not connected by then won't
      if (tries >= 1 && !directUp(seat)) askRelay(seat);
      // Still nothing: send it over the game connection. Straight away when no relay is possible
      // (only two phones, or the host is one end), otherwise once the relay had its chance too.
      const canRelay = !amHost() && peerOfSeat(seat) !== hostPeer();
      if (dataHear.has(seat) || (tries >= 1 && !canRelay && !directUp(seat)) || tries >= 2) askData(seat);
      if (tries < 4) watchIncoming(seat, tries + 1);
    }, tries ? 1000 : 900);
  }
  // Talker side: a listener says our audio isn't reaching them — redial them
  let nudges = 0;
  function onNudge(fromSeat) {
    nudges++;
    if (!mic || !Number.isInteger(fromSeat)) return;
    const s = st(); const pid = s && s.players[fromSeat] && s.players[fromSeat].peerId;
    if (!pid || !targets().some(t => t.peerId === pid)) return;
    const c = outCalls.get(pid);
    if (c && c._nudgedAt && Date.now() - c._nudgedAt < 1000) return;
    if (c) { try { c.close(); } catch (_) {} outCalls.delete(pid); }
    dial(pid, mic, 1);
    const nc = outCalls.get(pid); if (nc) nc._nudgedAt = Date.now();
  }

  // ---------- button ----------
  function setButton(mode) {
    const b = document.getElementById('ptt-btn'); if (!b) return;
    b.classList.toggle('connecting', mode === 'connecting');
    b.classList.toggle('live', mode === 'live');
    b.setAttribute('aria-pressed', mode === 'idle' ? 'false' : 'true');
    const lab = b.querySelector('.ptt-label');
    if (lab) lab.textContent = mode === 'live' ? 'Talking' : mode === 'connecting' ? 'Connecting' : '';
  }
  function refresh() {
    const b = document.getElementById('ptt-btn'); if (!b) return;
    const show = available();
    b.style.display = show ? 'flex' : 'none';
    if (!show && pressed) stop();
    if (!show && !pressed && (mic || outCalls.size) && !document.getElementById('game-screen')?.classList.contains('active')) releaseMic();
    // Close incoming lines from players who are no longer at the table
    for (const [key, e] of inCalls) {
      const gone = e.viaHost ? (!peerOfSeat(e.seat) || e.call.peer !== hostPeer()) : seatOfPeer(key) < 0;
      if (gone) { try { e.call.close(); } catch (_) {} inCalls.delete(key); if (e.viaHost) relayed.delete(e.seat); }
    }
    pruneRelay();
    pruneData();
  }
  function bindButton() {
    const b = document.getElementById('ptt-btn'); if (!b || b._bound) return;
    b._bound = true;
    const down = (e) => { e.preventDefault(); try { b.setPointerCapture && e.pointerId != null && b.setPointerCapture(e.pointerId); } catch (_) {} start(); };
    const up = (e) => { if (e) e.preventDefault(); stop(); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', () => stop());
    b.addEventListener('contextmenu', e => e.preventDefault());
    // Keyboard: hold V (or Space/Enter on the focused button)
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
      if ((e.key === 'v' || e.key === 'V') && !typing) { e.preventDefault(); start(); }
      else if (document.activeElement === b && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); start(); }
    });
    window.addEventListener('keyup', e => {
      if (e.key === 'v' || e.key === 'V' || ((e.key === ' ' || e.key === 'Enter') && document.activeElement === b)) stop();
    });
  }

  function init() {
    bindButton();
    if (typeof Network !== 'undefined' && Network.onCall) Network.onCall(onIncomingCall);
    setInterval(refresh, 1000);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); releaseMic(); } });
    window.addEventListener('blur', () => stop());
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  function setPref(v) {
    lsSet(LS_KEY, v === 'off' ? 'off' : 'on');
    if (v === 'off') { stop(); releaseMic(); for (const e of inCalls.values()) { try { e.call.close(); } catch (_) {} } dataHear.clear(); }
    refresh();
  }

  return {
    getPref, setPref, setTalking, isTalking, refresh, onNudge, onRelayRequest,
    onDataWant, onFeed, onPcm, onPcmFromClient,
    // test hooks
    __debug: { nudges: () => nudges, data: () => ({ ...dataStats, hear: [...dataHear], pairs: [...dataPairs], feedOn, capturing: !!cap, ctx: actx && actx.state, rms: Object.fromEntries(Object.entries(play).map(([k, v]) => [k, Date.now() - v.t < 1500 ? +v.rms.toFixed(4) : 0])) }),
      relay: () => ({ ...relayStats, relayed: [...relayed], pairs: [...relayPairs], fwd: fwd.size, directDead: directDead.size }), outCalls: () => outCalls.size, inCalls: () => inCalls.size, micOpen: () => !!mic, live: () => live, blocked: () => blocked,
      inAudios: () => Array.from(inCalls.values()).map(e => e.audio), start, stop,
      stats: async () => { const out = []; for (const [pid, c] of outCalls) { const r = await c.peerConnection.getStats(); r.forEach(x => { if (x.type === 'outbound-rtp') out.push({ dir: 'out', pid, bytes: x.bytesSent, pk: x.packetsSent }); if (x.type === 'transport') out.push({ pid, dtls: x.dtlsState, ice: x.iceState }); }); out.push({ pid, conn: c.peerConnection.connectionState, sig: c.peerConnection.signalingState }); }
        for (const [pid, e] of inCalls) { const r = await e.call.peerConnection.getStats(); r.forEach(x => { if (x.type === 'inbound-rtp') out.push({ dir: 'in', pid, bytes: x.bytesReceived, pk: x.packetsReceived }); }); }
        for (const [pid, c] of outCalls) { const snd = c.peerConnection.getSenders().map(s => s.track ? s.track.readyState + ':' + s.track.enabled : 'none'); out.push({ pid, senders: snd, sdp: (c.peerConnection.localDescription?.sdp.match(/a=(sendrecv|sendonly|recvonly|inactive)/g) || []).join(','), rsdp: (c.peerConnection.remoteDescription?.sdp.match(/a=(sendrecv|sendonly|recvonly|inactive)/g) || []).join(',') }); }
        return out; },
      inPc: (pid) => inCalls.get(pid)?.call.peerConnection,
      lines: () => Array.from(outCalls.entries()).map(([pid, c]) => ({ pid, open: c.open, ice: c.peerConnection && c.peerConnection.iceConnectionState })),
      inLines: () => Array.from(inCalls.entries()).map(([pid, e]) => ({ pid, open: e.call.open, ice: e.call.peerConnection && e.call.peerConnection.iceConnectionState, tracks: e.audio.srcObject ? e.audio.srcObject.getAudioTracks().map(t => t.readyState + ':' + t.muted) : null, paused: e.audio.paused })) },
  };
})();
