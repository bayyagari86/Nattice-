// ============================================================
// UI MODULE — Rendering & Interactions
// ============================================================

const UI = (() => {
  // Card rendering
  const SUIT_SYMBOLS = {
    spades: '\u2660', hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', notrump: '\u2668', joker: '\u2605'
  };
  const SUIT_COLORS = {
    spades: '#1a1a2e', hearts: '#c0392b', diamonds: '#c0392b', clubs: '#1a1a2e', notrump: '#ffd700', joker: '#8e44ad'
  };

  let toastTimeout = null;

  let badgePopupTimeout = null;

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

    document.getElementById('solo-btn').addEventListener('click', startSoloGame);
    document.getElementById('host-btn').addEventListener('click', showHostDialog);
    document.getElementById('join-btn').addEventListener('click', showJoinDialog);
    document.getElementById('rules-btn').addEventListener('click', showRules);

    // Badges panel toggle
    document.getElementById('badges-toggle').addEventListener('click', toggleBadgesPanel);
    document.getElementById('badges-close').addEventListener('click', () => {
      document.getElementById('badges-panel').classList.remove('open');
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

  function startSoloGame() {
    showInputDialog('Enter your name', 'Player', (name) => {
      showScreen('game-screen');
      Badges.reset();
      updatePointsDisplay();
      renderBadgesGrid();
      Game.startSoloGame(name);
    });
  }

  // === TITLE SCREEN ===
  function showHostDialog() {
    showInputDialog('Enter your name', 'Host', (name) => {
      showScreen('lobby-screen');
      document.getElementById('lobby-status').textContent = 'Creating room...';
      Game.hostGame(name).then(roomCode => {
        const hostId = Network.getPeerId() || '';
        document.getElementById('room-code-display').textContent = roomCode;
        document.getElementById('host-id-display').textContent = hostId;
        document.getElementById('room-code-section').style.display = 'flex';
        document.getElementById('lobby-status').textContent = 'Waiting for players...';
        document.getElementById('start-game-btn').style.display = 'block';
        document.getElementById('start-game-btn').addEventListener('click', () => Game.startGame());

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
        }
      }).catch(err => {
        showToast('Failed to create room: ' + err.message);
        showScreen('title-screen');
      });
    });
  }

  function showJoinDialog(prefillRoom = '') {
    showMultiInputDialog([
      { label: 'Your Name', placeholder: 'Player', key: 'name', value: '' },
      { label: 'Room Code', placeholder: 'ABC123', key: 'code', value: prefillRoom },
    ], (vals) => {
      if (!vals.name || !vals.code) { showToast('Name and Room Code required'); return; }
      showScreen('lobby-screen');
      document.getElementById('lobby-status').textContent = 'Joining room...';
      Game.joinGame(vals.name.trim(), vals.code.trim().toUpperCase()).catch(err => {
        showToast('Failed to join: ' + err.message);
        showScreen('title-screen');
      });
    });
  }

  // === INPUT DIALOGS (PWA-friendly, no prompt()) ===
  function showInputDialog(label, placeholder, callback) {
    const overlay = document.getElementById('input-overlay');
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="input-dialog">
        <label>${label}</label>
        <input type="text" id="dialog-input" placeholder="${placeholder}" autocomplete="off" maxlength="20">
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

    for (let i = 0; i < 6; i++) {
      const player = state.players[i];
      const team = Engine.getTeam(i);
      const seatEl = document.createElement('div');
      seatEl.className = `lobby-seat ${player ? 'occupied' : 'empty'} team-${team.toLowerCase()}`;
      if (i === mySeat) seatEl.classList.add('me');

      seatEl.innerHTML = `
        <div class="seat-number">Seat ${i + 1}</div>
        <div class="seat-team">Team ${team}</div>
        <div class="seat-name">${player ? player.name : 'Empty'}</div>
        ${player && player.connected === false ? '<div class="seat-dc">Disconnected</div>' : ''}
      `;
      seatsDiv.appendChild(seatEl);
    }

    // Show host ID for sharing
    const hostInfo = document.getElementById('host-id-display');
    if (hostInfo) {
      hostInfo.textContent = Network.getPeerId() || '';
    }
  }

  // === GAME TABLE ===
  function updateAll(state, mySeat) {
    if (!state) return;
    if (state.phase === 'WAITING') return;
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
  }

  function renderScoreboard(state, mySeat) {
    const myTeam = Engine.getTeam(mySeat);
    const oppTeam = myTeam === 'A' ? 'B' : 'A';
    document.getElementById('my-team-score').textContent = state.scores[myTeam];
    document.getElementById('opp-team-score').textContent = state.scores[oppTeam];
    document.getElementById('my-team-label').textContent = `Team ${myTeam} (You)`;
    document.getElementById('opp-team-label').textContent = `Team ${oppTeam}`;

    // Tricks taken this round
    const round = state.currentRound;
    document.getElementById('my-team-tricks').textContent = round.tricksTaken[myTeam] || 0;
    document.getElementById('opp-team-tricks').textContent = round.tricksTaken[oppTeam] || 0;

    // Bid info — show bidder name + team + target tricks
    const bidInfo = document.getElementById('bid-info');
    if (round.bid > 0) {
      const bidder = state.players[round.bidder];
      bidInfo.textContent = `Bid ${round.bid} · ${bidder ? bidder.name : '?'} · Team ${round.biddingTeam}`;
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
      trumpInfo.innerHTML = `Trump: <span class="trump-suit" style="color:${TRUMP_BANNER_COLORS[round.trumpSuit] || '#e0e0e0'}">${trumpText}</span>`;
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
      el.className = `table-player ${isCurrentPlayer ? 'active' : ''} team-${team.toLowerCase()}`;
      el.style.cssText = `left:${pos.x}%;top:${pos.y}%;`;

      // Build card backs HTML for other players
      let cardBacksHtml = '';
      if (seat !== mySeat) {
        const cardCount = state.hands[seat] ? state.hands[seat].length : 0;
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
      const ODIA_REACTIONS = [
        { label: '👍 ସହି!',    phrase: 'ସହି ବାତ! 👍',              chat: 'ସହି ବାତ! 👍' },
        { label: '😮 ଏ କି!',  phrase: 'ଏ କି ହେଲା?! 😮',            chat: 'ଏ କି ହେଲା?! 😮' },
        { label: '🔥 ଧମାକା!', phrase: 'ଏଇଟା ଧମାକା! 🔥',           chat: 'ଏଇଟା ଧମାକା! 🔥' },
        { label: '😂 ଦାଦା!',  phrase: 'ଦାଦା, କଣ କଲେ? 😂',          chat: 'ଦାଦା, କଣ କଲେ? 😂' },
        { label: '🃏 ଜୋକର!',  phrase: 'ଜୋକର ଦେବ ନାହିଁ! 🃏',       chat: 'ଜୋକର ଦେବ ନାହିଁ! 🃏' },
        { label: '😤 ହୁଁ!',   phrase: 'ହଁ ହଁ! ହୁଁ! 😤',            chat: 'ହଁ ହଁ! ହୁଁ! 😤' },
        { label: '💪 ଜବରଦସ୍ତ!', phrase: 'ଜବରଦସ୍ତ ଖେଳ! 💪',        chat: 'ଜବରଦସ୍ତ ଖେଳ! 💪' },
        { label: '🤔 କଣ?',    phrase: 'ଏଇଟା କଣ କଲ? 🤔',          chat: 'ଏଇଟା କଣ କଲ? 🤔' },
        { label: '😎 ବାପ୍ରେ!', phrase: 'ବାପ୍ରେ ବାପ୍! 😎',           chat: 'ବାପ୍ରେ ବାପ୍! 😎' },
        { label: '🎯 ସଟ୍!',   phrase: 'ଏକଦମ୍ ସଟ୍! 🎯',           chat: 'ଏକଦମ୍ ସଟ୍! 🎯' },
      ];
      const reactionBarHtml = seat === mySeat
        ? `<div class="reaction-bar">${ODIA_REACTIONS.map((r,idx) =>
            `<button class="reaction-btn" data-idx="${idx}">${r.label}</button>`
          ).join('')}</div>`
        : '';
      // Store reactions on element for event binding
      el._odiaReactions = ODIA_REACTIONS;

      el.innerHTML = `
        <div class="reaction-float" id="reaction-float-${seat}"></div>
        <div class="player-avatar">${player.name.charAt(0).toUpperCase()}</div>
        <div class="player-name">${seat === mySeat ? 'You' : player.name}${player.isAI ? ' \ud83e\udd16' : ''}</div>
        <div class="player-meta">Team ${team}${isBidder ? ' \u00b7 Bidder' : ''}</div>
        ${reactionBarHtml}
        ${cardBacksHtml}
      `;

      // Wire up Odia reaction buttons
      el.querySelectorAll('.reaction-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx);
          const reaction = el._odiaReactions[idx];
          if (!reaction) return;
          broadcastEmojiReaction(reaction.phrase);
          try { Game.sendChat(reaction.chat); } catch(ex) {}
        });
      });

      tableEl.appendChild(el);
    }
  }

  function getPlayerPositions() {
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
    const isMyTurn = state.phase === 'PLAYING' && state.currentRound.currentPlayer === mySeat;
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
    const overlap = isMobile ? (isSmallPhone ? 22 : 18) : 10;
    const totalWidth = cardW * total - overlap * (total - 1);
    const startX = (handEl.offsetWidth || window.innerWidth) / 2 - totalWidth / 2;

    sorted.forEach((card, idx) => {
      const isPlayable = !!playable.find(c => c.id === card.id);
      const isTrump = card.suit === state.currentRound.trumpSuit;
      const color = SUIT_COLORS[card.suit] || '#333';
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
      cardEl.className = `card ${isPlayable ? 'playable' : ''} ${!isMyTurn ? 'waiting' : ''} ${isTrump ? 'trump-card' : ''}`;
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

    trick.forEach(({ playerIndex, card }) => {
      const relIdx = ((playerIndex - mySeat + 6) % 6);
      const pos = positions[relIdx];
      const color = SUIT_COLORS[card.suit] || '#333';
      const symbol = SUIT_SYMBOLS[card.suit] || '';
      let displayRank = card.rank;
      if (card.id === 'BIG_JOKER') displayRank = 'BIG';
      if (card.id === 'SMALL_JOKER') displayRank = 'SM';

      // Get player name for label
      const player = state.players[playerIndex];
      const playerLabel = playerIndex === mySeat ? 'You' : (player ? player.name : '?');

      const el = document.createElement('div');
      el.className = 'trick-card';
      el.style.cssText = `left:${pos.x}%;top:${pos.y}%;`;
      el.innerHTML = `
        <div class="card-mini" style="color:${color}">
          <span class="card-rank">${displayRank}</span>
          <span class="card-suit">${symbol}</span>
        </div>
        <div class="trick-card-label">${playerLabel}</div>
      `;
      trickEl.appendChild(el);
    });
  }

  function getTrickCardPositions() {
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
      infoEl.textContent = 'Bidding team can raise their bid...';
    } else if (state.phase === 'ROUND_END') {
      infoEl.textContent = 'Round over \u2014 next round starting...';
    } else if (state.phase === 'SHUFFLING') {
      infoEl.textContent = 'Shuffling cards...';
    }

    // Trick counter
    document.getElementById('trick-counter').textContent = `Trick ${state.currentRound.tricksPlayed + 1} of 9`;
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
      bidHistoryHtml = '<div class="bid-history">';
      for (const b of state.currentRound.bids) {
        const playerName = state.players[b.seat]?.name || `Player ${b.seat + 1}`;
        const bidText = b.bid === 0 ? 'Pass' : b.bid;
        bidHistoryHtml += `<div class="bid-history-item"><span class="bid-player">${playerName}:</span> <span class="bid-value">${bidText}</span></div>`;
      }
      bidHistoryHtml += '</div>';
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
    const timer = state.currentRound.raiseTimer || 20;
    
    panel.innerHTML = `
      <div class="bid-title">Raise Discussion (${timer}s)</div>
      <div class="raise-info">Current bid: ${currentBid} | Tricks won: ${tricksWon}</div>
      ${commitmentsList ? `<div class="commitments-box">${commitmentsList}<div class="commitment-total">Potential: ${potentialTotal} tricks</div></div>` : ''}
      <div class="raise-commitment" id="raise-commitment">
        <label>I can win:</label>
        <select id="my-commitment">
          <option value="0">0 more</option>
          <option value="1">1 more</option>
          <option value="2">2 more</option>
          <option value="3">3 more</option>
          <option value="4">4 more</option>
        </select>
        <button class="bid-btn" id="commit-btn" style="padding:8px 16px;font-size:12px;">Commit</button>
      </div>
      <button class="bid-btn" id="extend-timer-btn" style="padding:6px 12px;font-size:11px;margin-top:8px;">+10s</button>
      ${isBidder ? '<div class="bid-buttons" id="raise-buttons"></div>' : '<div class="raise-waiting">Waiting for bidder to decide...</div>'}
    `;
    
    // Wire up commitment button
    document.getElementById('commit-btn')?.addEventListener('click', () => {
      const tricks = parseInt(document.getElementById('my-commitment').value);
      Game.commitRaiseTricks(tricks);
    });
    
    // Wire up extend timer button
    document.getElementById('extend-timer-btn')?.addEventListener('click', () => {
      Game.extendRaiseTimer();
    });
    
    // Only bidder sees raise/no-raise buttons
    if (isBidder) {
      const btns = document.getElementById('raise-buttons');
      
      const noBtn = document.createElement('button');
      noBtn.className = 'bid-btn pass-btn';
      noBtn.textContent = 'No Raise';
      noBtn.addEventListener('click', () => {
        panel.style.display = 'none';
        Game.noRaise();
      });
      btns.appendChild(noBtn);
      
      for (let b = currentBid + 1; b <= 9; b++) {
        // Only show valid bids (winning team can raise in raise phase)
        if (Engine.isValidBid(b, currentBid, 'RAISE_CHECK', state)) {
          const btn = document.createElement('button');
          btn.className = 'bid-btn';
          btn.textContent = b;
          if (b === 8) btn.textContent = `${b} (LS)`;
          if (b === 9) btn.textContent = `${b} (GS)`;
          btn.addEventListener('click', () => {
            panel.style.display = 'none';
            Game.raiseBid(b);
          });
          btns.appendChild(btn);
        }
      }
    }
  }

  // === RESULTS ===
  function showRoundResult(result) {
    const overlay = document.getElementById('result-overlay');
    overlay.style.display = 'flex';

    const myTeam = Game.getMyTeam();
    const won = result.scoreChange[myTeam] > 0;
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
        <button onclick="document.getElementById('result-overlay').style.display='none'" class="result-dismiss">Continue</button>
      </div>
    `;
  }

  function showGameOver(winner, scores) {
    const overlay = document.getElementById('result-overlay');
    overlay.style.display = 'flex';
    const myTeam = Game.getMyTeam();
    const won = winner === myTeam;

    overlay.innerHTML = `
      <div class="result-card ${won ? 'won' : 'lost'} game-over">
        <h2>${won ? 'YOU WIN!' : 'GAME OVER'}</h2>
        <div class="result-details">
          <div class="final-score">Team A: ${scores.A} \u2014 Team B: ${scores.B}</div>
          <div>Team ${winner} wins the game!</div>
        </div>
        <button onclick="location.reload()" class="result-dismiss">Play Again</button>
      </div>
    `;
  }

  function animateTrickWin(winner, trickCards) {
    const winnerName = Game.getState()?.players[winner]?.name || `Player ${winner + 1}`;
    showToast(`${winnerName} wins the trick!`);
  }

  // === EMOJI REACTIONS ===
  function showEmojiReaction(emoji) {
    const centerEl = document.getElementById('center-emoji');
    if (!centerEl) return;
    centerEl.textContent = emoji;
    centerEl.classList.remove('active');
    void centerEl.offsetWidth;
    centerEl.classList.add('active');
    setTimeout(() => centerEl.classList.remove('active'), 2000);
  }

  function broadcastEmojiReaction(emoji) {
    showEmojiReaction(emoji);
    if (Game && Game.broadcastEmoji) {
      Game.broadcastEmoji(emoji);
    }
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
    showShuffleAnimation,
    updatePointsDisplay, renderBadgesGrid,
    triggerTrickWinFX,
  };
})();
