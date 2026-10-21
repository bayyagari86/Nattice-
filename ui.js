// ============================================================
// UI MODULE — Rendering & Interactions
// ============================================================

const UI = (() => {
  // Card rendering
  // Time on the host's clock (falls back to this device's clock)
  const nowHost = () => { try { return (typeof Game !== 'undefined' && Game.hostNow) ? Game.hostNow() : Date.now(); } catch (_) { return Date.now(); } };
  const SUIT_SYMBOLS = {
    spades: '\u2660', hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', notrump: '\u2668', joker: '\u2605'
  };
  const SUIT_COLORS = {
    spades: '#1a1a2e', hearts: '#c0392b', diamonds: '#c0392b', clubs: '#1a1a2e', notrump: '#ffd700', joker: '#8e44ad'
  };

  let toastTimeout = null;
  const glow = { key: null, seat: null, len: 0, shakeUntil: 0 };

  let badgePopupTimeout = null;

  // Countdown intervals — kept module-scoped so we can clear/replace as state updates arrive.
  let raiseCountdownInterval = null;
  let turnCountdownInterval = null;

  function simulateGameplay(mode) {
    if (!Game || !Game.state) return;
    
    console.log(`Simulating gameplay mode: ${mode}`);
    
    // Simple automated gameplay
    const gameplayInterval = setInterval(() => {
      if (!Game.state || Game.state.phase === 'LOBBY') {
        // Wait for game to start
        return;
      }
      
      if (Game.state.phase === 'PLAYING' && Game.state.currentRound.currentPlayer === Game.mySeat) {
        // Auto-play first available card
        const hand = Game.state.hands[Game.mySeat] || [];
        if (hand.length > 0) {
          const card = hand[0];
          Game.playCard(card.id);
          console.log(`Auto-played card: ${card.rank}${card.suit}`);
        }
      }
      
      // Stop simulation after certain conditions
      if (mode === 'play' && Game.state.currentRound.tricksPlayed >= 3) {
        clearInterval(gameplayInterval);
        console.log('Gameplay simulation completed (play mode)');
      } else if (mode === 'full' && Game.state.phase === 'GAME_OVER') {
        clearInterval(gameplayInterval);
        console.log('Gameplay simulation completed (full mode)');
      }
    }, 3000);
  }

  function init() {
    if (typeof Extras !== 'undefined') Extras.init();
    wireTrickDrawer();
    // Track console errors for automation
    if (!window.consoleErrors) {
      window.consoleErrors = [];
      const originalError = console.error;
      console.error = function(...args) {
        window.consoleErrors.push(args.join(' '));
        originalError.apply(console, args);
      };
    }

    // Check for automation params
    const urlParams = new URLSearchParams(window.location.search);
    const auto = urlParams.get('auto');
    const mode = urlParams.get('mode');
    const gameNum = urlParams.get('game');
    
    // Auto-host for multi-room testing
    if (auto === 'true' && mode === 'host') {
      const hostName = gameNum ? `Host${gameNum}` : 'AutoHost';
      showToast(`Auto-hosting as ${hostName}...`);
      setTimeout(() => {
        Game.hostGame(hostName)
          .then(roomCode => {
            const hostId = Network.getPeerId();
            window.hostResult = { success: true, roomCode, hostId };
            console.log(`Auto-hosted: Room ${roomCode}, Host ${hostId}`);
          })
          .catch(err => {
            window.hostResult = { success: false, error: err.message };
            console.error('Auto-host failed:', err);
          });
      }, 800);
      return;
    }

    // Check for QR code join params in URL
    const qrHost = urlParams.get('host');
    const qrRoom = urlParams.get('room');
    const userName = urlParams.get('user');
    
    if (qrRoom) {
      // Auto-join for browser automation
      if (auto === 'true' && userName) {
        showToast(`Auto-joining as ${userName}...`);
        setTimeout(() => {
          Game.joinGame(userName.trim(), qrRoom.trim().toUpperCase())
            .then(() => {
              // Store result for automation to read
              window.autoJoinResult = { success: true, user: userName };
              if (mode === 'play' || mode === 'full') {
                setTimeout(() => simulateGameplay(mode), 2000);
              }
            })
            .catch(err => {
              window.autoJoinResult = { success: false, error: err.message };
              console.error('Auto-join failed:', err);
            });
        }, 800);
      } else {
        // Regular QR code / URL join - auto open dialog with room pre-filled
        showToast(`Joining room ${qrRoom}...`);
        setTimeout(() => showJoinDialog(qrRoom), 800);
      }
    }

    setupRejoin(qrRoom || auto === 'true');

    initProfile();
    document.getElementById('solo-btn').addEventListener('click', startSoloGame);
    document.getElementById('host-btn').addEventListener('click', showHostDialog);
    document.getElementById('join-btn').addEventListener('click', showJoinDialog);
    document.getElementById('rules-btn').addEventListener('click', showRules);

    // Badges panel toggle
    document.getElementById('badges-toggle').addEventListener('click', toggleBadgesPanel);
    document.getElementById('badges-close').addEventListener('click', () => {
      document.getElementById('badges-panel').classList.remove('open');
    });

    // Leave the room from the lobby (also cancels a rejoin in progress)
    document.getElementById('leave-lobby-btn').addEventListener('click', () => {
      const st = Game.getState && Game.getState();
      const others = st && st.players ? st.players.filter((p, i) => p && !p.isAI && i !== Game.getMySeat()).length : 0;
      const iHost = typeof Network !== 'undefined' && Network.getIsHost && Network.getIsHost();
      if (others > 0 && !confirm(iHost ? 'Leave and close this room for everyone?' : 'Leave this room?')) return;
      rejoinCancelled = true;
      Game.leaveGame();
      const rb = document.getElementById('rejoin-btn'); if (rb) rb.style.display = 'none';
    });

    // Chat drawer toggle
    document.getElementById('chat-toggle-btn').addEventListener('click', () => {
      document.getElementById('chat-area').classList.add('open');
      document.getElementById('chat-unread').style.display = 'none';
      document.getElementById('chat-unread').textContent = '0';
      setTimeout(() => document.getElementById('chat-input').focus(), 300);
    });
    document.getElementById('chat-close-btn').addEventListener('click', () => {
      document.getElementById('chat-area').classList.remove('open');
    });

    // Send chat on Enter
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = e.target.value.trim();
        if (val) { Game.sendChat(val); e.target.value = ''; }
      }
    });

    // Register badge earned callback
    Badges.onBadgeEarned((badge) => {
      showBadgePopup(badge);
      updatePointsDisplay();
    });
  }

  // === REJOIN (after refresh / crash / closed tab) ===
  function setupRejoin(suppressAuto) {
    const btn = document.getElementById('rejoin-btn');
    const session = Game.getSavedSession && Game.getSavedSession();
    if (!btn) return;
    if (!session) { btn.style.display = 'none'; return; }
    btn.style.display = 'block';
    btn.textContent = `Rejoin game ${session.roomCode}`;
    btn.onclick = () => rejoinSaved();
    // Fresh session (e.g. an accidental refresh mid-game) → rejoin at once
    if (!suppressAuto && Date.now() - session.savedAt < 10 * 60 * 1000) {
      setTimeout(rejoinSaved, 300);
    }
  }

  let rejoinInFlight = false, rejoinCancelled = false;
  function rejoinSaved() {
    if (rejoinInFlight) return;
    rejoinInFlight = true;
    rejoinCancelled = false;
    const btn = document.getElementById('rejoin-btn');
    showScreen('lobby-screen');
    // Fresh lobby: nothing from a previous room, and only Leave is usable
    document.getElementById('room-code-section').style.display = 'none';
    document.getElementById('start-game-btn').style.display = 'none';
    const wa = document.getElementById('wa-invite-btn'); if (wa) wa.style.display = 'none';
    document.getElementById('lobby-seats').innerHTML = '';
    document.getElementById('lobby-status').textContent = 'Rejoining your game\u2026 Tap Leave room to start over.';
    Game.resumeSavedSession()
      .then(() => { if (btn) btn.style.display = 'none'; })
      .catch(err => {
        if (rejoinCancelled) return;
        showToast(err.message || 'Could not rejoin');
        Game.clearSession();
        if (btn) btn.style.display = 'none';
        showScreen('title-screen');
      })
      .finally(() => { rejoinInFlight = false; });
  }

  // Persistent banner while the connection is being repaired
  function showConnectionBanner(text) {
    let el = document.getElementById('connection-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'connection-banner';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    if (text) {
      el.textContent = text;
      el.classList.add('show');
    } else {
      el.classList.remove('show');
    }
  }

  // === PROFILE: your name is asked once, saved on this phone, and reused for every game ===
  const LS_PROFILE = 'nattis.profile';
  function getProfile() {
    try { const p = JSON.parse(localStorage.getItem(LS_PROFILE) || 'null'); return p && p.name ? p : null; } catch (e) { return null; }
  }
  function saveProfileName(name) {
    const n = String(name || '').trim().slice(0, 20);
    if (!n) return null;
    const p = Object.assign({}, getProfile() || {}, { name: n, updated: Date.now() });
    try { localStorage.setItem(LS_PROFILE, JSON.stringify(p)); } catch (e) {}
    refreshProfileUI();
    return n;
  }
  function refreshProfileUI() {
    const p = getProfile();
    const chip = document.getElementById('profile-chip');
    if (chip) {
      chip.style.display = p ? '' : 'none';
      if (p) chip.innerHTML = `<span class="pc-avatar">${escapeHtml(p.name.trim().charAt(0).toUpperCase())}</span><span>Playing as <b>${escapeHtml(p.name)}</b></span><span class="pc-edit">Change</span>`;
    }
    const inp = document.getElementById('profile-name');
    if (inp && document.activeElement !== inp) inp.value = p ? p.name : '';
    const pv = document.getElementById('profile-voice');
    if (pv) {
      const cur = (p && p.voice) || '';
      pv.innerHTML = [['m', 'Male voice', 'Your reactions'], ['f', 'Female voice', 'Your reactions'], ['', 'Auto', 'Game picks']]
        .map(([k, l, sub]) => `<button class="seg-opt ${cur === k ? 'selected' : ''}" data-pv="${k}"><b>${l}</b><small>${sub}</small></button>`).join('');
      pv.querySelectorAll('.seg-opt').forEach(b => b.onclick = () => {
        const prof = getProfile() || { name: '' };
        prof.voice = b.dataset.pv;
        try { localStorage.setItem(LS_PROFILE, JSON.stringify(prof)); } catch (e) {}
        refreshProfileUI();
        // Hear it straight away, and use it for your seat in the current game
        const st = typeof Game !== 'undefined' && Game.getState && Game.getState();
        const me = typeof Game !== 'undefined' && Game.getMySeat ? Game.getMySeat() : 0;
        if (st && st.players && st.players[me]) st.players[me].voice = prof.voice;
        if (typeof Sound !== 'undefined' && Sound.getSfx() === 'voice') { Sound.unlock(); Sound.reaction({ id: 'o3', mood: 'celebrate' }, me, { voice: prof.voice, name: prof.name }); }
      });
    }
  }
  function editProfile() {
    const p = getProfile();
    showInputDialog('Your name', 'Player', (name) => { saveProfileName(name); showToast(`Saved — you're ${getProfile().name}`); }, p ? p.name : '');
  }
  // Runs cb(name) straight away when a profile exists; asks once otherwise and saves the answer.
  function withProfileName(cb) {
    const p = getProfile();
    if (p) { cb(p.name); return; }
    showInputDialog('What should we call you?', 'Player', (name) => {
      cb(saveProfileName(name) || name);
    }, '', 'Saved on this phone — you won\'t be asked again. Change it any time from your name on the home screen.');
  }
  function initProfile() {
    document.getElementById('profile-chip')?.addEventListener('click', editProfile);
    const save = () => { const v = document.getElementById('profile-name')?.value; if (saveProfileName(v)) showToast('Name saved'); };
    document.getElementById('profile-save')?.addEventListener('click', save);
    document.getElementById('profile-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    refreshProfileUI();
  }

  function startSoloGame() {
    withProfileName((name) => {
      showScreen('game-screen');
      Badges.reset();
      updatePointsDisplay();
      renderBadgesGrid();
      Game.startSoloGame(name);
    });
  }

  // === TITLE SCREEN ===
  function showHostDialog() {
    withProfileName((name) => {
      showScreen('lobby-screen');
      document.getElementById('lobby-status').textContent = 'Creating room...';
      Game.hostGame(name).then(roomCode => {
        const hostId = Network.getPeerId() || '';
        document.getElementById('room-code-display').textContent = roomCode;
        document.getElementById('host-id-display').textContent = hostId;
        document.getElementById('room-code-section').style.display = 'flex';
        document.getElementById('lobby-status').textContent = 'Waiting for players...';
        document.getElementById('start-game-btn').style.display = 'block';
        document.getElementById('start-game-btn').onclick = () => Game.startGame(); // onclick: hosting again never stacks handlers
        try { updateLobby(Game.getState(), Game.getMySeat()); } catch (_) {}   // right label from the start

        // Generate QR code with room code only URL
        const qrContainer = document.getElementById('qr-code-container');
        const qrEl = document.getElementById('qr-code');
        const qrUrlEl = document.getElementById('qr-join-url');
        if (roomCode) {
          const joinUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
          
          // Display clickable URL text
          if (qrUrlEl) {
            qrUrlEl.innerHTML = `<a href="${joinUrl}" target="_blank" style="color:#6c8ebf;text-decoration:underline">${joinUrl}</a>`;
          }
          
          // Generate QR code if library loaded
          if (typeof QRCode !== 'undefined') {
            try {
              qrEl.innerHTML = '';
              new QRCode(qrEl, {
                text: joinUrl,
                width: 140, height: 140,
                colorDark: '#0d1219', colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H,
              });
            } catch (e) {
              console.error('QR generation failed:', e);
              qrEl.innerHTML = '<div style="padding:20px;color:#999">QR code unavailable</div>';
            }
          }
          qrContainer.style.display = 'flex';
          const wa = document.getElementById('wa-invite-btn');
          if (wa && typeof Extras !== 'undefined') {
            wa.style.display = 'block';
            wa.onclick = () => Extras.inviteOnWhatsApp(joinUrl, roomCode);
          }
        }
      }).catch(err => {
        showToast('Failed to create room: ' + err.message);
        showScreen('title-screen');
      });
    });
  }

  function showJoinDialog(prefillRoom = '') {
    if (typeof prefillRoom !== 'string') prefillRoom = ''; // button clicks pass an event
    const prof = getProfile();
    const go = (name, code) => {
      showScreen('lobby-screen');
      document.getElementById('lobby-status').textContent = 'Joining room...';
      Game.joinGame(name, code.trim().toUpperCase()).catch(err => {
        showToast('Failed to join: ' + err.message);
        showScreen('title-screen');
      });
    };
    if (prof && prefillRoom) { go(prof.name, prefillRoom); return; } // invite link + saved profile: straight in
    const fields = prof ? [] : [{ label: 'Your Name', placeholder: 'Player', key: 'name', value: '' }];
    fields.push({ label: 'Room Code', placeholder: 'ABC123', key: 'code', value: prefillRoom });
    showMultiInputDialog(fields, (vals) => {
      if (prof) vals.name = prof.name;
      if (!vals.name || !vals.code) { showToast('Name and Room Code required'); return; }
      saveProfileName(vals.name);
      go(vals.name.trim(), vals.code);
    });
  }

  // === INPUT DIALOGS (PWA-friendly, no prompt()) ===
  function showInputDialog(label, placeholder, callback, initial = '', note = '') {
    const overlay = document.getElementById('input-overlay');
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="input-dialog">
        <label>${label}</label>
        <input type="text" id="dialog-input" placeholder="${placeholder}" autocomplete="off" maxlength="20" value="${escapeHtml(initial)}">
        ${note ? `<p class="dialog-note">${escapeHtml(note)}</p>` : ''}
        <div class="dialog-btns">
          <button class="bid-btn pass-btn" id="dialog-cancel">Cancel</button>
          <button class="bid-btn" id="dialog-ok" style="background:var(--accent-gold);color:#000">OK</button>
        </div>
      </div>
    `;
    const input = document.getElementById('dialog-input');
    input.focus();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('dialog-ok').click(); });
    document.getElementById('dialog-cancel').addEventListener('click', () => { overlay.style.display = 'none'; });
    document.getElementById('dialog-ok').addEventListener('click', () => {
      const val = input.value.trim() || placeholder;
      overlay.style.display = 'none';
      callback(val);
    });
  }

  function showMultiInputDialog(fields, callback) {
    const overlay = document.getElementById('input-overlay');
    overlay.style.display = 'flex';
    const fieldsHtml = fields.map(f => `
      <div class="dialog-field">
        <label>${f.label}</label>
        <input type="text" data-key="${f.key}" placeholder="${f.placeholder}" value="${f.value || ''}" autocomplete="off" maxlength="30">
      </div>
    `).join('');
    overlay.innerHTML = `
      <div class="input-dialog">
        ${fieldsHtml}
        <div class="dialog-btns">
          <button class="bid-btn pass-btn" id="dialog-cancel">Cancel</button>
          <button class="bid-btn" id="dialog-ok" style="background:var(--accent-gold);color:#000">Join</button>
        </div>
      </div>
    `;
    overlay.querySelector('input').focus();
    document.getElementById('dialog-cancel').addEventListener('click', () => { overlay.style.display = 'none'; });
    document.getElementById('dialog-ok').addEventListener('click', () => {
      const vals = {};
      overlay.querySelectorAll('input').forEach(inp => {
        vals[inp.dataset.key] = inp.value.trim() || inp.placeholder;
      });
      overlay.style.display = 'none';
      callback(vals);
    });
  }

  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
  }

  // === BADGES UI ===
  function toggleBadgesPanel() {
    const panel = document.getElementById('badges-panel');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      renderBadgesGrid();
    }
  }

  function renderBadgesGrid() {
    const grid = document.getElementById('badges-grid');
    const all = Badges.getAllBadges();
    const earned = Badges.getEarnedBadges();
    const earnedIds = new Set(earned.map(b => b.id));

    grid.innerHTML = all.map(b => {
      const isEarned = earnedIds.has(b.id);
      return `
        <div class="badge-item ${isEarned ? 'earned' : 'locked'}">
          <div class="badge-icon">${b.icon}</div>
          <div class="badge-name">${b.name}</div>
          <div class="badge-desc">${b.desc}</div>
          ${b.pts > 0 ? `<div class="badge-pts-label">${isEarned ? '+' : ''}${b.pts} pts</div>` : ''}
        </div>
      `;
    }).join('');
  }

  function updatePointsDisplay() {
    const pts = Badges.getPoints();
    const topbarEl = document.getElementById('topbar-points');
    const panelEl = document.getElementById('panel-points');
    if (topbarEl) topbarEl.textContent = pts;
    if (panelEl) panelEl.textContent = pts;
  }

  function showBadgePopup(badge) {
    const popup = document.getElementById('badge-popup');
    popup.innerHTML = `
      <div class="popup-icon">${badge.icon}</div>
      <div class="popup-text">
        <div class="popup-title">Badge Earned</div>
        <div class="popup-name">${badge.name}</div>
        ${badge.pts > 0 ? `<div class="popup-pts">+${badge.pts} pts</div>` : ''}
      </div>
    `;
    popup.classList.add('show');
    if (badgePopupTimeout) clearTimeout(badgePopupTimeout);
    badgePopupTimeout = setTimeout(() => popup.classList.remove('show'), 3500);
  }

  // === SHUFFLE / DEAL ANIMATION ===
  function showShuffleAnimation() {
    return new Promise((resolve) => {
      const overlay = document.getElementById('shuffle-overlay');
      const text = document.getElementById('shuffle-text');
      overlay.classList.add('active');
      text.textContent = 'Shuffling...';

      // Phase 1: Shuffle for 1.2s
      setTimeout(() => {
        text.textContent = 'Dealing cards...';
        // Phase 2: Deal animation
        const deck = overlay.querySelector('.shuffle-deck');
        // Stop shuffle animations
        const cards = deck.querySelectorAll('.shuffle-card');
        cards.forEach(c => {
          c.style.animation = 'none';
        });

        // Create deal cards flying out
        for (let i = 0; i < 6; i++) {
          setTimeout(() => {
            const dealCard = document.createElement('div');
            dealCard.className = 'deal-card';
            dealCard.style.animation = `dealToPlayer${i} 0.4s ease-in forwards`;
            deck.appendChild(dealCard);
            // Remove after animation
            setTimeout(() => dealCard.remove(), 450);
          }, i * 120);
        }

        // Trigger 3D FX deal animation on the game table
        if (typeof FX !== 'undefined') {
          const positions = getPlayerPositions();
          FX.dealCards(positions);
        }

        // End after dealing animation
        setTimeout(() => {
          overlay.classList.remove('active');
          // Reset shuffle card animations
          cards.forEach(c => {
            c.style.animation = '';
          });
          resolve();
        }, 1200);
      }, 1200);
    });
  }

  // === LOBBY ===
  function updateLobby(state, mySeat) {
    const seatsDiv = document.getElementById('lobby-seats');
    seatsDiv.innerHTML = '';

    const iAmHost = typeof Network !== 'undefined' && Network.getIsHost && Network.getIsHost();

    let humanCount = 0;
    for (let i = 0; i < 6; i++) {
      const player = state.players[i];
      const team = Engine.getTeam(i);
      const seatEl = document.createElement('div');
      seatEl.className = `lobby-seat ${player ? 'occupied' : 'empty'} team-${team.toLowerCase()}`;
      if (i === mySeat) seatEl.classList.add('me');

      const statusBadge = player && player.connected === false
        ? '<div class="seat-dc">Disconnected \u2013 bot playing</div>'
        : (player ? '<div class="seat-ok">\u2713 Connected</div>' : '');

      // Host-only kick button (never on your own seat or on empty seats)
      const kickBtn = (iAmHost && player && i !== mySeat)
        ? `<button class="seat-kick-btn" data-kick-seat="${i}" title="Kick this player">\u2715</button>`
        : '';

      seatEl.innerHTML = `
        <div class="seat-number">Seat ${i + 1}</div>
        <div class="seat-team">Team ${team}</div>
        <div class="seat-name">${player ? player.name : 'Empty'}</div>
        ${statusBadge}
        ${kickBtn}
      `;
      seatsDiv.appendChild(seatEl);
      if (player && !player.isAI) humanCount++;
    }

    // Wire kick buttons — host only
    if (iAmHost) {
      seatsDiv.querySelectorAll('[data-kick-seat]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const seat = Number(btn.getAttribute('data-kick-seat'));
          if (confirm('Kick player from seat ' + (seat + 1) + '?')) {
            Game.kickPlayer && Game.kickPlayer(seat);
          }
        });
      });
    }

    // Player count + Start-Now button state
    const status = document.getElementById('lobby-status');
    if (status && state.phase === 'WAITING') {
      status.textContent = `${humanCount}/6 players joined \u2014 ${humanCount >= 2 ? 'ready to start' : 'waiting...'}`;
    }
    const startBtn = document.getElementById('start-game-btn');
    if (startBtn && iAmHost && state.phase === 'WAITING') {
      startBtn.style.display = 'block';
      startBtn.textContent = humanCount >= 6 ? 'Starting...'
        : humanCount < 2 ? 'Play now with 5 bots' : `Start Now (fill ${6 - humanCount} with bots)`;
      startBtn.disabled = false;
    }

    // Show host ID for sharing
    const hostInfo = document.getElementById('host-id-display');
    if (hostInfo) {
      hostInfo.textContent = Network.getPeerId() || '';
    }
  }

  // === GAME TABLE ===
  // Last rendered state, so layout can be redrawn on rotation/resize
  let lastRender = null;

  // Phones held sideways: wide but very short table. Seats, trick and HUD
  // switch to a compact arrangement so nothing overlaps.
  // Anything landscape up to 700px tall (foldables such as iPhone Duo opened
  // sideways, small tablets, short laptop windows): full-size seats crowd the trick.
  function isCompactLandscape() {
    return window.innerWidth > window.innerHeight && window.innerHeight <= 700;
  }
  // Short portrait screens (small phones with browser bars showing): same
  // compact seats, arranged for a tall, narrow table.
  function isCompactPortrait() {
    return window.innerWidth <= window.innerHeight && window.innerHeight <= 700;
  }
  function applyLayoutMode() {
    document.body.classList.toggle('compact-land', isCompactLandscape());
    document.body.classList.toggle('compact-port', isCompactPortrait());
  }
  applyLayoutMode();

  // The hand is laid out with pixel positions for the current screen width,
  // so it must be redrawn whenever the viewport changes (rotation, split
  // screen, browser bars). Also keeps action panels docked above the hand.
  function syncHandHeight() {
    const area = document.querySelector('.hand-area');
    if (!area) return;
    const h = area.getBoundingClientRect().height;
    if (h > 0) document.documentElement.style.setProperty('--hand-h', Math.round(h) + 'px');
  }
  let relayoutTimer = null;
  function relayout() {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(() => {
      applyLayoutMode();
      if (lastRender && lastRender.state && lastRender.state.hands &&
          document.getElementById('game-screen').classList.contains('active')) {
        const { state, mySeat } = lastRender;
        renderPlayers(state, mySeat);
        renderHand(state, mySeat);
        renderTrick(state);
      }
      syncHandHeight();
    }, 120);
  }
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', relayout);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', relayout);

  function updateAll(state, mySeat) {
    if (!state) return;
    if (state.phase === 'WAITING') return;
    lastRender = { state, mySeat };
    applyLayoutMode();
    // Only switch screen once — avoid triggering CSS reflows on every update
    if (state.phase !== 'GAME_OVER') {
      const gameScreen = document.getElementById('game-screen');
      if (!gameScreen.classList.contains('active')) showScreen('game-screen');
    }

    renderScoreboard(state, mySeat);
    renderPlayers(state, mySeat);
    renderHand(state, mySeat);
    renderTrick(state);
    renderGameInfo(state, mySeat);
    renderRoundHistory(state, mySeat);
    renderBiddingUI(state, mySeat);
    renderTrumpSelectUI(state, mySeat);
    renderRaiseUI(state, mySeat);
    renderBidProgress(state, mySeat);
    renderTrickDrawer(state, mySeat);
    hostWatch(state, mySeat);
    if (typeof Extras !== 'undefined' && Extras.updateLight) Extras.updateLight(state);
    if (state.phase === 'BIDDING' && typeof Extras !== 'undefined') Extras.greetIfFestival();
    syncHandHeight();
  }

  // Bid progress: bidding team's tricks fill from the left, defenders' from
  // the right; the gold notch marks the bid. Shows "made" / "broken" states.
  function renderBidProgress(state, mySeat) {
    const el = document.getElementById('bid-progress');
    if (!el) return;
    const r = state.currentRound;
    const show = r && r.bid > 0 && r.biddingTeam && ['PLAYING', 'RAISE_CHECK', 'ROUND_END'].includes(state.phase);
    if (!show) { el.classList.remove('show'); el.innerHTML = ''; return; }
    const bt = r.biddingTeam, dt = bt === 'A' ? 'B' : 'A';
    const mine = bt === Engine.getTeam(mySeat);
    const got = (r.tricksTaken && r.tricksTaken[bt]) || 0;
    const def = (r.tricksTaken && r.tricksTaken[dt]) || 0;
    const need = Math.max(0, r.bid - got);
    const breakAt = 9 - r.bid + 1;            // defender tricks that break the bid
    const made = got >= r.bid, broken = def >= breakAt;
    let segs = '';
    for (let i = 0; i < 9; i++) {
      let cls = 'seg';
      if (i < got) cls += ` fill team-${bt.toLowerCase()}`;
      else if (i >= 9 - def) cls += ` fill team-${dt.toLowerCase()}`;
      if (i === r.bid - 1) cls += ' bid-mark';
      if (!made && !broken && i === got && need === 1) cls += ' next';
      segs += `<span class="${cls}"></span>`;
    }
    const label = made ? `Bid made! ${got}/${r.bid}`
      : broken ? `Bid broken — ${dt === Engine.getTeam(mySeat) ? 'your team' : 'Team ' + dt} stopped it`
      : `${mine ? 'Your team' : 'Team ' + bt} needs ${need} more · ${got}/${r.bid}`;
    el.className = `show ${made ? 'made' : ''} ${broken ? 'broken' : ''} ${need === 1 && !broken ? 'danger' : ''}`;
    el.innerHTML = `<span class="bp-team team-name-${bt.toLowerCase()}">${bt}</span>
      <span class="bp-track">${segs}</span>
      <span class="bp-team team-name-${dt.toLowerCase()}">${dt}</span>
      <span class="bp-label">${label}</span>`;
  }

  function renderScoreboard(state, mySeat) {
    const myTeam = Engine.getTeam(mySeat);
    const oppTeam = myTeam === 'A' ? 'B' : 'A';
    document.getElementById('my-team-score').textContent = state.scores[myTeam];
    document.getElementById('opp-team-score').textContent = state.scores[oppTeam];
    document.getElementById('my-team-label').innerHTML = `<span class="lbl-team">Team </span>${myTeam} (You)`;
    document.getElementById('opp-team-label').innerHTML = `<span class="lbl-team">Team </span>${oppTeam}`;

    // Tricks taken this round
    const round = state.currentRound;
    document.getElementById('my-team-tricks').textContent = round.tricksTaken[myTeam] || 0;
    document.getElementById('opp-team-tricks').textContent = round.tricksTaken[oppTeam] || 0;

    // Bid info — show bidder name + team + target tricks
    const bidInfo = document.getElementById('bid-info');
    if (round.bid > 0) {
      const bidder = state.players[round.bidder];
      bidInfo.textContent = `Bid ${round.bid} · ${bidder ? bidder.name : '?'} (${round.biddingTeam || Engine.getTeam(round.bidder)})`;
    } else if (state.phase === 'BIDDING') {
      const currentBidder = state.players[round.currentBidder];
      bidInfo.textContent = currentBidder ? `${currentBidder.name} bidding…` : 'Bidding…';
    } else {
      bidInfo.textContent = '';
    }

    // Trump info
    const trumpInfo = document.getElementById('trump-info');
    if (round.trumpSuit) {
      const TRUMP_BANNER_COLORS = { spades: '#e0e0e0', hearts: '#ff6b6b', diamonds: '#ff8c42', clubs: '#a8d8a8', notrump: '#ffd700', joker: '#c084fc' };
      const trumpText = round.trumpSuit === 'notrump' ? 'No Trump' : `${SUIT_SYMBOLS[round.trumpSuit]} ${round.trumpSuit.toUpperCase()}`;
      trumpInfo.innerHTML = `<span class="lbl-trump">Trump: </span><span class="trump-suit" style="color:${TRUMP_BANNER_COLORS[round.trumpSuit] || '#e0e0e0'}">${trumpText}</span>`;
    } else {
      trumpInfo.textContent = '';
    }

    // Trick counter — show current trick number and whose turn
    const trickCounter = document.getElementById('trick-counter');
    if (state.phase === 'PLAYING' || state.phase === 'RAISE_CHECK') {
      const trickNum = round.tricksPlayed + 1;
      const currentPlayer = state.players[round.currentPlayer];
      const turnName = round.currentPlayer === mySeat ? 'Your turn' : (currentPlayer ? `${currentPlayer.name}'s turn` : '');
      trickCounter.textContent = `Trick ${trickNum}/9 · ${turnName}`;
    } else {
      trickCounter.textContent = '';
    }
  }

  function renderPlayers(state, mySeat) {
    const tableEl = document.getElementById('player-positions');
    tableEl.innerHTML = '';

    // Arrange 6 players around a hexagonal table, with mySeat at bottom
    const positions = getPlayerPositions();

    for (let i = 0; i < 6; i++) {
      const seat = (mySeat + i) % 6;
      const player = state.players[seat];
      if (!player) continue;

      const pos = positions[i];
      const team = Engine.getTeam(seat);
      const isCurrentPlayer = state.currentRound.currentPlayer === seat;
      const isBidder = state.currentRound.bidder === seat;

      const el = document.createElement('div');
      el.className = `table-player ${isCurrentPlayer ? 'active' : ''} ${seat === mySeat ? 'me' : ''} ${i === 3 ? 'seat-top' : ''} team-${team.toLowerCase()}`;
      el.style.cssText = `left:${pos.x}%;top:${pos.y}%;`;
      el.dataset.seat = seat;
      if (typeof Voice !== 'undefined' && Voice.isTalking(seat)) el.classList.add('talking');

      // Build card backs HTML for other players
      let cardBacksHtml = '';
      if (seat !== mySeat) {
        // Other hands are private; the host shares only their sizes
        const cardCount = (state.hands[seat] && state.hands[seat].length) ||
          (Array.isArray(state.handCounts) ? state.handCounts[seat] || 0 : 0);
        if (cardCount > 0) {
          // Show up to 9 mini card backs fanned out
          const showCount = Math.min(cardCount, 9);
          let backs = '';
          for (let c = 0; c < showCount; c++) {
            backs += '<div class="card-back"></div>';
          }
          cardBacksHtml = `<div class="player-card-backs">${backs}</div>`;
          cardBacksHtml += `<div class="player-cards-count">${cardCount} cards</div>`;
        }
      }

      // Odia quirky phrase reactions — label on button, full Odia script phrase floats
      // Bar = your 6 most-used reactions + "More" (Odia, village taunts, English)
      const ODIA_REACTIONS = (typeof Extras !== 'undefined' && Extras.getBarReactions)
        ? Extras.getBarReactions().map(r => ({ label: r.label, phrase: r.phrase, chat: r.phrase }))
        : [{ label: '👍 ସହି!', phrase: 'ସହି ବାତ! 👍', chat: 'ସହି ବାତ! 👍' }];
      const reactionBarHtml = seat === mySeat
        ? `<div class="reaction-bar">${ODIA_REACTIONS.map((r,idx) =>
            `<button class="reaction-btn" data-idx="${idx}">${escapeHtml(r.label)}</button>`
          ).join('')}<button class="reaction-btn reaction-more" data-more="1" aria-label="More reactions">+ More</button></div>`
        : '';
      // Store reactions on element for event binding
      el._odiaReactions = ODIA_REACTIONS;

      el.innerHTML = `
        <div class="reaction-float" id="reaction-float-${seat}"></div>
        <div class="player-avatar">${player.name.charAt(0).toUpperCase()}<span class="talk-badge" aria-hidden="true"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2z"/></svg></span></div>
        <div class="player-name team-name-${team.toLowerCase()}">${seat === mySeat ? 'You' : player.name}${player.isAI ? ' \ud83e\udd16' : ''}</div>
        <div class="player-meta">${seat !== mySeat && team === Engine.getTeam(mySeat) ? '<span class="partner-tag">Partner</span>' : `Team ${team}`}${isBidder ? ' \u00b7 Bidder' : ''}${seat === state.dealer ? ' \u00b7 Dealer' : ''}${goalChip(state, seat)}</div>
        ${reactionBarHtml}
        ${cardBacksHtml}
      `;

      // Wire up Odia reaction buttons
      el.querySelectorAll('.reaction-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (btn.dataset.more) {
            if (typeof Extras !== 'undefined') Extras.openReactionPicker(sendReaction);
            return;
          }
          const idx = parseInt(btn.dataset.idx);
          const reaction = el._odiaReactions[idx];
          if (!reaction) return;
          sendReaction(reaction.phrase);
        });
      });

      tableEl.appendChild(el);
    }
    keepSeatsOnScreen(tableEl);
  }

  // Narrow screens: a seat whose card fan spills past the table edge is nudged back inside
  function keepSeatsOnScreen(tableEl) {
    if (isCompactLandscape()) return;
    const T = (tableEl.closest('.game-table') || tableEl).getBoundingClientRect();
    const L = Math.max(T.left, 0) + 2, R = Math.min(T.right, window.innerWidth) - 2;
    tableEl.querySelectorAll('.table-player:not(.me)').forEach((el) => {
      const kids = [...el.children].filter(k => !k.classList.contains('reaction-float') && k.getBoundingClientRect().width > 0);
      if (!kids.length) return;
      const l = Math.min(...kids.map(k => k.getBoundingClientRect().left));
      const r = Math.max(...kids.map(k => k.getBoundingClientRect().right));
      let dx = 0;
      if (l < L) dx = L - l; else if (r > R) dx = R - r;
      if (Math.abs(dx) < 1) return;
      el.style.transition = 'none';
      el.style.left = `calc(${el.style.left} + ${Math.round(dx)}px)`;
      void el.offsetWidth;
      el.style.transition = '';
    });
  }

  function getPlayerPositions() {
    if (isCompactLandscape()) {
      // Wide, short table: three opponents across the top, one each side
      return [
        { x: 50, y: 100 },  // Me — reaction row docked to the bottom edge (CSS)
        { x: 11, y: 60 },   // Bottom-left
        { x: 26, y: 15 },   // Top-left
        { x: 50, y: 15 },   // Top
        { x: 74, y: 15 },   // Top-right
        { x: 89, y: 60 },   // Bottom-right
      ];
    }
    if (isCompactPortrait()) {
      return [
        { x: 50, y: 100 },  // Me — reaction row docked to the bottom edge (CSS)
        { x: 14, y: 66 },   // Bottom-left
        { x: 14, y: 28 },   // Top-left
        { x: 50, y: 8 },    // Top
        { x: 86, y: 28 },   // Top-right
        { x: 86, y: 66 },   // Bottom-right
      ];
    }
    // 6 positions around table, index 0 = bottom center (me)
    return [
      { x: 50, y: 72 },   // Bottom (me)
      { x: 12, y: 58 },   // Bottom-left
      { x: 12, y: 25 },   // Top-left
      { x: 50, y: 8 },    // Top
      { x: 88, y: 25 },   // Top-right
      { x: 88, y: 58 },   // Bottom-right
    ];
  }

  function renderHand(state, mySeat) {
    const handEl = document.getElementById('my-hand');
    const hand = state.hands[mySeat];

    if (!hand || hand.length === 0) {
      handEl.innerHTML = '';
      return;
    }

    const sorted = Engine.sortHand(hand, state.currentRound.trumpSuit);
    const isLeading = !state.currentRound.currentTrick || state.currentRound.currentTrick.length === 0;
    const leadSuit = !isLeading
      ? (state.currentRound.currentTrick[0].card.suit === 'joker' ? null : state.currentRound.currentTrick[0].card.suit)
      : null;
    const isMyTurn = state.phase === 'PLAYING' && state.currentRound.currentPlayer === mySeat &&
      (state.currentRound.currentTrick || []).length < 6; // not while a finished trick is on the table
    const playable = isMyTurn
      ? Engine.getPlayableCards(hand, leadSuit, isLeading)
      : [];

    handEl.innerHTML = '';
    const total = sorted.length;
    const screenW = window.innerWidth;
    const isMobile = screenW < 641;
    const isSmallPhone = screenW <= 390; // iPhone SE, Mini, standard 12/13/14

    // Arc parameters — shrink cards on small phones so 9 cards always fit
    const maxAngle = Math.min(4 * (total - 1), isSmallPhone ? 30 : 36);
    const arcRise = isMobile ? (isSmallPhone ? 14 : 18) : 0;
    const cardW = isMobile ? (isSmallPhone ? 48 : 58) : 58;
    let overlap = isMobile ? (isSmallPhone ? 22 : 18) : 10;
    const handW = handEl.offsetWidth || window.innerWidth;
    // Squeeze the fan so it always fits (split screen, folding phones, odd widths);
    // 28px each side leaves room for the outer cards' tilt.
    const maxFanW = handW - (isMobile ? 56 : 16);
    if (isMobile && total > 1 && cardW * total - overlap * (total - 1) > maxFanW) {
      overlap = Math.ceil((cardW * total - maxFanW) / (total - 1));
    }
    const totalWidth = cardW * total - overlap * (total - 1);
    const startX = handW / 2 - totalWidth / 2;

    sorted.forEach((card, idx) => {
      const isPlayable = !!playable.find(c => c.id === card.id);
      const isTrump = card.suit === state.currentRound.trumpSuit;
      let color = SUIT_COLORS[card.suit] || '#333';
      if (card.id === 'BIG_JOKER') color = '#c0392b';
      if (card.id === 'SMALL_JOKER') color = '#1a1a2e';
      const symbol = SUIT_SYMBOLS[card.suit] || '';
      let displayRank = card.rank;
      if (card.id === 'BIG_JOKER') displayRank = 'BIG';
      if (card.id === 'SMALL_JOKER') displayRank = 'SM';

      // Arc math: cards fan from -maxAngle/2 to +maxAngle/2
      const t = total > 1 ? idx / (total - 1) : 0.5;
      const angle = isMobile ? (t - 0.5) * maxAngle : 0;
      // Cards in middle rise up more than edges
      const yOffset = isMobile ? arcRise * (1 - Math.abs(t - 0.5) * 2) : 0;
      const x = startX + idx * (cardW - overlap);
      const y = isMobile ? (arcRise - yOffset) : 0;

      const cardEl = document.createElement('div');
      cardEl.className = `card ${isPlayable ? 'playable' : ''} ${state.phase === 'PLAYING' && !isMyTurn ? 'waiting' : ''} ${isTrump ? 'trump-card' : ''} ${card.suit === 'joker' ? 'joker-card' : ''}`;
      cardEl.dataset.cardId = card.id;
      cardEl.style.cssText = isMobile
        ? `left:${x}px; top:${y}px; transform:rotate(${angle}deg); z-index:${idx + 1};`
        : `z-index:${idx + 1};`;
      cardEl.innerHTML = `
        <div class="card-inner" style="color:${color}">
          <div class="card-corner top">
            <div class="card-rank">${displayRank}</div>
            <div class="card-suit">${symbol}</div>
          </div>
          <div class="card-center">${symbol}</div>
          <div class="card-corner bottom">
            <div class="card-rank">${displayRank}</div>
            <div class="card-suit">${symbol}</div>
          </div>
        </div>
      `;
      if (isPlayable && isMyTurn) {
        cardEl.addEventListener('click', () => {
          if (typeof FX !== 'undefined') {
            const rect = cardEl.getBoundingClientRect();
            const trickPos = getTrickCardPositions();
            const targetPos = trickPos[0];
            const innerHtml = cardEl.querySelector('.card-inner') ? cardEl.querySelector('.card-inner').innerHTML : '';
            FX.cardPlayFly(rect, targetPos.x, targetPos.y, innerHtml);
          }
          cardEl.classList.add('played');
          Game.playCard(card.id);
        });
        // On mobile lift the card up on touch for visual feedback
        if (isMobile) {
          cardEl.addEventListener('touchstart', () => {
            cardEl.style.transform = `rotate(${angle}deg) translateY(-22px) scale(1.08)`;
            cardEl.style.zIndex = 50;
            cardEl.style.boxShadow = '0 16px 40px rgba(240,192,64,0.55)';
          }, { passive: true });
          cardEl.addEventListener('touchend', () => {
            cardEl.style.transform = `rotate(${angle}deg)`;
            cardEl.style.zIndex = idx + 1;
            cardEl.style.boxShadow = '';
          }, { passive: true });
        }
      }
      handEl.appendChild(cardEl);
    });
  }

  function renderTrick(state) {
    const trickEl = document.getElementById('current-trick');
    trickEl.innerHTML = '';

    const trick = state.currentRound.currentTrick;
    if (!trick || trick.length === 0) return;

    const mySeat = Game.getMySeat();
    const positions = getTrickCardPositions();

    // Which card is winning right now? Glow follows it; a shake marks a takeover.
    let winningSeat = null;
    try { winningSeat = Engine.determineTrickWinnerRefined(trick, state.currentRound.trumpSuit); } catch (e) {}
    const trickKey = `${trick[0].playerIndex}:${trick[0].card.id}`;
    const now = Date.now();
    if (glow.key === trickKey && glow.seat !== null && winningSeat !== glow.seat && trick.length > glow.len) {
      glow.shakeUntil = now + 650;
    } else if (glow.key !== trickKey) {
      glow.shakeUntil = 0;
    }
    glow.key = trickKey; glow.seat = winningSeat; glow.len = trick.length;
    const shaking = now < glow.shakeUntil;

    trick.forEach(({ playerIndex, card }) => {
      const relIdx = ((playerIndex - mySeat + 6) % 6);
      const pos = positions[relIdx];
      let color = SUIT_COLORS[card.suit] || '#333';
      if (card.id === 'BIG_JOKER') color = '#c0392b';
      if (card.id === 'SMALL_JOKER') color = '#1a1a2e';
      const symbol = SUIT_SYMBOLS[card.suit] || '';
      let displayRank = card.rank;
      if (card.id === 'BIG_JOKER') displayRank = 'BIG';
      if (card.id === 'SMALL_JOKER') displayRank = 'SM';

      // Get player name for label
      const player = state.players[playerIndex];
      const playerLabel = playerIndex === mySeat ? 'You' : (player ? player.name : '?');

      const el = document.createElement('div');
      const isWin = playerIndex === winningSeat;
      el.className = `trick-card ${card.suit === 'joker' ? 'joker-card' : ''} ${isWin ? 'winning' : ''} ${isWin && shaking ? 'overtake' : ''}`;
      if (isWin) el.dataset.winning = '1';
      el.style.cssText = `left:${pos.x}%;top:${pos.y}%;`;
      el.innerHTML = `
        <div class="card-mini" style="color:${color}">
          <span class="card-rank">${displayRank}</span>
          <span class="card-suit">${symbol}</span>
        </div>
        <div class="trick-card-label team-name-${Engine.getTeam(playerIndex).toLowerCase()}">${playerLabel}</div>
      `;
      trickEl.appendChild(el);
    });
  }

  function getTrickCardPositions() {
    if (isCompactLandscape()) {
      // Two rows of three, mirroring the seats: top row = top seats
      return [
        { x: 50, y: 70 },   // Me
        { x: 41, y: 70 },   // Left
        { x: 41, y: 41 },   // Top-left
        { x: 50, y: 41 },   // Top
        { x: 59, y: 41 },   // Top-right
        { x: 59, y: 70 },   // Right
      ];
    }
    // Fit the trick between the top seat and my own seat so cards never sit on a name
    const fitted = fitTrickPositions();
    if (fitted) return fitted;
    // Positions closer to center for trick cards
    return [
      { x: 50, y: 62 },   // Me (bottom)
      { x: 35, y: 52 },   // Left
      { x: 35, y: 35 },   // Top-left
      { x: 50, y: 28 },   // Top
      { x: 65, y: 35 },   // Top-right
      { x: 65, y: 52 },   // Right
    ];
  }

  function fitTrickPositions() {
    const table = document.querySelector('.game-table');
    const top = document.querySelector('#player-positions .table-player.seat-top');
    // My avatar, or (compact layouts) the reaction row that replaces it
    let meAv = document.querySelector('#player-positions .table-player.me .player-avatar');
    if (meAv && !meAv.getBoundingClientRect().height) meAv = document.querySelector('#player-positions .table-player.me .reaction-bar');
    if (!table || !top || !meAv || !meAv.getBoundingClientRect().height) return null;
    const T = table.getBoundingClientRect();
    if (T.height < 200) return null;
    const half = document.body.classList.contains('compact-port') ? 29
      : (window.innerWidth <= 640 ? 68 : 70) / 2 + 8;   // half a trick card incl. its label
    const lo = top.getBoundingClientRect().bottom - T.top + 4 + half;
    const hi = meAv.getBoundingClientRect().top - T.top - 8 - half;
    if (!(hi > lo)) return null;
    const topC = lo, meC = Math.max(lo + 2 * half, hi);
    const mid = (topC + meC) / 2, gap = Math.max(half + 2, (meC - topC) * 0.25);
    const pct = (px) => Math.max(0, Math.min(100, (px / T.height) * 100));
    const L = T.width <= 340 ? 37 : 35, R = 100 - L;   // narrowest phones: pull side cards inward
    return [
      { x: 50, y: pct(meC) },        // Me (bottom)
      { x: L, y: pct(mid + gap) },   // Left
      { x: L, y: pct(mid - gap) },   // Top-left
      { x: 50, y: pct(topC) },       // Top
      { x: R, y: pct(mid - gap) },   // Top-right
      { x: R, y: pct(mid + gap) },   // Right
    ];
  }

  function renderGameInfo(state, mySeat) {
    const infoEl = document.getElementById('game-info');
    const current = state.currentRound.currentPlayer;
    const player = state.players[current];

    if (state.phase === 'BIDDING') {
      if (current === mySeat) {
        infoEl.textContent = 'Your turn to bid';
      } else {
        infoEl.textContent = `${player ? player.name : '?'} is bidding...`;
      }
    } else if (state.phase === 'TRUMP_SELECT') {
      if (state.currentRound.bidder === mySeat) {
        infoEl.textContent = 'Select the trump suit';
      } else {
        const bidder = state.players[state.currentRound.bidder];
        infoEl.textContent = `${bidder ? bidder.name : '?'} is selecting trump...`;
      }
    } else if (state.phase === 'PLAYING') {
      if (current === mySeat) {
        infoEl.textContent = 'Your turn \u2014 play a card';
      } else {
        infoEl.textContent = `${player ? player.name : '?'} is playing...`;
      }
    } else if (state.phase === 'RAISE_CHECK') {
      { const o = Engine.raiseOptions(state); infoEl.textContent = `Bidding team can raise ${state.currentRound.bid} → up to ${o.length ? o[o.length - 1] : state.currentRound.bid}${o.includes(8) ? ' (8 LS' + (o.includes(9) ? ', 9 GS)' : ')') : o.includes(9) ? ' (9 GS)' : ''}…`; }
    } else if (state.phase === 'ROUND_END') {
      infoEl.textContent = 'Round over \u2014 next round starting...';
    } else if (state.phase === 'SHUFFLING') {
      infoEl.textContent = 'Shuffling cards...';
    }

    // Trick counter
    document.getElementById('trick-counter').textContent = `Trick ${state.currentRound.tricksPlayed + 1} of 9`;

    // Live turn countdown — shown to everyone when the host has armed a turnDeadline
    // (only fires for human non-host players). Uses a deadline broadcast so all clients
    // stay in sync without host-→client tick messages.
    renderTurnCountdown(state, mySeat);
  }

  function renderTurnCountdown(state, mySeat) {
    if (turnCountdownInterval) { clearInterval(turnCountdownInterval); turnCountdownInterval = null; }
    const infoEl = document.getElementById('game-info');
    if (!infoEl) return;
    const deadline = state.currentRound?.turnDeadline;
    const currentSeat = state.currentRound?.currentPlayer;
    // Show timer only in-round while someone else's clock is ticking; hide on your own turn
    if (!deadline || state.phase === 'ROUND_END' || state.phase === 'GAME_OVER') return;
    if (currentSeat === mySeat) return;

    const basePlayer = state.players[currentSeat];
    const baseText = infoEl.textContent;

    const tick = () => {
      const secs = Math.max(0, Math.ceil((deadline - nowHost()) / 1000));
      if (!document.body.contains(infoEl)) {
        clearInterval(turnCountdownInterval); turnCountdownInterval = null; return;
      }
      const suffix = secs > 0 ? ` \u23f1 ${secs}s` : '';
      // Preserve the base sentence — append/replace suffix only
      const stripped = baseText.replace(/ \u23f1 \d+s$/, '');
      infoEl.textContent = stripped + suffix;
      if (secs <= 0) { clearInterval(turnCountdownInterval); turnCountdownInterval = null; }
    };
    tick();
    turnCountdownInterval = setInterval(tick, 500);
  }

  // === ROUND HISTORY ===
  function renderRoundHistory(state, mySeat) {
    const el = document.getElementById('round-history');
    if (!el) return;
    const history = state.roundHistory;
    if (!history || history.length === 0) {
      el.innerHTML = '';
      return;
    }

    const myTeam = Engine.getTeam(mySeat);
    const oppTeam = myTeam === 'A' ? 'B' : 'A';

    // Count rounds won by each team
    let myRoundsWon = 0;
    let oppRoundsWon = 0;
    for (const r of history) {
      if ((r.scoreChange[myTeam] || 0) > 0) myRoundsWon++;
      else if ((r.scoreChange[oppTeam] || 0) > 0) oppRoundsWon++;
    }

    // Build compact round dots
    let dotsHtml = '';
    for (let i = 0; i < history.length; i++) {
      const r = history[i];
      const myPts = r.scoreChange[myTeam] || 0;
      const oppPts = r.scoreChange[oppTeam] || 0;
      let dotClass = 'draw';
      let label = '=';
      if (myPts > 0) { dotClass = 'team-a'; label = '+' + myPts; }
      else if (oppPts > 0) { dotClass = 'team-b'; label = '+' + oppPts; }
      dotsHtml += `<div class="round-dot ${dotClass}" title="Round ${i + 1}: ${label}">${i + 1}</div>`;
    }

    el.innerHTML = `
      <div class="round-history-label">Rounds</div>
      <div class="round-history-row">${dotsHtml}</div>
      <div class="round-history-score">You ${myRoundsWon} \u2013 ${oppRoundsWon} Opp</div>
    `;
    // Scrollable row: open at the latest round, fade the edge that has more
    const row = el.querySelector('.round-history-row');
    if (row) {
      const fade = () => {
        row.classList.toggle('more-left', row.scrollLeft > 2);
        row.classList.toggle('more-right', row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
      };
      if (history.length !== el._lastCount) { row.scrollLeft = row.scrollWidth; el._lastCount = history.length; }
      else if (typeof el._scroll === 'number') row.scrollLeft = el._scroll;
      row.addEventListener('scroll', () => { el._scroll = row.scrollLeft; fade(); }, { passive: true });
      row.addEventListener('wheel', e => {               // mouse wheel scrolls sideways
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { row.scrollLeft += e.deltaY; e.preventDefault(); }
      }, { passive: false });
      fade();
      if (history.length === el._lastCount && row.scrollLeft + row.clientWidth >= row.scrollWidth - 2) el._scroll = row.scrollLeft;
    }
  }

  // === BIDDING UI ===
  function renderBiddingUI(state, mySeat) {
    const panel = document.getElementById('bidding-panel');
    if (state.phase !== 'BIDDING' || state.currentRound.currentBidder !== mySeat) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'flex';
    
    // Build bid history display
    let bidHistoryHtml = '';
    if (state.currentRound.bids && state.currentRound.bids.length > 0) {
      const myTeam = Engine.getTeam(mySeat);
      bidHistoryHtml = '<div class="bid-history">';
      for (const b of state.currentRound.bids) {
        const playerName = b.seat === mySeat ? 'You' : (state.players[b.seat]?.name || `Player ${b.seat + 1}`);
        const team = Engine.getTeam(b.seat);
        const mate = b.seat !== mySeat && team === myTeam ? ' <span class="partner-tag">Partner</span>' : '';
        const bidText = b.bid === 0 ? 'Pass' : b.bid;
        bidHistoryHtml += `<div class="bid-history-item ${team === myTeam ? 'my-team' : 'opp-team'}"><span class="bid-player team-name-${team.toLowerCase()}">${escapeHtml(playerName)}${mate}:</span> <span class="bid-value">${bidText}</span></div>`;
      }
      bidHistoryHtml += '</div>';
    }
    {
      const myTeam = Engine.getTeam(mySeat);
      const oppTeam = myTeam === 'A' ? 'B' : 'A';
      const names = (t) => [0, 1, 2, 3, 4, 5].filter(i => Engine.getTeam(i) === t)
        .map(i => i === mySeat ? 'You' : escapeHtml(state.players[i]?.name || `P${i + 1}`)).join(', ');
      bidHistoryHtml = `<div class="bid-teams">
          <div class="bid-team-row team-name-${myTeam.toLowerCase()}"><span class="dot"></span>Your team: ${names(myTeam)}</div>
          <div class="bid-team-row team-name-${oppTeam.toLowerCase()}"><span class="dot"></span>Opponents: ${names(oppTeam)}</div>
        </div>` + bidHistoryHtml;
    }
    
    panel.innerHTML = `<div class="bid-title">Your Bid</div>${bidHistoryHtml}<div class="bid-buttons"></div>`;
    const btns = panel.querySelector('.bid-buttons');

    // Pass button
    const passBtn = document.createElement('button');
    passBtn.className = 'bid-btn pass-btn';
    passBtn.textContent = 'Pass';
    passBtn.addEventListener('click', () => Game.makeBid(0));
    btns.appendChild(passBtn);

    // Bid buttons (5-9, only valid ones)
    for (let b = 5; b <= 9; b++) {
      if (Engine.isValidBid(b, state.currentRound.bid, state.phase, state)) {
        const btn = document.createElement('button');
        btn.className = 'bid-btn';
        btn.textContent = b;
        btn.addEventListener('click', () => Game.makeBid(b));
        btns.appendChild(btn);
      }
    }
  }

  // === TRUMP SELECT UI ===
  function renderTrumpSelectUI(state, mySeat) {
    const panel = document.getElementById('trump-select-panel');
    if (state.phase !== 'TRUMP_SELECT' || state.currentRound.bidder !== mySeat) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'flex';
    panel.innerHTML = '<div class="bid-title">Select Trump Suit</div><div class="trump-buttons"></div>';
    const btns = panel.querySelector('.trump-buttons');

    Engine.SUITS.forEach(suit => {
      if (suit === 'joker') return; // Skip joker suit
      const btn = document.createElement('button');
      btn.className = 'trump-btn';
      if (suit === 'notrump') {
        btn.style.color = '#ffd700';
        btn.innerHTML = `🚫<br><span>No Trump</span>`;
      } else {
        btn.style.color = SUIT_COLORS[suit];
        btn.innerHTML = `${SUIT_SYMBOLS[suit]}<br><span>${suit}</span>`;
      }
      btn.addEventListener('click', () => Game.selectTrump(suit));
      btns.appendChild(btn);
    });
  }

  // === RAISE UI ===
  function renderRaiseUI(state, mySeat) {
    const panel = document.getElementById('raise-panel');
    if (state.phase !== 'RAISE_CHECK' || Engine.getTeam(mySeat) !== state.currentRound.biddingTeam) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'flex';
    refreshRaiseCommitments(state);
  }

  // After a raise, each player's committed tricks show as a goal on their seat
  function goalChip(state, seat) {
    const r = state.currentRound;
    const n = r && r.raiseGoals ? +r.raiseGoals[seat] || 0 : 0;
    if (!n || !['PLAYING', 'ROUND_END'].includes(state.phase)) return '';
    const from = r.raiseAtTrick || 5;
    const got = (r.tricks || []).slice(from).filter(t => t.winner === seat).length;
    return ` <span class="goal-chip${got >= n ? ' done' : ''}">Goal ${Math.min(got, n)}/${n}</span>`;
  }

  // Live view of who committed what, and the slam the total reaches
  function refreshRaiseCommitments(state) {
    const box = document.getElementById('raise-commits');
    if (!box) return;
    const r = state.currentRound;
    const won = r.tricksTaken[r.biddingTeam] || 0;
    const commits = r.raiseCommitments || {};
    const me = Game.getMySeat();
    const team = Engine.getTeamPlayers(r.biddingTeam);
    let total = 0;
    const selEl = document.getElementById('my-commitment');
    const bidderPreview = me === r.bidder && selEl; // the bidder sees their pick counted before committing
    const rows = team.map(st => {
      const preview = bidderPreview && st === me;
      const has = preview || Object.prototype.hasOwnProperty.call(commits, st);
      const n = preview ? (+selEl.value || 0) : has ? (+commits[st] || 0) : 0;
      total += n;
      const name = st === me ? 'You' : (state.players[st]?.name || `Player ${st + 1}`);
      const tag = st === r.bidder ? ' (bidder)' : '';
      return `<div class="commitment-item${has ? '' : ' pending'}"><span>${escapeHtml(name)}${tag}</span><b>${has ? '+' + n : '…'}</b></div>`;
    }).join('');
    const reach = Math.min(9, won + total);
    const target = planFor(state, reach);
    box.innerHTML = `${rows}<div class="commitment-total">Won ${won} + committed ${total} = ${reach}${target ? ` → raise to ${raiseLabel(target, r.bid)}` : ` — no raise (bid is ${r.bid})`}</div>`;
    document.querySelectorAll('#raise-buttons [data-raise]').forEach(btn => btn.classList.toggle('suggested', +btn.dataset.raise === target));
    const mine = Object.prototype.hasOwnProperty.call(commits, me);
    const sel = document.getElementById('my-commitment');
    const cb = document.getElementById('commit-btn');
    if (sel && mine && me !== r.bidder && document.activeElement !== sel) sel.value = String(+commits[me] || 0);
    if (cb && me === r.bidder) {
      // The bidder's Commit is the decision: raise to the slam the team's total reaches, else no raise
      const plan = raisePlan(state, sel ? +sel.value || 0 : 0);
      cb.textContent = plan ? `Commit → raise to ${raiseLabel(plan, r.bid)}` : 'Commit → no raise';
    } else if (cb) {
      // Partners commit once: the choice locks
      cb.textContent = mine ? `✓ Committed +${+commits[me] || 0}` : 'Commit';
      cb.disabled = !!mine; if (sel) sel.disabled = !!mine;
      const note = document.getElementById('commit-note');
      if (note) note.textContent = mine ? `${(state.players[r.bidder]?.name || 'The bidder')} decides the raise…` : '';
    }
  }

  // "7 (+2)", "8 (LS, +3)", "9 (GS, +1)"
  function raiseLabel(b, from) {
    const tag = b === 9 ? 'GS' : b === 8 ? 'LS' : '';
    return `${b} (${tag ? tag + ', ' : ''}+${b - from})`;
  }
  // Highest valid raise the team total reaches, or 0 for no raise
  function planFor(state, reach) {
    const r = state.currentRound;
    for (let b = Math.min(9, reach); b > r.bid; b--) if (Engine.isValidBid(b, r.bid, 'RAISE_CHECK', state)) return b;
    return 0;
  }
  // The raise the team total reaches if the bidder commits `mine` more tricks (0 = no raise)
  function raisePlan(state, mine) {
    const r = state.currentRound, me = Game.getMySeat();
    const won = r.tricksTaken[r.biddingTeam] || 0;
    const others = Object.entries(r.raiseCommitments || {}).filter(([s]) => +s !== me).reduce((a, [, n]) => a + (+n || 0), 0);
    return planFor(state, won + others + (+mine || 0));
  }

  function showRaisePrompt(state) {
    const panel = document.getElementById('raise-panel');
    panel.style.display = 'flex';
    
    const mySeat = Game.getMySeat();
    const isBidder = mySeat === state.currentRound.bidder;
    const biddingTeam = state.currentRound.biddingTeam;
    const tricksWon = state.currentRound.tricksTaken[biddingTeam];
    const currentBid = state.currentRound.bid;
    
    // Calculate cumulative commitments
    const commitments = state.currentRound.raiseCommitments || {};
    let totalCommitted = 0;
    let commitmentsList = '';
    for (const [seat, tricks] of Object.entries(commitments)) {
      totalCommitted += tricks;
      const playerName = state.players[seat]?.name || `Player ${parseInt(seat) + 1}`;
      commitmentsList += `<div class="commitment-item">${playerName}: +${tricks}</div>`;
    }
    
    const potentialTotal = tricksWon + totalCommitted;
    // Prefer live deadline; fall back to static timer for backwards compat
    const deadline = state.currentRound.raiseDeadline || (nowHost() + (state.currentRound.raiseTimer || 20) * 1000);
    const initialSecs = Math.max(0, Math.ceil((deadline - nowHost()) / 1000));
    
    panel.innerHTML = `
      <div class="bid-title">Raise Discussion (<span id="raise-countdown">${initialSecs}</span>s)</div>
      <div class="raise-info">Current bid: ${currentBid} | Tricks won: ${tricksWon} | Can raise up to ${Math.max(...Engine.raiseOptions(state), currentBid)}</div>
      <div class="commitments-box" id="raise-commits"></div>
      <div class="raise-commitment" id="raise-commitment">
        <label>${isBidder ? 'I can win' : 'I can take'}:</label>
        <select id="my-commitment">
          <option value="0">0 more</option>
          <option value="1">1 more</option>
          <option value="2">2 more</option>
          <option value="3">3 more</option>
          <option value="4">4 more</option>
        </select>
        <button class="bid-btn" id="commit-btn" style="padding:8px 16px;font-size:12px;">Commit</button>
      </div>
      <div class="commit-note" id="commit-note" aria-live="polite"></div>

      <div class="raise-help">${isBidder ? 'Partners say how many more they can take. Add yours and Commit — the total decides the raise.' : 'Tell your bidder how many more tricks you can surely take.'}</div>
    `;
    
    // Live countdown — deadline-based so every client stays in sync
    if (raiseCountdownInterval) { clearInterval(raiseCountdownInterval); raiseCountdownInterval = null; }
    raiseCountdownInterval = setInterval(() => {
      const el = document.getElementById('raise-countdown');
      if (!el) { clearInterval(raiseCountdownInterval); raiseCountdownInterval = null; return; }
      const secs = Math.max(0, Math.ceil((deadline - nowHost()) / 1000));
      el.textContent = String(secs);
      if (secs <= 5) el.style.color = '#ff6b6b';
      if (secs <= 0) { clearInterval(raiseCountdownInterval); raiseCountdownInterval = null; }
    }, 250);

    // Wire up commitment button
    document.getElementById('commit-btn')?.addEventListener('click', () => {
      const tricks = parseInt(document.getElementById('my-commitment').value) || 0;
      const st = Game.getState();
      if (st && Game.getMySeat() === st.currentRound.bidder) {
        // Bidder: commit, then act on the team total right away
        const plan = raisePlan(st, tricks);
        Game.commitRaiseTricks(tricks);
        panel.style.display = 'none';
        if (plan) Game.raiseBid(plan);
        else { showToast(`Team total doesn't beat the bid of ${st.currentRound.bid} — no raise`); Game.noRaise(); }
        return;
      }
      Game.commitRaiseTricks(tricks);
      const cbtn = document.getElementById('commit-btn'), sel = document.getElementById('my-commitment');
      if (cbtn) { cbtn.textContent = `✓ Committed +${tricks}`; cbtn.disabled = true; }
      if (sel) sel.disabled = true;
      const note = document.getElementById('commit-note');
      if (note) note.textContent = `${(st && st.players[st.currentRound.bidder]?.name) || 'The bidder'} decides the raise…`;
    });
    document.getElementById('my-commitment')?.addEventListener('change', () => refreshRaiseCommitments(Game.getState()));
    
    // Wire up extend timer button
    document.getElementById('extend-timer-btn')?.addEventListener('click', () => {
      Game.extendRaiseTimer();
    });
    
    refreshRaiseCommitments(state);
  }

  // === RESULTS ===
  function showRoundResult(result) {
    try { if (typeof History !== 'undefined') setTimeout(() => History.record(result), 400); } catch (_) {}
    const overlay = document.getElementById('result-overlay');
    overlay.style.display = 'flex';

    const myTeam = Game.getMyTeam();
    const won = result.scoreChange[myTeam] > 0;
    if (typeof Sound !== 'undefined') {
      const made = (result.tricksTaken[result.biddingTeam] || 0) >= result.bid;
      Sound.host(made ? 'bid_made' : 'bid_broken');
    }
    // Random celebration when your team wins the round (the game-over screen does its own)
    const gameEnds = result.totalScores && Math.max(result.totalScores.A || 0, result.totalScores.B || 0) >= (Engine.TARGET_SCORE || 62);
    if (won && !gameEnds && typeof Celebrate !== 'undefined') setTimeout(() => Celebrate.play({ big: !!(result.gs || result.ls) }), 250);
    let title = won ? 'Round Won!' : 'Round Lost';
    if (result.gs) title = won ? 'GRAND SLAM!' : 'Grand Slam by Opponents!';
    if (result.ls) title = won ? 'LITTLE SLAM!' : 'Little Slam by Opponents!';

    overlay.innerHTML = `
      <div class="result-card ${won ? 'won' : 'lost'} ${result.gs ? 'gs' : ''} ${result.ls ? 'ls' : ''}">
        <h2>${title}</h2>
        <div class="result-details">
          <div>Bid: ${result.bid} by Team ${result.biddingTeam}</div>
          <div>Tricks \u2014 Team A: ${result.tricksTaken.A} | Team B: ${result.tricksTaken.B}</div>
          <div class="result-scores">
            <div>Team A: ${result.totalScores.A} pts ${result.scoreChange.A > 0 ? `(+${result.scoreChange.A})` : ''}</div>
            <div>Team B: ${result.totalScores.B} pts ${result.scoreChange.B > 0 ? `(+${result.scoreChange.B})` : ''}</div>
          </div>
        </div>
        <div class="result-actions">
          <button class="wa-btn" id="share-round-btn">Share on WhatsApp</button>
          <button class="reel-btn" id="reel-round-btn">Recap reel</button>
          <button onclick="document.getElementById('result-overlay').style.display='none'" class="result-dismiss">Continue</button>
        </div>
      </div>
    `;
    // Snapshot now: the next round may start before the reel button is tapped
    const reelBtn = document.getElementById('reel-round-btn');
    let reelSnap = null;
    try { reelSnap = typeof Reel !== 'undefined' ? Reel.snapshot(result) : null; } catch (e) {}
    if (!reelSnap || !Reel.pickMime()) reelBtn.style.display = 'none';
    else reelBtn.onclick = () => Reel.open(result, reelSnap);
    wireShare(document.getElementById('share-round-btn'), {
      won, title, subtitle: `Team ${result.biddingTeam} bid ${result.bid}`, myTeam,
      scores: result.totalScores, delta: result.scoreChange, tricks: result.tricksTaken,
      bid: result.bid, biddingTeam: result.biddingTeam,
    });
  }

  function wireShare(btn, card) {
    if (!btn || typeof Extras === 'undefined') { if (btn) btn.style.display = 'none'; return; }
    btn.addEventListener('click', async () => {
      btn.disabled = true; const t = btn.textContent; btn.textContent = 'Preparing…';
      try { await Extras.shareScorecard(card); } finally { btn.disabled = false; btn.textContent = t; }
    });
  }

  function showGameOver(winner, scores) {
    const overlay = document.getElementById('result-overlay');
    overlay.style.display = 'flex';
    const myTeam = Game.getMyTeam();
    const won = winner === myTeam;
    if (typeof Sound !== 'undefined') setTimeout(() => Sound.host(won ? 'game_won' : 'game_lost'), 1200);
    if (won && typeof Celebrate !== 'undefined') setTimeout(() => Celebrate.play({ big: true }), 250);

    overlay.innerHTML = `
      <div class="result-card ${won ? 'won' : 'lost'} game-over">
        <h2>${won ? 'YOU WIN!' : 'GAME OVER'}</h2>
        <div class="result-details">
          <div class="final-score">Team A: ${scores.A} \u2014 Team B: ${scores.B}</div>
          <div>Team ${winner} wins the game!</div>
        </div>
        <div class="result-actions">
          <button class="wa-btn" id="share-game-btn">Share on WhatsApp</button>
          <button class="reel-btn" id="reel-game-btn">Recap reel</button>
          <button onclick="location.reload()" class="result-dismiss">Play Again</button>
        </div>
      </div>
    `;
    const st = Game.getState && Game.getState();
    const last = st && st.roundHistory && st.roundHistory[st.roundHistory.length - 1];
    // Recap of the deciding round
    const reelG = document.getElementById('reel-game-btn');
    let snapG = null;
    try { snapG = (typeof Reel !== 'undefined' && last && last.tricksTaken && Reel.pickMime()) ? Reel.snapshot(last) : null; } catch (e) {}
    if (!snapG) reelG.style.display = 'none'; else reelG.onclick = () => Reel.open(last, snapG);
    wireShare(document.getElementById('share-game-btn'), {
      won, title: won ? 'We won!' : 'Game over', headline: won ? 'We won!' : 'Game over', subtitle: `Team ${winner} wins the game`, myTeam,
      scores, delta: { A: 0, B: 0 },
      tricks: last ? last.tricksTaken : { A: 0, B: 0 }, bid: last ? last.bid : 5, biddingTeam: last ? last.biddingTeam : winner,
    });
  }

  function animateTrickWin(winner, trickCards) {
    const winnerName = Game.getState()?.players[winner]?.name || `Player ${winner + 1}`;
    showToast(`${winnerName} wins the trick!`);
  }

  // === EMOJI REACTIONS ===
  function showEmojiReaction(emoji, seat) {
    if (typeof Extras !== 'undefined') {
      const st = Game.getState && Game.getState();
      const p = st && st.players && seat != null ? st.players[seat] : null;
      Extras.showReaction(emoji, p ? { name: seat === Game.getMySeat() ? 'You' : p.name, team: Engine.getTeam(seat), seat, voice: p.voice, isAI: !!p.isAI, realName: p.name } : {});
      return;
    }
    const centerEl = document.getElementById('center-emoji');
    if (!centerEl) return;
    centerEl.textContent = emoji;
    centerEl.classList.remove('active');
    void centerEl.offsetWidth;
    centerEl.classList.add('active');
    setTimeout(() => centerEl.classList.remove('active'), 2000);
  }

  // Send a reaction phrase: animate for everyone, post to chat, remember for the bar
  function sendReaction(phrase) {
    broadcastEmojiReaction(phrase);
    try { Game.sendChat(phrase); } catch (ex) {}
    if (typeof Extras !== 'undefined' && Extras.noteReactionUsed) Extras.noteReactionUsed(phrase);
  }

  function broadcastEmojiReaction(emoji) {
    if (Game && Game.broadcastEmoji) Game.broadcastEmoji(emoji); // shows locally too
    else showEmojiReaction(emoji, Game.getMySeat());
  }

  // === CHAT ===
  function addChatMessage(name, text) {
    const chatEl = document.getElementById('chat-messages');
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg';
    msgEl.innerHTML = `<strong>${escapeHtml(name)}:</strong> ${escapeHtml(text)}`;
    chatEl.appendChild(msgEl);
    chatEl.scrollTop = chatEl.scrollHeight;

    // Show unread badge if drawer is closed
    const drawer = document.getElementById('chat-area');
    if (!drawer.classList.contains('open')) {
      const badge = document.getElementById('chat-unread');
      const count = (parseInt(badge.textContent) || 0) + 1;
      badge.textContent = count;
      badge.style.display = 'flex';
    }
  }


  // === TABLE HOST VOICE ===
  // Watches state changes and announces key moments. The first state seen
  // (fresh load / rejoin) is only recorded, never announced.
  const hostSeen = { ready: false, round: null, trump: null, lastTrick: null, cards: new Set(), cut: null, cuts: 0, cutAt: 0 };
  function hostWatch(state, mySeat) {
    if (typeof Sound === 'undefined' || !state || !state.currentRound) return;
    const r = state.currentRound;
    const roundIdx = (state.roundHistory || []).length;
    const say = (ev) => { if (hostSeen.ready) Sound.host(ev); };
    if (hostSeen.round !== roundIdx) {
      if (hostSeen.round !== null && (state.phase === 'SHUFFLING' || state.phase === 'BIDDING')) say('new_round');
      hostSeen.round = roundIdx; hostSeen.trump = null; hostSeen.lastTrick = null; hostSeen.cards = new Set(); hostSeen.cuts = 0;
    }
    if (r.trumpSuit && hostSeen.trump !== r.trumpSuit && ['PLAYING', 'RAISE_CHECK'].includes(state.phase)) {
      if (hostSeen.trump === null && r.tricksPlayed === 0 && (r.currentTrick || []).length === 0) say('trump_' + r.trumpSuit);
      hostSeen.trump = r.trumpSuit;
    }
    const trick = r.currentTrick || [];
    for (const { card } of trick) {
      if (!card || hostSeen.cards.has(card.id)) continue;
      hostSeen.cards.add(card.id);
      if (card.id === 'BIG_JOKER') say('joker_big');
      else if (card.id === 'SMALL_JOKER') say('joker_small');
    }
    // A trump cut: the newest card takes over the trick with trump, beating a non-trump leader
    if (trick.length >= 2 && r.trumpSuit && r.trumpSuit !== 'notrump') {
      const key = `${trick[0].card.id}:${trick.length}`;
      if (hostSeen.cut !== key) {
        hostSeen.cut = key;
        try {
          const before = Engine.determineTrickWinnerRefined(trick.slice(0, -1), r.trumpSuit);
          const after = Engine.determineTrickWinnerRefined(trick, r.trumpSuit);
          const newest = trick[trick.length - 1];
          const prevCard = (trick.find(c => c.playerIndex === before) || {}).card;
          if (after === newest.playerIndex && before !== after && newest.card.suit === r.trumpSuit &&
              prevCard && prevCard.suit !== r.trumpSuit && prevCard.suit !== 'joker' && trick[0].card.suit !== r.trumpSuit &&
              hostSeen.cuts < 2 && Date.now() - hostSeen.cutAt > 20000) { // the host stays a host, not a commentator
            hostSeen.cuts++; hostSeen.cutAt = Date.now(); say('trumped');
          }
        } catch (e) {}
      }
    }
    if (state.phase === 'PLAYING' && r.tricksPlayed === 8 && trick.length === 0 && hostSeen.lastTrick !== roundIdx) {
      hostSeen.lastTrick = roundIdx; say('last_trick');
    }
    hostSeen.ready = true;
  }

  // === TRICK HISTORY DRAWER ===
  function cardChip(card, extra) {
    if (!card) return '';
    let rank = card.rank, sym = SUIT_SYMBOLS[card.suit] || '';
    if (card.id === 'BIG_JOKER') rank = 'BIG';
    if (card.id === 'SMALL_JOKER') rank = 'SM';
    let color = SUIT_COLORS[card.suit] || '#333';
    if (card.id === 'BIG_JOKER') color = '#c0392b';
    if (card.id === 'SMALL_JOKER') color = '#1a1a2e';
    return `<span class="td-chip ${extra || ''}" style="color:${color}">${rank}<span class="td-chip-suit">${sym}</span></span>`;
  }
  function seatName(state, seat, mySeat) {
    if (seat === mySeat) return 'You';
    const p = state.players[seat];
    return escapeHtml(p ? p.name : `Player ${seat + 1}`);
  }
  function renderTrickDrawer(state, mySeat) {
    const r = state && state.currentRound;
    const tricks = (r && Array.isArray(r.tricks)) ? r.tricks : [];
    const cnt = document.getElementById('th-count');
    if (cnt) cnt.textContent = tricks.length;
    const btn = document.getElementById('trick-history-btn');
    if (btn && tricks.length === 1) {
      let seen = false; try { seen = localStorage.getItem('nattis.thHint') === '1'; } catch (e) {}
      if (!seen) { btn.classList.add('nudge'); try { localStorage.setItem('nattis.thHint', '1'); } catch (e) {} setTimeout(() => btn.classList.remove('nudge'), 4500); }
    }
    const drawer = document.getElementById('trick-drawer');
    if (!drawer || !drawer.classList.contains('open')) return;
    const list = document.getElementById('td-list');
    const sub = document.getElementById('td-sub');
    if (sub) {
      const trump = r && r.trumpSuit ? (r.trumpSuit === 'notrump' ? 'No trump' : `${SUIT_SYMBOLS[r.trumpSuit] || ''} ${r.trumpSuit}`) : '';
      sub.textContent = r && r.bid ? `Bid ${r.bid} · Team ${r.biddingTeam}${trump ? ' · ' + trump : ''}` : '';
    }
    if (!tricks.length) { list.innerHTML = '<div class="td-empty">No tricks finished yet this round.</div>'; return; }
    const myTeam = Engine.getTeam(mySeat);
    const openSet = new Set([...list.querySelectorAll('.td-row.expanded')].map(e => e.dataset.n));
    list.innerHTML = tricks.map((t, i) => ({ t, i })).reverse().map(({ t, i }) => {
      const cards = t.cards || [];
      const lead = cards[0] || {};
      const win = cards.find(c => c.playerIndex === t.winner) || {};
      const wTeam = t.winnerTeam || Engine.getTeam(t.winner);
      const lTeam = Engine.getTeam(lead.playerIndex);
      const all = cards.map(c => `<span class="td-play ${c.playerIndex === t.winner ? 'won' : ''}">${cardChip(c.card)}<span class="td-play-name team-name-${Engine.getTeam(c.playerIndex).toLowerCase()}">${seatName(state, c.playerIndex, mySeat)}</span></span>`).join('');
      const n = String(i + 1);
      return `<div class="td-row ${wTeam === myTeam ? 'ours' : 'theirs'} ${openSet.has(n) ? 'expanded' : ''}" data-n="${n}" role="button" tabindex="0" aria-expanded="${openSet.has(n)}">
        <span class="td-n">${n}</span>
        <span class="td-cell"><small>Led</small><b class="team-name-${lTeam.toLowerCase()}">${seatName(state, lead.playerIndex, mySeat)}</b>${cardChip(lead.card, 'sm')}</span>
        <span class="td-cell"><small>Won</small><b class="team-name-${wTeam.toLowerCase()}">${seatName(state, t.winner, mySeat)}</b></span>
        <span class="td-cell td-wc"><small>With</small>${cardChip(win.card, 'win')}</span>
        <div class="td-all">${all}</div>
      </div>`;
    }).join('');
  }
  function openTrickDrawer() {
    const d = document.getElementById('trick-drawer');
    if (!d) return;
    d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
    if (lastRender) renderTrickDrawer(lastRender.state, lastRender.mySeat);
  }
  function closeTrickDrawer() {
    const d = document.getElementById('trick-drawer');
    if (!d) return;
    d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
  }
  function wireTrickDrawer() {
    const d = document.getElementById('trick-drawer');
    if (!d) return;
    const btn = document.getElementById('trick-history-btn');
    if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); d.classList.contains('open') ? closeTrickDrawer() : openTrickDrawer(); });
    d.querySelector('.td-backdrop').addEventListener('click', closeTrickDrawer);
    d.querySelector('.td-close').addEventListener('click', closeTrickDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && d.classList.contains('open')) closeTrickDrawer(); });
    const list = document.getElementById('td-list');
    const toggle = (row) => { row.classList.toggle('expanded'); row.setAttribute('aria-expanded', row.classList.contains('expanded')); };
    list.addEventListener('click', (e) => { const row = e.target.closest('.td-row'); if (row) toggle(row); });
    list.addEventListener('keydown', (e) => { const row = e.target.closest('.td-row'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(row); } });
    // Swipe up anywhere on the table opens it; swipe down on the sheet closes it
    const swipe = (el, dir, fn, guard) => {
      let s = null;
      el.addEventListener('touchstart', (e) => { if (e.touches.length !== 1 || (guard && !guard(e))) { s = null; return; } s = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }; }, { passive: true });
      el.addEventListener('touchend', (e) => {
        if (!s) return; const t = e.changedTouches[0];
        const dy = (s.y - t.clientY) * dir, dx = Math.abs(t.clientX - s.x);
        if (dy > 50 && dx < dy * 0.7 && Date.now() - s.t < 800) fn();
        s = null;
      }, { passive: true });
    };
    const table = document.querySelector('#game-screen .game-table');
    if (table) swipe(table, 1, () => {
      const st = lastRender && lastRender.state;
      if (st && ['PLAYING', 'RAISE_CHECK', 'ROUND_END'].includes(st.phase)) openTrickDrawer();
    });
    const sheet = d.querySelector('.td-sheet');
    swipe(sheet, -1, closeTrickDrawer, () => list.scrollTop <= 0);
  }

  // === TOAST ===
  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // === RULES ===
  function showRules() {
    document.getElementById('rules-overlay').style.display = 'flex';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function triggerTrickWinFX(winnerRelIdx, winnerTeam) {
    if (typeof FX === 'undefined') return;
    const teamColor = winnerTeam === Engine.getTeam(Game.getMySeat())
      ? 'var(--team-a)' : 'var(--team-b)';
    FX.trickWinBurst(winnerRelIdx, teamColor);
  }

  return {
    init, showScreen,
    updateLobby, updateAll,
    showRaisePrompt, showRoundResult, showGameOver,
    showEmojiReaction,
    animateTrickWin, addChatMessage, showToast,
    showShuffleAnimation, showConnectionBanner,
    updatePointsDisplay, renderBadgesGrid,
    triggerTrickWinFX,
  };
})();
