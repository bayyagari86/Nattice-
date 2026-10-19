// ============================================================
// VOICE — push-to-talk for online games.
//
// Hold the mic button to talk; release to stop. Only the person holding
// the button sends audio: their phone opens a one-way audio call to each
// other human player (direct, or through the TURN relay when phones can't
// reach each other). Nothing is recorded or sent while the button is up.
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
    // "Connecting" until every listener's line is up (or 1.5 s with at least one up,
    // so one slow phone doesn't hold everyone back)
    const began = Date.now();
    const check = () => {
      if (!pressed) return;
      const { up, total } = linesUp();
      if (up > 0 && (up === total || Date.now() - began > 1500)) setButton('live');
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
    const seat = seatOfPeer(call.peer);
    if (window.__voiceLog) console.log('[Voice] incoming from', call.peer, 'seat', seat);
    if (seat < 0 || getPref() === 'off') { try { call.close(); } catch (_) {} return; }
    const prev = inCalls.get(call.peer);
    if (prev) { try { prev.call.close(); } catch (_) {} }
    const audio = new Audio();
    audio.autoplay = true; audio.setAttribute('playsinline', ''); audio.dataset.seat = seat;
    const entry = { call, audio };
    inCalls.set(call.peer, entry);
    call.on('stream', (remote) => {
      audio.srcObject = remote;
      const p = audio.play();
      if (p && p.catch) p.catch(() => { pendingAudio.add(audio); toast('Tap the screen to hear voice chat'); });
    });
    const end = (why) => {
      if (window.__voiceLog) console.log('[Voice] incoming ended', call.peer, why && (why.type || why.message || why));
      if (inCalls.get(call.peer) === entry) inCalls.delete(call.peer);
      try { audio.pause(); audio.srcObject = null; } catch (_) {}
      pendingAudio.delete(audio);
    };
    call.on('close', () => end('close')); call.on('error', e => end(e));
    call.answer();   // listen only: we send nothing back
  }
  // Browsers that refused to start audio without a tap get another go on the next tap
  ['pointerdown', 'touchend', 'click'].forEach(ev => window.addEventListener(ev, () => {
    for (const a of Array.from(pendingAudio)) { a.play().then(() => pendingAudio.delete(a)).catch(() => {}); }
  }, { passive: true, capture: true }));

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
    } else talking.delete(seat);
    const el = document.querySelector(`#player-positions .table-player[data-seat="${seat}"]`);
    if (el) el.classList.toggle('talking', talking.has(seat));
    if (seat !== me()) duck(live);
  }
  function isTalking(seat) { return talking.has(seat); }

  // Listener-side check: someone is shown talking, so their audio should be
  // arriving. If it isn't after ~1.2 s, ask their phone to redial us.
  async function packetsFrom(seat) {
    const s = st(); const pid = s && s.players[seat] && s.players[seat].peerId;
    const e = pid && inCalls.get(pid);
    if (!e || !e.call.peerConnection) return 0;
    let n = 0;
    try { (await e.call.peerConnection.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'audio') n = x.packetsReceived || 0; }); } catch (_) {}
    return n;
  }
  function watchIncoming(seat, tries) {
    if (getPref() === 'off') return;
    setTimeout(async () => {
      if (!talking.has(seat)) return;
      if (await packetsFrom(seat) > 0) return;
      try { if (Game.sendVoiceNudge) Game.sendVoiceNudge(seat); } catch (_) {}
      if (tries < 2) watchIncoming(seat, tries + 1);
    }, 1200);
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
    for (const [pid, e] of inCalls) if (seatOfPeer(pid) < 0) { try { e.call.close(); } catch (_) {} }
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
    if (v === 'off') { stop(); releaseMic(); for (const e of inCalls.values()) { try { e.call.close(); } catch (_) {} } }
    refresh();
  }

  return {
    getPref, setPref, setTalking, isTalking, refresh, onNudge,
    // test hooks
    __debug: { nudges: () => nudges, outCalls: () => outCalls.size, inCalls: () => inCalls.size, micOpen: () => !!mic, live: () => live, blocked: () => blocked,
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
