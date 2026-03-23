// ============================================================
// GAME CONTROLLER — Orchestrates Engine, Network, and UI
// ============================================================

const Game = (() => {
  let state = null;
  let myPlayerId = null;
  let myPeerId = null;
  let mySeat = -1;
  let myName = '';
  let roomCode = '';
  let peerToSeat = new Map(); // peerId -> seat index
  let seatToPeer = new Map(); // seat -> peerId
  let isSoloMode = false;

  const AI_NAMES = ['Arjun', 'Priya', 'Kiran', 'Meera', 'Ravi'];

  function getState() { return state; }
  function getMySeat() { return mySeat; }
  function getMyTeam() { return Engine.getTeam(mySeat); }

  // ===== SINGLE PLAYER (SOLO) MODE =====
  function startSoloGame(playerName) {
    isSoloMode = true;
    myName = playerName;
    myPlayerId = GameCrypto.generatePlayerId();
    mySeat = 0;
    state = Engine.createGameState();

    // Seat player at 0, AI at 1-5
    state.players[0] = { id: myPlayerId, name: myName, seat: 0, peerId: null, connected: true, isAI: false };
    for (let i = 1; i < 6; i++) {
      state.players[i] = {
        id: 'AI_' + i,
        name: AI_NAMES[i - 1],
        seat: i,
        peerId: null,
        connected: true,
        isAI: true,
      };
    }

    UI.showToast('Game started \u2014 you are on Team A with ' + AI_NAMES[1] + ' & ' + AI_NAMES[3]);
    startNewRound();
  }

  // Initialize a new game as host
  async function hostGame(playerName) {
    myName = playerName;
    myPlayerId = GameCrypto.generatePlayerId();
    state = Engine.createGameState();
    roomCode = GameCrypto.generateRoomCode();

    await Network.init();
    myPeerId = Network.getPeerId();
    await Network.createRoom(roomCode);

    // Host sits at seat 0
    mySeat = 0;
    state.players[0] = { id: myPlayerId, name: myName, seat: 0, peerId: myPeerId, connected: true };
    peerToSeat.set(myPeerId, 0);
    seatToPeer.set(0, myPeerId);

    setupHostListeners();
    return roomCode;
  }

  // Join an existing game
  async function joinGame(playerName, hostPeerId, code) {
    myName = playerName;
    myPlayerId = GameCrypto.generatePlayerId();
    roomCode = code;

    await Network.init();
    myPeerId = Network.getPeerId();
    await Network.joinRoom(hostPeerId, code);

    // Send join request to host
    Network.sendTo(hostPeerId, {
      type: 'JOIN_REQUEST',
      name: myName,
      playerId: myPlayerId,
      peerId: myPeerId,
    });

    setupClientListeners();
  }

  function setupHostListeners() {
    Network.onMessage((fromPeer, msg) => {
      handleHostMessage(fromPeer, msg);
    });

    Network.onPeerLeave((peerId) => {
      const seat = peerToSeat.get(peerId);
      if (seat !== undefined && state.players[seat]) {
        state.players[seat].connected = false;
        broadcastState();
        UI.updateLobby(state, mySeat);
      }
    });
  }

  function setupClientListeners() {
    Network.onMessage((fromPeer, msg) => {
      handleClientMessage(fromPeer, msg);
    });
  }

  // HOST message handling
  function handleHostMessage(fromPeer, msg) {
    switch (msg.type) {
      case 'JOIN_REQUEST':
        handleJoinRequest(fromPeer, msg);
        break;
      case 'BID':
        handleBid(fromPeer, msg);
        break;
      case 'TRUMP_SELECT':
        handleTrumpSelect(fromPeer, msg);
        break;
      case 'PLAY_CARD':
        handlePlayCard(fromPeer, msg);
        break;
      case 'RAISE_BID':
        handleRaiseBid(fromPeer, msg);
        break;
      case 'NO_RAISE':
        handleNoRaise(fromPeer);
        break;
    }
  }

  // CLIENT message handling
  function handleClientMessage(fromPeer, msg) {
    switch (msg.type) {
      case 'SEAT_ASSIGNED':
        mySeat = msg.seat;
        state = msg.state;
        // Restore passedPlayers as a Set (serialized as array)
        if (state.currentRound && Array.isArray(state.currentRound.passedPlayers)) {
          state.currentRound.passedPlayers = new Set(state.currentRound.passedPlayers);
        }
        // Populate seatToPeer so client can send messages to host
        if (msg.seatToPeer) {
          for (const [seat, peerId] of Object.entries(msg.seatToPeer)) {
            seatToPeer.set(Number(seat), peerId);
          }
        }
        UI.updateLobby(state, mySeat);
        UI.showToast(`Seated at position ${msg.seat + 1} (Team ${Engine.getTeam(msg.seat)})`);
        break;
      case 'STATE_UPDATE':
        // Preserve our hand if the state update has empty hands (sanitized)
        const myHand = state?.hands?.[mySeat];
        state = msg.state;
        if (myHand && myHand.length > 0 && (!state.hands[mySeat] || state.hands[mySeat].length === 0)) {
          state.hands[mySeat] = myHand;
        }
        // Restore passedPlayers as a Set
        if (state.currentRound && Array.isArray(state.currentRound.passedPlayers)) {
          state.currentRound.passedPlayers = new Set(state.currentRound.passedPlayers);
        }
        UI.updateAll(state, mySeat);
        break;
      case 'DEAL_HAND':
        state = msg.state;
        state.hands[mySeat] = msg.hand;
        UI.updateAll(state, mySeat);
        UI.showToast('Cards dealt!');
        break;
      case 'DEAL_ALL':
        state = msg.state;
        // Restore passedPlayers as a Set
        if (state.currentRound && Array.isArray(state.currentRound.passedPlayers)) {
          state.currentRound.passedPlayers = new Set(state.currentRound.passedPlayers);
        }
        // Extract my hand from the full hands array
        if (msg.hands && msg.hands[mySeat]) {
          state.hands[mySeat] = msg.hands[mySeat];
        }
        UI.updateAll(state, mySeat);
        UI.showToast('Cards dealt!');
        break;
      case 'PEER_LIST':
        // Connect to other peers for mesh
        for (const pid of msg.peers) {
          if (pid !== myPeerId) {
            Network.connectToPeer(pid).catch(() => {});
          }
        }
        break;
      case 'TRICK_RESULT':
        UI.animateTrickWin(msg.winner, msg.trickCards);
        break;
      case 'ROUND_RESULT':
        UI.showRoundResult(msg);
        break;
      case 'GAME_OVER':
        UI.showGameOver(msg.winner, msg.scores);
        break;
      case 'RAISE_PROMPT':
        if (Engine.getTeam(mySeat) === state.currentRound.biddingTeam) {
          UI.showRaisePrompt(state);
        }
        break;
      case 'CHAT':
        UI.addChatMessage(msg.name, msg.text);
        break;
    }
  }

  function handleJoinRequest(fromPeer, msg) {
    // Find next available seat
    let seat = -1;
    for (let i = 0; i < 6; i++) {
      if (!state.players[i]) {
        seat = i;
        break;
      }
    }

    if (seat === -1) {
      Network.sendTo(fromPeer, { type: 'ERROR', message: 'Game is full' });
      return;
    }

    state.players[seat] = {
      id: msg.playerId,
      name: msg.name,
      seat,
      peerId: fromPeer,
      connected: true,
    };
    peerToSeat.set(fromPeer, seat);
    seatToPeer.set(seat, fromPeer);

    // Send seat assignment — include seatToPeer so client knows how to reach host
    const seatToPeerObj = {};
    for (const [s, p] of seatToPeer) seatToPeerObj[s] = p;
    Network.sendTo(fromPeer, {
      type: 'SEAT_ASSIGNED',
      seat,
      state: sanitizeStateForClient(state),
      seatToPeer: seatToPeerObj,
    });

    // Send peer list for mesh networking
    const allPeers = [myPeerId, ...Network.getConnectedPeers()];
    Network.broadcast({ type: 'PEER_LIST', peers: allPeers });

    broadcastState();
    UI.updateLobby(state, mySeat);
    UI.showToast(`${msg.name} joined (Seat ${seat + 1}, Team ${Engine.getTeam(seat)})`);
  }

  // Start the game (host only)
  function startGame() {
    if (!Network.getIsHost()) return;
    const playerCount = state.players.filter(Boolean).length;
    if (playerCount < 2) { // Allow 2+ for testing, 6 for real
      UI.showToast('Need at least 2 players to start');
      return;
    }

    // Fill empty seats with AI placeholders
    for (let i = 0; i < 6; i++) {
      if (!state.players[i]) {
        state.players[i] = {
          id: 'AI_' + i,
          name: `Bot ${i + 1}`,
          seat: i,
          peerId: null,
          connected: true,
          isAI: true,
        };
      }
    }

    // Init badges for multiplayer
    Badges.reset();
    UI.updatePointsDisplay();
    UI.renderBadgesGrid();

    // Brief delay to ensure all outbound connections are ready
    UI.showToast('Starting game...');
    setTimeout(() => startNewRound(), 1500);
  }

  async function startNewRound() {
    // Show shuffle animation
    state.phase = 'SHUFFLING';
    UI.updateAll(state, mySeat);
    await UI.showShuffleAnimation();

    // Create and shuffle deck
    const deck = Engine.createDeck();
    const shuffled = GameCrypto.secureShuffleDeck(deck);
    const hands = Engine.dealCards(shuffled);

    state.phase = 'BIDDING';
    state.currentRound = {
      bid: 0,
      bidder: -1,
      biddingTeam: null,
      trumpSuit: null,
      currentBidder: (state.dealer + 1) % 6,
      bids: [],
      passCount: 0,
      passedPlayers: new Set(), // Track which players have passed
      tricks: [],
      currentTrick: [],
      tricksTaken: { A: 0, B: 0 },
      trickLeader: -1,
      currentPlayer: (state.dealer + 1) % 6,
      tricksPlayed: 0,
      raised: false,
    };
    state.hands = hands;

    // Send hands to all players
    if (isSoloMode) {
      UI.updateAll(state, mySeat);
    } else {
      // Broadcast all hands — each client picks their own by seat index
      // This is safe because the message is E2E encrypted to the room key
      Network.broadcast({
        type: 'DEAL_ALL',
        hands: hands,
        state: sanitizeStateForClient(state),
      });
      // Do NOT call broadcastState() here — it would send empty hands
      // that overwrite the DEAL_ALL hands on the client
    }

    UI.updateAll(state, mySeat);
    checkAITurn();
  }

  function handleBid(fromPeer, msg) {
    const seat = peerToSeat.get(fromPeer);
    if (seat === undefined || seat !== state.currentRound.currentBidder) return;
    processBid(seat, msg.bid);
  }

  function makeBid(bid) {
    if (mySeat !== state.currentRound.currentBidder) return;
    if (isSoloMode || Network.getIsHost()) {
      processBid(mySeat, bid);
    } else {
      const hostPeerId = seatToPeer.get(0) || Network.getConnectedPeers()[0];
      Network.sendTo(hostPeerId, { type: 'BID', bid });
    }
  }

  function processBid(seat, bid) {
    if (!Engine.isValidBid(bid, state.currentRound.bid)) {
      // Force pass if invalid
      processBid(seat, 0);
      return;
    }

    state.currentRound.bids.push({ seat, bid });

    if (bid > 0) {
      state.currentRound.bid = bid;
      state.currentRound.bidder = seat;
      state.currentRound.biddingTeam = Engine.getTeam(seat);
      // Remove this player from passed set (they outbid)
      state.currentRound.passedPlayers.delete(seat);
    } else {
      // Player passed — mark them
      state.currentRound.passedPlayers.add(seat);
      state.currentRound.passCount = state.currentRound.passedPlayers.size;
    }

    // Check if bidding is over: 5 players passed and someone has a bid
    if (state.currentRound.passedPlayers.size >= 5 && state.currentRound.bid > 0) {
      // Everyone else passed, bidder wins
      state.phase = 'TRUMP_SELECT';
      state.currentRound.currentPlayer = state.currentRound.bidder;
      broadcastState();
      UI.updateAll(state, mySeat);
      checkAITurn();
      return;
    }

    // All 6 passed with no bid — re-deal
    if (state.currentRound.passedPlayers.size >= 6 && state.currentRound.bid === 0) {
      state.dealer = (state.dealer + 1) % 6;
      UI.showToast('No bids \u2014 re-dealing...');
      setTimeout(() => startNewRound(), 2000);
      return;
    }

    if (state.currentRound.bid === 9) {
      // Max bid — go straight to trump selection
      state.phase = 'TRUMP_SELECT';
      state.currentRound.currentPlayer = state.currentRound.bidder;
      broadcastState();
      UI.updateAll(state, mySeat);
      checkAITurn();
      return;
    }

    // Find next eligible bidder (skip those who have passed)
    let nextBidder = (seat + 1) % 6;
    let attempts = 0;
    while (attempts < 6) {
      if (!state.currentRound.passedPlayers.has(nextBidder)) {
        break; // This player hasn't passed, they can bid
      }
      nextBidder = (nextBidder + 1) % 6;
      attempts++;
    }

    // If we looped all the way around and everyone has passed except the current bidder
    if (attempts >= 6 || (state.currentRound.passedPlayers.size >= 5 && state.currentRound.bid > 0)) {
      state.phase = 'TRUMP_SELECT';
      state.currentRound.currentPlayer = state.currentRound.bidder;
      broadcastState();
      UI.updateAll(state, mySeat);
      checkAITurn();
      return;
    }

    state.currentRound.currentBidder = nextBidder;
    state.currentRound.currentPlayer = nextBidder;
    broadcastState();
    UI.updateAll(state, mySeat);
    checkAITurn();
  }

  function handleTrumpSelect(fromPeer, msg) {
    const seat = peerToSeat.get(fromPeer);
    if (seat !== state.currentRound.bidder) return;
    processTrumpSelect(msg.suit);
  }

  function selectTrump(suit) {
    if (mySeat !== state.currentRound.bidder) return;
    if (isSoloMode || Network.getIsHost()) {
      processTrumpSelect(suit);
    } else {
      const hostPeerId = seatToPeer.get(0) || Network.getConnectedPeers()[0];
      Network.sendTo(hostPeerId, { type: 'TRUMP_SELECT', suit });
    }
  }

  function processTrumpSelect(suit) {
    state.currentRound.trumpSuit = suit;
    state.phase = 'PLAYING';
    state.currentRound.trickLeader = state.currentRound.bidder;
    state.currentRound.currentPlayer = state.currentRound.bidder;
    state.currentRound.currentTrick = [];

    // Track trump calls for badges
    if (Engine.getTeam(state.currentRound.bidder) === Engine.getTeam(mySeat)) {
      Badges.recordTrumpCall();
      UI.updatePointsDisplay();
    }

    broadcastState();
    UI.updateAll(state, mySeat);
    UI.showToast(`Trump is ${suit.toUpperCase()}!`);
    checkAITurn();
  }

  function handlePlayCard(fromPeer, msg) {
    const seat = peerToSeat.get(fromPeer);
    if (seat === undefined || seat !== state.currentRound.currentPlayer) return;
    processPlayCard(seat, msg.cardId);
  }

  function playCard(cardId) {
    if (mySeat !== state.currentRound.currentPlayer) return;
    if (isSoloMode || Network.getIsHost()) {
      processPlayCard(mySeat, cardId);
    } else {
      const hostPeerId = seatToPeer.get(0) || Network.getConnectedPeers()[0];
      Network.sendTo(hostPeerId, { type: 'PLAY_CARD', cardId });
    }
  }

  function processPlayCard(seat, cardId) {
    const hand = state.hands[seat];
    const cardIdx = hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return;

    const card = hand[cardIdx];
    const isLeading = state.currentRound.currentTrick.length === 0;
    const leadSuit = !isLeading
      ? (state.currentRound.currentTrick[0].card.suit === 'joker' ? null : state.currentRound.currentTrick[0].card.suit)
      : null;

    // Validate play
    const playable = Engine.getPlayableCards(hand, leadSuit, isLeading);
    if (!playable.find(c => c.id === cardId)) return;

    // Remove card from hand
    hand.splice(cardIdx, 1);

    // Add to current trick
    state.currentRound.currentTrick.push({ playerIndex: seat, card });

    if (state.currentRound.currentTrick.length === 6) {
      // Trick complete — determine winner
      const winner = Engine.determineTrickWinnerRefined(
        state.currentRound.currentTrick,
        state.currentRound.trumpSuit
      );
      const winnerTeam = Engine.getTeam(winner);
      state.currentRound.tricksTaken[winnerTeam]++;
      state.currentRound.tricksPlayed++;

      const trickCards = [...state.currentRound.currentTrick];
      state.currentRound.tricks.push({
        cards: trickCards,
        winner,
        winnerTeam,
      });

      // Track trick for badges
      Badges.recordTrickWin(Engine.getTeam(mySeat), winnerTeam);
      UI.updatePointsDisplay();

      // Broadcast trick result
      if (!isSoloMode) Network.broadcast({ type: 'TRICK_RESULT', winner, trickCards });

      // Show trick result briefly, then clear
      broadcastState();
      UI.updateAll(state, mySeat);
      UI.showToast(`${state.players[winner].name} wins the trick!`);

      // Trigger trick win celebration
      const winnerRelIdx = ((winner - mySeat + 6) % 6);
      if (typeof UI.triggerTrickWinFX === 'function') {
        UI.triggerTrickWinFX(winnerRelIdx, winnerTeam);
      }

      // Delay before clearing trick and moving on
      setTimeout(() => {
        // Check for raise opportunity after 5 tricks
        if (state.currentRound.tricksPlayed === 5 && !state.currentRound.raised) {
          const biddingTeam = state.currentRound.biddingTeam;
          const biddingTricks = state.currentRound.tricksTaken[biddingTeam];
          if (biddingTricks >= state.currentRound.bid) {
            // Bidding team is winning — offer raise
            state.phase = 'RAISE_CHECK';
            state.currentRound.currentTrick = [];
            broadcastState();
            if (!isSoloMode) Network.broadcast({ type: 'RAISE_PROMPT' });
            UI.updateAll(state, mySeat);
            if (Engine.getTeam(mySeat) === biddingTeam) {
              UI.showRaisePrompt(state);
            } else if (isSoloMode) {
              // AI team is the bidding team — let AI decide
              const aiBidder = state.currentRound.bidder;
              setTimeout(() => aiHandleRaise(aiBidder), 800);
            }
            return;
          }
        }

        if (state.currentRound.tricksPlayed === 9) {
          // Round over
          state.currentRound.currentTrick = [];
          endRound();
          return;
        }

        // Next trick
        state.currentRound.currentTrick = [];
        state.currentRound.trickLeader = winner;
        state.currentRound.currentPlayer = winner;
        broadcastState();
        UI.updateAll(state, mySeat);
        checkAITurn();
      }, 1200); // 1.2s delay to see trick result
      return;
    }

    // Next player in the trick
    state.currentRound.currentPlayer = (seat + 1) % 6;
    broadcastState();
    UI.updateAll(state, mySeat);
    checkAITurn();
  }

  function handleRaiseBid(fromPeer, msg) {
    const seat = peerToSeat.get(fromPeer);
    if (!seat && seat !== 0) return;
    if (Engine.getTeam(seat) !== state.currentRound.biddingTeam) return;
    processRaise(msg.newBid);
  }

  function raiseBid(newBid) {
    if (isSoloMode || Network.getIsHost()) {
      processRaise(newBid);
    } else {
      const hostPeerId = seatToPeer.get(0) || Network.getConnectedPeers()[0];
      Network.sendTo(hostPeerId, { type: 'RAISE_BID', newBid });
    }
  }

  function noRaise() {
    if (isSoloMode || Network.getIsHost()) {
      processNoRaise();
    } else {
      const hostPeerId = seatToPeer.get(0) || Network.getConnectedPeers()[0];
      Network.sendTo(hostPeerId, { type: 'NO_RAISE' });
    }
  }

  function handleNoRaise(fromPeer) {
    const seat = peerToSeat.get(fromPeer);
    if (seat === undefined) return;
    if (Engine.getTeam(seat) !== state.currentRound.biddingTeam) return;
    processNoRaise();
  }

  function processRaise(newBid) {
    if (newBid > state.currentRound.bid && newBid <= 9) {
      state.currentRound.bid = newBid;
      state.currentRound.raised = true;
      UI.showToast(`Bid raised to ${newBid}!`);
    }
    resumeAfterRaise();
  }

  function resumeAfterRaise() {
    state.phase = 'PLAYING';
    const lastTrick = state.currentRound.tricks[state.currentRound.tricks.length - 1];
    state.currentRound.trickLeader = lastTrick.winner;
    state.currentRound.currentPlayer = lastTrick.winner;
    broadcastState();
    UI.updateAll(state, mySeat);
    checkAITurn();
  }

  function endRound() {
    const result = Engine.calculateScore(
      state.currentRound.biddingTeam,
      state.currentRound.bid,
      state.currentRound.tricksTaken
    );

    state.scores.A += result.A;
    state.scores.B += result.B;

    const roundResult = {
      type: 'ROUND_RESULT',
      biddingTeam: state.currentRound.biddingTeam,
      bid: state.currentRound.bid,
      tricksTaken: { ...state.currentRound.tricksTaken },
      scoreChange: result,
      totalScores: { ...state.scores },
      gs: result.gs,
      ls: result.ls,
    };

    state.roundHistory.push(roundResult);

    // Trigger slam celebration if applicable
    if ((result.gs || result.ls) && typeof FX !== 'undefined') {
      FX.slamCelebration();
    }

    // Track round end for badges
    Badges.recordRoundEnd(Engine.getTeam(mySeat), {
      scoreChange: result,
      ls: result.ls,
      gs: result.gs,
      biddingTeam: state.currentRound.biddingTeam,
    });
    const bidMet = result[state.currentRound.biddingTeam] > 0;
    Badges.recordBidWon(Engine.getTeam(mySeat), state.currentRound.biddingTeam, bidMet);
    UI.updatePointsDisplay();
    UI.renderBadgesGrid();

    if (!isSoloMode) Network.broadcast(roundResult);
    UI.showRoundResult(roundResult);

    if (Engine.isGameOver(state.scores)) {
      const winner = Engine.getWinner(state.scores);
      state.phase = 'GAME_OVER';
      if (!isSoloMode) Network.broadcast({ type: 'GAME_OVER', winner, scores: state.scores });
      UI.showGameOver(winner, state.scores);
    } else {
      state.dealer = (state.dealer + 1) % 6;
      state.phase = 'ROUND_END';
      broadcastState();
      // Auto-start next round after delay
      setTimeout(() => {
        if (state.phase === 'ROUND_END') {
          startNewRound();
        }
      }, 5000);
    }
  }

  // AI Logic
  function checkAITurn() {
    if (!isSoloMode && !Network.getIsHost()) return;
    const currentSeat = state.currentRound.currentPlayer;
    const player = state.players[currentSeat];
    if (!player || !player.isAI) return;

    const delay = isSoloMode ? 500 + Math.random() * 400 : 800 + Math.random() * 600;
    setTimeout(() => {
      if (state.phase === 'BIDDING') {
        aiMakeBid(currentSeat);
      } else if (state.phase === 'TRUMP_SELECT') {
        aiSelectTrump(currentSeat);
      } else if (state.phase === 'PLAYING') {
        aiPlayCard(currentSeat);
      } else if (state.phase === 'RAISE_CHECK') {
        aiHandleRaise(currentSeat);
      }
    }, delay);
  }

  // --- SMART AI ---

  function aiEvalHand(hand) {
    let strength = 0;
    const suitCounts = {};
    const suitStrength = {};

    for (const card of hand) {
      if (card.id === 'BIG_JOKER') { strength += 3; continue; }
      if (card.id === 'SMALL_JOKER') { strength += 2; continue; }
      if (!suitCounts[card.suit]) { suitCounts[card.suit] = 0; suitStrength[card.suit] = 0; }
      suitCounts[card.suit]++;
      if (card.rank === 'A') { strength += 1.5; suitStrength[card.suit] += 2; }
      else if (card.rank === 'K') { strength += 1; suitStrength[card.suit] += 1.5; }
      else if (card.rank === 'Q') { strength += 0.5; suitStrength[card.suit] += 1; }
    }

    // Best suit bonus: long suits are stronger as trump
    let bestSuit = null;
    let bestScore = -1;
    for (const [suit, count] of Object.entries(suitCounts)) {
      const score = count * 1.5 + (suitStrength[suit] || 0);
      if (score > bestScore) { bestScore = score; bestSuit = suit; }
    }

    // Length bonus for best suit
    if (bestSuit && suitCounts[bestSuit] >= 4) strength += 1;
    if (bestSuit && suitCounts[bestSuit] >= 5) strength += 1.5;

    return { strength, bestSuit, suitCounts, suitStrength };
  }

  function aiMakeBid(seat) {
    const hand = state.hands[seat];
    const eval_ = aiEvalHand(hand);

    let bid;
    if (eval_.strength >= 8) {
      bid = Math.min(9, Math.max(7, state.currentRound.bid + 1));
    } else if (eval_.strength >= 6) {
      bid = Math.min(7, Math.max(6, state.currentRound.bid + 1));
    } else if (eval_.strength >= 4.5) {
      bid = Math.max(5, state.currentRound.bid + 1);
    } else if (eval_.strength >= 3 && state.currentRound.bid < 5) {
      bid = 5;
    } else {
      bid = 0; // Pass
    }

    if (bid > 9) bid = 0; // Can't bid higher than 9
    processBid(seat, bid);
  }

  function aiSelectTrump(seat) {
    const hand = state.hands[seat];
    const eval_ = aiEvalHand(hand);
    processTrumpSelect(eval_.bestSuit || 'spades');
  }

  function aiPlayCard(seat) {
    const hand = state.hands[seat];
    if (hand.length === 0) return;

    const trump = state.currentRound.trumpSuit;
    const trick = state.currentRound.currentTrick;
    const isLeading = trick.length === 0;
    const leadSuit = !isLeading
      ? (trick[0].card.suit === 'joker' ? null : trick[0].card.suit)
      : null;

    const playable = Engine.getPlayableCards(hand, leadSuit, isLeading);
    if (playable.length === 1) { processPlayCard(seat, playable[0].id); return; }

    const myTeam = Engine.getTeam(seat);
    const isLastPlayer = trick.length === 5;

    // Check if teammate is currently winning the trick
    let teammateWinning = false;
    if (trick.length > 0) {
      const currentWinner = Engine.determineTrickWinnerRefined(trick, trump);
      teammateWinning = Engine.getTeam(currentWinner) === myTeam;
    }

    let chosen;

    if (isLeading) {
      // LEADING: cannot lead with joker — play strongest suited card
      const aces = playable.filter(c => c.rank === 'A');
      if (aces.length > 0) {
        // Lead with Ace of longest suit
        chosen = aces.sort((a, b) => {
          const countA = hand.filter(c => c.suit === a.suit).length;
          const countB = hand.filter(c => c.suit === b.suit).length;
          return countB - countA;
        })[0];
      } else {
        // Lead highest non-trump suited card
        const nonTrump = playable.filter(c => c.suit !== trump);
        if (nonTrump.length > 0) {
          chosen = nonTrump.sort((a, b) => Engine.RANK_VALUES[b.rank] - Engine.RANK_VALUES[a.rank])[0];
        } else {
          chosen = playable[0];
        }
      }
    } else if (teammateWinning && !isLastPlayer) {
      // Teammate winning — play lowest card to save strength
      chosen = getLowest(playable, trump);
    } else if (isLastPlayer && teammateWinning) {
      // Last player, teammate winning — dump lowest
      chosen = getLowest(playable, trump);
    } else {
      // Need to win — play cheapest winning card
      const winningCards = playable.filter(c => {
        const testTrick = [...trick, { playerIndex: seat, card: c }];
        const winner = Engine.determineTrickWinnerRefined(testTrick, trump);
        return winner === seat;
      });

      if (winningCards.length > 0) {
        // Play the cheapest winning card
        chosen = getLowest(winningCards, trump);
      } else {
        // Can't win — dump lowest
        chosen = getLowest(playable, trump);
      }
    }

    processPlayCard(seat, chosen.id);
  }

  function getLowest(cards, trump) {
    return cards.sort((a, b) => {
      // Jokers are high value, save them
      if (a.suit === 'joker') return 1;
      if (b.suit === 'joker') return -1;
      // Trump cards are valuable, save them
      if (a.suit === trump && b.suit !== trump) return 1;
      if (b.suit === trump && a.suit !== trump) return -1;
      // Lower rank = less valuable
      return Engine.RANK_VALUES[a.rank] - Engine.RANK_VALUES[b.rank];
    })[0];
  }

  function aiHandleRaise(seat) {
    if (Engine.getTeam(seat) !== state.currentRound.biddingTeam) return;
    const tricks = state.currentRound.tricksTaken[state.currentRound.biddingTeam];
    const remaining = 9 - state.currentRound.tricksPlayed;
    // If we've won all 5 so far and have strong cards, go for LS/GS
    if (tricks === 5 && remaining === 4) {
      const eval_ = aiEvalHand(state.hands[seat]);
      if (eval_.strength >= 4) {
        processRaise(8); // Go for LS
        return;
      }
    }
    processNoRaise();
  }

  // AI chat responses for solo mode
  const AI_CHAT_LINES = [
    'Nice play!', 'Good one!', 'Hmm, interesting move...',
    'Let\'s go team!', 'Watch out!', 'I see what you did there.',
    'Trump it!', 'Well played.', 'That was bold!',
    'My turn next...', 'Great trick!', 'Not bad!',
    'This round is ours!', 'Don\'t count us out yet!',
  ];

  function getRandomAIChatLine() {
    return AI_CHAT_LINES[Math.floor(Math.random() * AI_CHAT_LINES.length)];
  }

  // Send chat
  function sendChat(text) {
    if (!isSoloMode) {
      const msg = { type: 'CHAT', name: myName, text };
      Network.broadcast(msg);
    }
    UI.addChatMessage(myName, text);

    // AI responds in solo mode after a short delay
    if (isSoloMode) {
      const responder = AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)];
      const delay = 800 + Math.random() * 1200;
      setTimeout(() => {
        UI.addChatMessage(responder, getRandomAIChatLine());
      }, delay);
    }
  }

  // Sanitize state before sending (hide other players' hands)
  function sanitizeStateForClient(s) {
    const clean = JSON.parse(JSON.stringify(s));
    clean.hands = [[], [], [], [], [], []]; // Hands sent separately
    // Convert Set to array for JSON serialization (restored as Set on client)
    if (clean.currentRound && clean.currentRound.passedPlayers) {
      clean.currentRound.passedPlayers = Array.from(s.currentRound.passedPlayers || []);
    }
    return clean;
  }

  function broadcastState() {
    if (isSoloMode) return; // No network in solo mode
    const cleanState = sanitizeStateForClient(state);
    Network.broadcast({ type: 'STATE_UPDATE', state: cleanState });
  }

  return {
    hostGame, joinGame, startGame, startSoloGame,
    getState, getMySeat, getMyTeam,
    makeBid, selectTrump, playCard,
    raiseBid, noRaise, sendChat,
  };
})();
