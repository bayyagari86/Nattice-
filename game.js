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

  // --- AI Memory: learns from human plays each round ---
  // Tracks per-seat: suit void tendencies, trump usage pattern, joker sightings
  let aiMemory = {
    suitVoids: {},        // seat -> Set of suits they've shown void in
    trumpUsed: {},        // seat -> count of trump cards played
    jokerSeen: {},        // 'BIG_JOKER'/'SMALL_JOKER' -> seat that played it (or null)
    highCardPlayed: {},   // seat -> { suit -> highest rank seen }
    humanLeadPatterns: [],// last 5 lead suits from human (seat 0) — detect tendencies
    opponentTrumpA: {},   // suit -> whether trump Ace has been played
  };

  function resetAiMemory() {
    aiMemory = {
      suitVoids: {}, trumpUsed: {}, jokerSeen: {},
      highCardPlayed: {}, humanLeadPatterns: [], opponentTrumpA: {},
    };
  }

  function updateAiMemoryFromTrick(trick, trump) {
    for (const cp of trick) {
      const { playerIndex: seat, card } = cp;
      const leadSuit = trick[0].card.suit === 'joker' ? null : trick[0].card.suit;

      // Track joker plays
      if (card.id === 'BIG_JOKER' || card.id === 'SMALL_JOKER') {
        aiMemory.jokerSeen[card.id] = seat;
      }

      // Track trump Ace played
      if (card.suit === trump && card.rank === 'A') {
        aiMemory.opponentTrumpA[trump] = true;
      }

      // Track suit voids: player didn't follow suit = void in lead suit
      if (!aiMemory.suitVoids[seat]) aiMemory.suitVoids[seat] = new Set();
      if (leadSuit && card.suit !== leadSuit && card.suit !== 'joker') {
        aiMemory.suitVoids[seat].add(leadSuit);
      }

      // Track trump usage count
      if (card.suit === trump) {
        aiMemory.trumpUsed[seat] = (aiMemory.trumpUsed[seat] || 0) + 1;
      }

      // Track high cards seen per seat/suit
      if (!aiMemory.highCardPlayed[seat]) aiMemory.highCardPlayed[seat] = {};
      if (card.suit && card.suit !== 'joker') {
        const prev = aiMemory.highCardPlayed[seat][card.suit] || 0;
        aiMemory.highCardPlayed[seat][card.suit] = Math.max(prev, Engine.RANK_VALUES[card.rank] || 0);
      }

      // Track human (seat 0) lead patterns
      if (seat === 0 && cp === trick[0] && leadSuit) {
        aiMemory.humanLeadPatterns.push(leadSuit);
        if (aiMemory.humanLeadPatterns.length > 6) aiMemory.humanLeadPatterns.shift();
      }
    }
  }

  // Themed name sets — each set of 5 used together as a lobby persona batch
  // Rotate the ENTIRE set after each full game (62 pts reached)
  const AI_NAME_SETS = [
    // 0 — Classic South Indian
    ['Arjun','Priya','Kiran','Meera','Ravi'],
    // 1 — North Indian Metro
    ['Dev','Aanya','Rohan','Simran','Nikhil'],
    // 2 — Odia Traditional ✨
    ['Biswa','Sasmita','Pradyumna','Sulochana','Tapan'],
    // 3 — Odia Modern ✨
    ['Subha','Lipsa','Debasis','Ankita','Sushant'],
    // 4 — Odia Coastal/Puri vibes ✨
    ['Jagannath','Bidulata','Krushna','Mamata','Bapi'],
    // 5 — Odia Gen Z ✨
    ['Rishav','Priyanka','Siddharth','Barsha','Dibyajyoti'],
    // 6 — Pan-Indian Gen Z
    ['Zara','Ayaan','Myra','Rehan','Tara'],
    // 7 — Bollywood vibes
    ['Raj','Simran','Rahul','Pooja','Kabir'],
    // 8 — Sporty nicknames
    ['Sunny','Bunny','Rocky','Lucky','Pinky'],
    // 9 — South Indian Modern
    ['Aditi','Vikram','Kavya','Siddharth','Divya'],
  ];
  // Per-seat name pools for mid-round rotation (drawn from all sets)
  const AI_NAME_POOL = [
    ['Arjun','Dev','Rohan','Vikram','Biswa','Subha','Rishav','Debasis','Pradyumna','Sushant','Sunny','Raj'],
    ['Priya','Aanya','Ananya','Sasmita','Lipsa','Barsha','Simran','Pooja','Divya','Ankita','Lucky','Meera'],
    ['Kiran','Rahul','Aditya','Krushna','Tapan','Siddharth','Rocky','Kabir','Jagannath','Bapi','Nikhil','Ravi'],
    ['Meera','Simran','Sulochana','Mamata','Bidulata','Priyanka','Tara','Myra','Kavya','Rekha','Geeta','Sneha'],
    ['Ravi','Nikhil','Dibyajyoti','Sushant','Debasis','Rehan','Bunny','Pinky','Suresh','Mohan','Deepak','Gopal'],
  ];
  let aiCurrentSetIdx = 0;
  let aiNameRotateTimer = null;

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
    startAINameRotation();
    startNewRound();
  }

  // Rotate AI bot names once between rounds (called at ROUND_END)
  function rotateAINamesBetweenRounds() {
    if (!state || !isSoloMode) return;
    for (let i = 1; i < 6; i++) {
      const pool = AI_NAME_POOL[i - 1];
      const currentName = state.players[i]?.name;
      let newName = currentName;
      let tries = 0;
      while (newName === currentName && tries++ < 20) {
        newName = pool[Math.floor(Math.random() * pool.length)];
      }
      if (state.players[i] && newName !== currentName) {
        state.players[i].name = newName;
      }
    }
  }

  function startAINameRotation() { /* no-op — names now rotate between rounds */ }
  function stopAINameRotation() { /* no-op */ }

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
      case 'RAISE_COMMIT':
        handleRaiseCommit(fromPeer, msg);
        break;
      case 'EXTEND_TIMER':
        handleExtendTimer(fromPeer, msg);
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
      case 'HAND_UPDATE':
        // Update our hand after playing a card
        if (msg.hand) {
          state.hands[mySeat] = msg.hand;
          UI.updateAll(state, mySeat);
        }
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
    resetAiMemory();
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
      raiseCommitments: {}, // seat -> number of additional tricks they can win
      raiseTimer: null,
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
      // Client: optimistically remove card from own hand immediately
      const hand = state.hands[mySeat];
      const cardIdx = hand.findIndex(c => c.id === cardId);
      if (cardIdx !== -1) {
        hand.splice(cardIdx, 1);
        UI.updateAll(state, mySeat);
      }
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
      // Update AI memory from this completed trick
      updateAiMemoryFromTrick(trickCards, state.currentRound.trumpSuit);
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
            state.currentRound.raiseCommitments = {};
            state.currentRound.raiseTimer = 20; // 20 seconds
            broadcastState();
            if (!isSoloMode) Network.broadcast({ type: 'RAISE_PROMPT' });
            UI.updateAll(state, mySeat);
            if (Engine.getTeam(mySeat) === biddingTeam) {
              UI.showRaisePrompt(state);
            } else if (isSoloMode) {
              // AI teammates suggest their capability
              setTimeout(() => aiSuggestRaiseCommitment(), 1000);
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
    
    // Send updated hand to network player AFTER broadcastState to avoid race condition
    if (!isSoloMode && seat !== 0) {
      const playerPeerId = seatToPeer.get(seat);
      if (playerPeerId) {
        Network.sendTo(playerPeerId, {
          type: 'HAND_UPDATE',
          hand: state.hands[seat],
        });
      }
    }
    
    UI.updateAll(state, mySeat);
    checkAITurn();
  }

  function handleRaiseBid(fromPeer, msg) {
    const seat = peerToSeat.get(fromPeer);
    if (!seat && seat !== 0) return;
    if (Engine.getTeam(seat) !== state.currentRound.biddingTeam) return;
    // Only bidder can confirm final raise
    if (seat !== state.currentRound.bidder) return;
    processRaise(msg.newBid);
  }

  function handleRaiseCommit(fromPeer, msg) {
    const seat = peerToSeat.get(fromPeer);
    if (!seat && seat !== 0) return;
    if (Engine.getTeam(seat) !== state.currentRound.biddingTeam) return;
    state.currentRound.raiseCommitments[seat] = msg.tricks;
    broadcastState();
    UI.updateAll(state, mySeat);
  }

  function handleExtendTimer(fromPeer, msg) {
    const seat = peerToSeat.get(fromPeer);
    if (!seat && seat !== 0) return;
    if (Engine.getTeam(seat) !== state.currentRound.biddingTeam) return;
    state.currentRound.raiseTimer += 10;
    broadcastState();
    UI.updateAll(state, mySeat);
  }

  function commitRaiseTricks(tricks) {
    if (isSoloMode || Network.getIsHost()) {
      state.currentRound.raiseCommitments[mySeat] = tricks;
      broadcastState();
      UI.updateAll(state, mySeat);
    } else {
      const hostPeerId = seatToPeer.get(0) || Network.getConnectedPeers()[0];
      Network.sendTo(hostPeerId, { type: 'RAISE_COMMIT', tricks });
    }
  }

  function extendRaiseTimer() {
    if (isSoloMode || Network.getIsHost()) {
      state.currentRound.raiseTimer += 10;
      broadcastState();
      UI.updateAll(state, mySeat);
    } else {
      const hostPeerId = seatToPeer.get(0) || Network.getConnectedPeers()[0];
      Network.sendTo(hostPeerId, { type: 'EXTEND_TIMER' });
    }
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
      // Rotate to a new named personality set for the next game
      if (isSoloMode) {
        let nextIdx = aiCurrentSetIdx;
        while (nextIdx === aiCurrentSetIdx) nextIdx = Math.floor(Math.random() * AI_NAME_SETS.length);
        aiCurrentSetIdx = nextIdx;
        const newSet = AI_NAME_SETS[aiCurrentSetIdx];
        for (let i = 1; i < 6; i++) {
          if (state.players[i]) state.players[i].name = newSet[i - 1];
        }
      }
      if (!isSoloMode) Network.broadcast({ type: 'GAME_OVER', winner, scores: state.scores });
      UI.showGameOver(winner, state.scores);
    } else {
      state.dealer = (state.dealer + 1) % 6;
      state.phase = 'ROUND_END';
      rotateAINamesBetweenRounds();
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

    // Different delays for different phases
    let delay;
    if (state.phase === 'PLAYING') {
      // 20 seconds for card play
      delay = 20000;
    } else if (state.phase === 'BIDDING' || state.phase === 'TRUMP_SELECT') {
      // Faster for bidding/trump selection
      delay = isSoloMode ? 1000 + Math.random() * 500 : 1500 + Math.random() * 1000;
    } else {
      // Default for other phases
      delay = isSoloMode ? 500 + Math.random() * 400 : 800 + Math.random() * 600;
    }

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
    const totalPlayers = trick.length + 1; // including me
    const playersYetToPlay = 6 - totalPlayers; // players after me
    const isLastPlayer = trick.length === 5;

    // --- Card counting: build set of played cards across all tricks ---
    const playedCards = new Set();
    for (const pastTrick of (state.currentRound.tricks || [])) {
      for (const cp of (pastTrick.cards || pastTrick)) playedCards.add(cp.card?.id || cp.id);
    }
    for (const cp of trick) playedCards.add(cp.card.id);

    // --- Who is currently winning this trick? ---
    let currentWinner = null;
    let teammateWinning = false;
    let opponentWinning = false;
    if (trick.length > 0) {
      currentWinner = Engine.determineTrickWinnerRefined(trick, trump);
      teammateWinning = Engine.getTeam(currentWinner) === myTeam;
      opponentWinning = !teammateWinning;
    }

    // --- Will my teammate still win after remaining players play? ---
    // Conservative: only trust teammate win if no opponents play after us
    const opponentSeatsAfter = [];
    for (let i = 1; i <= playersYetToPlay; i++) {
      const futureSeat = (seat + i) % 6;
      if (Engine.getTeam(futureSeat) !== myTeam) opponentSeatsAfter.push(futureSeat);
    }
    const teammateWinSafe = teammateWinning && opponentSeatsAfter.length === 0;
    const teammateWinLikely = teammateWinning && opponentSeatsAfter.length > 0
      && currentWinner !== null
      && isTrickWinLikelySecure(trick, trump, opponentSeatsAfter, state);

    // --- Helper: check if winning card is strong enough opponents can't beat it ---
    function isTrickWinLikelySecure(trickSoFar, trump, oppSeats, st) {
      const winnerIdx = Engine.determineTrickWinnerRefined(trickSoFar, trump);
      const winCard = trickSoFar.find(cp => cp.playerIndex === winnerIdx).card;
      // If winning card is a joker or trump A/K, it's very likely secure
      if (winCard.id === 'BIG_JOKER') return true;
      if (winCard.id === 'SMALL_JOKER') {
        // Safe only if no trump cards in opponents' potential hands
        return !oppSeats.some(s => (st.hands[s] || []).some(c => c.suit === trump));
      }
      if (winCard.suit === trump) {
        const winVal = Engine.RANK_VALUES[winCard.rank];
        // Safe if no higher trump left (check opponents' hands)
        const higherTrumpExists = oppSeats.some(s =>
          (st.hands[s] || []).some(c => c.suit === trump && Engine.RANK_VALUES[c.rank] > winVal)
        );
        return !higherTrumpExists;
      }
      return false; // Non-trump lead can easily be beaten
    }

    // --- Context flags ---
    const myTeamBid = state.currentRound.biddingTeam === myTeam;
    const bidder = state.currentRound.bidder;
    const isBidder = seat === bidder;
    const isTeammateBidder = bidder >= 0 && Engine.getTeam(bidder) === myTeam && !isBidder;
    const tricksLeft = 9 - state.currentRound.tricksPlayed;
    const teamTricks = state.currentRound.tricksTaken[myTeam] || 0;
    const oppTeam = myTeam === 'A' ? 'B' : 'A';
    const oppTricks = state.currentRound.tricksTaken[oppTeam] || 0;
    const bigJokerGone = !!aiMemory.jokerSeen['BIG_JOKER'];
    const smallJokerGone = !!aiMemory.jokerSeen['SMALL_JOKER'];
    const trumpAcePlayed = !!aiMemory.opponentTrumpA[trump];
    const hasBigJoker = playable.some(c => c.id === 'BIG_JOKER');
    const hasSmallJoker = playable.some(c => c.id === 'SMALL_JOKER');

    // What card is currently winning (if any)?
    const currentWinCard = currentWinner !== null
      ? trick.find(cp => cp.playerIndex === currentWinner)?.card
      : null;
    const oppWinningWithJoker = opponentWinning && currentWinCard &&
      (currentWinCard.id === 'BIG_JOKER' || currentWinCard.id === 'SMALL_JOKER');
    const oppWinningWithTrumpA = opponentWinning && currentWinCard &&
      currentWinCard.suit === trump && currentWinCard.rank === 'A';
    const oppWinningWithHighTrump = opponentWinning && currentWinCard &&
      currentWinCard.suit === trump && Engine.RANK_VALUES[currentWinCard.rank] >= 10; // K or A

    let chosen;

    if (isLeading) {
      chosen = aiChooseLeadCard(seat, hand, playable, trump, playedCards, myTeam);

    } else if (teammateWinSafe || teammateWinLikely) {
      // Teammate winning securely — NEVER use Big Joker here, just dump cheap
      chosen = getDumpCard(playable, trump, leadSuit);

    } else if (teammateWinning && !isLastPlayer) {
      // Teammate winning but opponents still to act — dump cheap, save big guns
      chosen = getDumpCard(playable, trump, leadSuit);

    } else {
      // Need to contest or win this trick
      // --- BIG JOKER STRATEGY ---
      // Only use Big Joker when:
      // 1. Opponent is winning with a joker/trump A that nothing else can beat
      // 2. This is a critical trick (team needs it to meet/save bid)
      // 3. It's the last few tricks (tricksLeft <= 3) and we need every trick
      const criticalTrick = myTeamBid
        ? teamTricks < state.currentRound.bid  // bidding team needs tricks
        : oppTricks >= state.currentRound.bid - 1; // defending team must stop them
      const endgame = tricksLeft <= 3;

      if (hasBigJoker) {
        // Don't use Big Joker if a cheaper card can win
        const cheapWins = playable.filter(c => {
          if (c.id === 'BIG_JOKER' || c.id === 'SMALL_JOKER') return false;
          const testTrick = [...trick, { playerIndex: seat, card: c }];
          return Engine.determineTrickWinnerRefined(testTrick, trump) === seat;
        });

        const shouldUseBigJoker =
          (oppWinningWithJoker || oppWinningWithTrumpA) && criticalTrick ||
          (cheapWins.length === 0 && criticalTrick && (opponentWinning || endgame));

        if (!shouldUseBigJoker) {
          // Save Big Joker — try to win cheaply without it
          if (cheapWins.length > 0) {
            const nonTrumpCheap = cheapWins.filter(c => c.suit !== trump);
            chosen = nonTrumpCheap.length > 0
              ? nonTrumpCheap.sort((a, b) => Engine.RANK_VALUES[a.rank] - Engine.RANK_VALUES[b.rank])[0]
              : getLowest(cheapWins, trump);
          } else {
            chosen = getDumpCard(playable, trump, leadSuit);
          }
        } else {
          // Use Big Joker — opponent has something unbeatable otherwise
          chosen = playable.find(c => c.id === 'BIG_JOKER');
        }
      } else if (hasSmallJoker) {
        // SMALL JOKER STRATEGY:
        // Use it to kill opponent's trump A or high trump when Big Joker is gone
        // Also use if no trump cards are on table (Small Joker wins)
        const trumpOnTable = trick.some(cp => cp.card.suit === trump);
        const smallJokerWins = (() => {
          const testTrick = [...trick, { playerIndex: seat, card: playable.find(c => c.id === 'SMALL_JOKER') }];
          return Engine.determineTrickWinnerRefined(testTrick, trump) === seat;
        })();

        const cheapWins = playable.filter(c => {
          if (c.suit === 'joker') return false;
          const testTrick = [...trick, { playerIndex: seat, card: c }];
          return Engine.determineTrickWinnerRefined(testTrick, trump) === seat;
        });

        const useSmallJoker = smallJokerWins && (
          (oppWinningWithTrumpA && bigJokerGone) ||
          (criticalTrick && cheapWins.length === 0 && !trumpOnTable)
        );

        if (useSmallJoker) {
          chosen = playable.find(c => c.id === 'SMALL_JOKER');
        } else if (cheapWins.length > 0) {
          const nonTrumpCheap = cheapWins.filter(c => c.suit !== trump);
          chosen = nonTrumpCheap.length > 0
            ? nonTrumpCheap.sort((a, b) => Engine.RANK_VALUES[a.rank] - Engine.RANK_VALUES[b.rank])[0]
            : getLowest(cheapWins, trump);
        } else {
          chosen = getDumpCard(playable, trump, leadSuit);
        }
      } else {
        // No jokers — standard: find cheapest winning card
        const winningCards = playable.filter(c => {
          const testTrick = [...trick, { playerIndex: seat, card: c }];
          return Engine.determineTrickWinnerRefined(testTrick, trump) === seat;
        });

        if (winningCards.length > 0) {
          const nonTrumpWins = winningCards.filter(c => c.suit !== trump);
          if (nonTrumpWins.length > 0) {
            chosen = nonTrumpWins.sort((a, b) => Engine.RANK_VALUES[a.rank] - Engine.RANK_VALUES[b.rank])[0];
          } else {
            chosen = getLowest(winningCards, trump);
          }
        } else {
          // Can't win — dump to avoid wasting trump
          // Use memory: if opponent is known void in a suit, don't lead that suit next time
          chosen = getDumpCard(playable, trump, leadSuit);
        }
      }
    }

    // Safety fallback
    if (!chosen) chosen = playable[0];
    processPlayCard(seat, chosen.id);
  }

  // Choose what to lead with — memory-aware and unpredictable
  function aiChooseLeadCard(seat, hand, playable, trump, playedCards, myTeam) {
    const oppTeam = myTeam === 'A' ? 'B' : 'A';

    // Identify opponent seats
    const oppSeats = [0,1,2,3,4,5].filter(s => Engine.getTeam(s) === oppTeam);

    // Suits the human has been repeatedly leading (patterns to counter)
    const humanFavSuit = (() => {
      if (aiMemory.humanLeadPatterns.length < 2) return null;
      const counts = {};
      for (const s of aiMemory.humanLeadPatterns) counts[s] = (counts[s] || 0) + 1;
      const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
      return sorted[0]?.[0] || null;
    })();

    // Suits where opponents are known to be strong (have played high cards)
    const oppStrongSuits = new Set();
    for (const s of oppSeats) {
      const high = aiMemory.highCardPlayed[s] || {};
      for (const [suit, val] of Object.entries(high)) {
        if (val >= 11) oppStrongSuits.add(suit); // K or A seen
      }
    }

    // Suits opponents are known void in (great to lead — forces them off-suit)
    const oppVoidSuits = new Set();
    for (const s of oppSeats) {
      const voids = aiMemory.suitVoids[s] || new Set();
      for (const v of voids) oppVoidSuits.add(v);
    }

    // 1. Lead a suit opponents are void in (they can't follow, forces trump or dump)
    const voidLeads = playable.filter(c =>
      c.suit !== trump && c.suit !== 'joker' && oppVoidSuits.has(c.suit)
    );
    if (voidLeads.length > 0) {
      // Lead highest of that suit — it will win since they're void
      return voidLeads.sort((a,b) => Engine.RANK_VALUES[b.rank] - Engine.RANK_VALUES[a.rank])[0];
    }

    // 2. Lead a suit where we have the Ace (guaranteed win)
    const aces = playable.filter(c => c.rank === 'A' && c.suit !== trump && c.suit !== 'joker');
    if (aces.length > 0) {
      // Prefer ace of suit NOT in opponents' strong suits
      const safeAces = aces.filter(c => !oppStrongSuits.has(c.suit));
      const pool = safeAces.length > 0 ? safeAces : aces;
      // Lead ace of shortest suit (clears it out fast)
      return pool.sort((a, b) => {
        const cA = hand.filter(c => c.suit === a.suit).length;
        const cB = hand.filter(c => c.suit === b.suit).length;
        return cA - cB;
      })[0];
    }

    // 3. Lead a suit where King is now highest (ace played)
    const kings = playable.filter(c => c.rank === 'K' && c.suit !== trump && c.suit !== 'joker');
    for (const k of kings) {
      if (playedCards.has(`A-${k.suit}`)) return k;
    }

    // 4. Counter human's favourite lead — lead a DIFFERENT suit to confuse
    const nonTrump = playable.filter(c => c.suit !== trump && c.suit !== 'joker');
    if (nonTrump.length > 0) {
      const suitLengths = {};
      for (const c of hand) {
        if (c.suit !== trump && c.suit !== 'joker')
          suitLengths[c.suit] = (suitLengths[c.suit] || 0) + 1;
      }

      // Avoid human's favourite suit (be unpredictable)
      const nonFav = nonTrump.filter(c => c.suit !== humanFavSuit);
      const pool = nonFav.length > 0 ? nonFav : nonTrump;

      // Avoid suits opponents are strong in
      const safe = pool.filter(c => !oppStrongSuits.has(c.suit));
      const finalPool = safe.length > 0 ? safe : pool;

      // Sort by suit length desc, then within that suit lead second-highest to hide Ace/King
      finalPool.sort((a,b) => (suitLengths[b.suit] || 0) - (suitLengths[a.suit] || 0));
      const longSuit = finalPool[0].suit;
      const longSuitCards = finalPool.filter(c => c.suit === longSuit)
        .sort((a,b) => Engine.RANK_VALUES[b.rank] - Engine.RANK_VALUES[a.rank]);

      if (longSuitCards.length >= 3) {
        // Lead 2nd highest — conceals Ace/King, opponent can't read hand
        return longSuitCards[1];
      }
      return finalPool[0];
    }

    return playable[0];
  }

  // Dump the least valuable card — protect trump, jokers, and high suited cards
  function getDumpCard(playable, trump, leadSuit) {
    // Sort by value ascending: off-suit low ranks first, then lead-suit low, then trump low, jokers last
    const sorted = [...playable].sort((a, b) => {
      const valA = dumpValue(a, trump, leadSuit);
      const valB = dumpValue(b, trump, leadSuit);
      return valA - valB;
    });
    return sorted[0];
  }

  function dumpValue(card, trump, leadSuit) {
    if (card.id === 'BIG_JOKER') return 10000;
    if (card.id === 'SMALL_JOKER') return 9000;
    if (card.suit === trump) return 500 + Engine.RANK_VALUES[card.rank];
    if (card.suit === leadSuit) return 200 + Engine.RANK_VALUES[card.rank];
    // Off-suit: lowest value to dump
    return Engine.RANK_VALUES[card.rank];
  }

  // AI teammates suggest how many tricks they can win during raise discussion
  function aiSuggestRaiseCommitment() {
    const biddingTeam = state.currentRound.biddingTeam;
    const aiSeats = [1, 2, 3, 4, 5].filter(s => 
      state.players[s]?.isAI && Engine.getTeam(s) === biddingTeam
    );

    for (const seat of aiSeats) {
      const hand = state.hands[seat];
      if (!hand || hand.length === 0) continue;

      const trump = state.currentRound.trumpSuit;
      const eval_ = aiEvalHand(hand);
      
      // Estimate additional tricks AI can win
      let canWin = 0;
      const hasBigJoker = hand.some(c => c.id === 'BIG_JOKER');
      const hasSmallJoker = hand.some(c => c.id === 'SMALL_JOKER');
      const trumpCards = hand.filter(c => c.suit === trump);
      const highTrump = trumpCards.filter(c => Engine.RANK_VALUES[c.rank] >= 11); // A or K
      
      if (hasBigJoker) canWin++;
      if (hasSmallJoker && !aiMemory.opponentTrumpA[trump]) canWin++;
      canWin += Math.min(highTrump.length, 2);
      
      // Cap at remaining tricks
      const remaining = 4; // 9 total - 5 played
      canWin = Math.min(canWin, remaining);

      if (canWin > 0) {
        state.currentRound.raiseCommitments[seat] = canWin;
        const playerName = state.players[seat].name;
        const msg = canWin === 1 ? `I can take 1 more 💪` : `I can win ${canWin} more 🔥`;
        setTimeout(() => {
          UI.addChatMessage(playerName, msg);
        }, 500 + seat * 300);
      }
    }

    // Update UI after all AI commitments
    setTimeout(() => {
      broadcastState();
      UI.updateAll(state, mySeat);
    }, 2000);
  }

  function getLowest(cards, trump) {
    return cards.sort((a, b) => {
      if (a.suit === 'joker') return 1;
      if (b.suit === 'joker') return -1;
      if (a.suit === trump && b.suit !== trump) return 1;
      if (b.suit === trump && a.suit !== trump) return -1;
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

  // AI chat responses — mix of English + proper Odia script ✨
  const AI_CHAT_LINES = [
    'Nice play! 👏', 'Good one!', 'Hmm, interesting move...',
    'Let\'s go team! 💪', 'Watch out! 👀', 'I see what you did there.',
    'Trump it! 🔥', 'Well played.', 'That was bold!',
    'My turn next...', 'Great trick!', 'Not bad!',
    'This round is ours! 🏆', 'Don\'t count us out yet!',
    // Odia script lines ✨
    'ଆଜି ଆମେ ଜିତିବା! 🦁',       // Today we will win!
    'ଏଇ କାର୍ଡ ବଡ଼ ଶକ୍ତ! 💥',     // This card is very strong!
    'ଦାଦା, କଣ କଲେ? 😂',           // Bro, what did you do?
    'ମିଠା ଖେଳ ଖେଳୁଛ! 🍬',         // Playing a sweet game!
    'ଜୋକର ଦେବ ନାହିଁ! 🃏',         // Won\'t give the joker!
    'ପାଗଳ ହୋଇଗଲ କି? 😵',          // Have you gone crazy?
    'ସହି ବାତ! 👍',                  // Correct thing!
    'ଆମ ଟିମ୍ ବେଷ୍ଟ! 🤝',           // Our team is the best!
    'ଟ୍ରମ୍ପ ଦିଅ ଏଠି! 😤',           // Give trump here!
    'ହଁ ହଁ! ହୁଁ! 😤',               // Odia exclamation
    'ଏଇଟା ଧମାକା! 🔥',              // This is a blast!
    'ଭଲ ଖେଳ, ଭଲ ଖେଳ! 👌',        // Good game, good game!
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
    raiseBid, noRaise, commitRaiseTricks, extendRaiseTimer, sendChat,
    stopAINameRotation,
  };
})();
