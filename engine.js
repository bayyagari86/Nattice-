// ============================================================
// GAME ENGINE — Trump Call Card Game Rules & Logic
// ============================================================
//
// Rules Summary:
// - 6 players, 2 teams of 3 (alternate seating)
// - 54-card deck (52 + Big Joker + Small Joker)
// - 9 cards each, 9 tricks per round
// - Bidding: min 5, max 9; highest bidder's team picks trump
// - Card rank: A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2
// - Big Joker: highest card (beats everything)
// - Small Joker: beats all non-trump; loses to any trump card
// - Must follow suit if possible, BUT jokers can be played anytime
// - Cannot lead a trick with a joker
// - Scoring: bid met = bid value pts; bid failed = opponents get 2x bid pts
// - After 5 tricks, bidding team can raise bid
// - LS (8 tricks) = 15 pts; GS (9 tricks) = 30 pts
// - Game to 62 points

const Engine = (() => {
  const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const RANK_VALUES = {};
  RANKS.forEach((r, i) => RANK_VALUES[r] = i);

  // Card types
  const CARD_BIG_JOKER = { suit: 'joker', rank: 'BIG', id: 'BIG_JOKER' };
  const CARD_SMALL_JOKER = { suit: 'joker', rank: 'SMALL', id: 'SMALL_JOKER' };

  function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank, id: `${rank}_${suit}` });
      }
    }
    deck.push({ ...CARD_BIG_JOKER });
    deck.push({ ...CARD_SMALL_JOKER });
    return deck; // 54 cards
  }

  function dealCards(deck) {
    // 9 cards to each of 6 players
    const hands = [[], [], [], [], [], []];
    for (let i = 0; i < 54; i++) {
      hands[i % 6].push(deck[i]);
    }
    return hands;
  }

  // Teams: players 0,2,4 = Team A; players 1,3,5 = Team B
  function getTeam(playerIndex) {
    return playerIndex % 2 === 0 ? 'A' : 'B';
  }

  function getTeamPlayers(team) {
    return team === 'A' ? [0, 2, 4] : [1, 3, 5];
  }

  // Sort hand for display
  function sortHand(hand, trumpSuit) {
    const suitOrder = trumpSuit
      ? [trumpSuit, ...SUITS.filter(s => s !== trumpSuit)]
      : SUITS;
    return [...hand].sort((a, b) => {
      // Jokers first
      if (a.suit === 'joker' && b.suit === 'joker') {
        return a.rank === 'BIG' ? -1 : 1;
      }
      if (a.suit === 'joker') return -1;
      if (b.suit === 'joker') return 1;
      // By suit then rank
      const sA = suitOrder.indexOf(a.suit);
      const sB = suitOrder.indexOf(b.suit);
      if (sA !== sB) return sA - sB;
      return RANK_VALUES[b.rank] - RANK_VALUES[a.rank];
    });
  }

  // Check if a player can follow the lead suit
  function canFollowSuit(hand, leadSuit) {
    if (!leadSuit || leadSuit === 'joker') return false;
    return hand.some(c => c.suit === leadSuit);
  }

  // Get playable cards for a player
  function getPlayableCards(hand, leadSuit, isLeading) {
    if (isLeading) {
      // Leading a trick: cannot lead with a joker
      const nonJokers = hand.filter(c => c.suit !== 'joker');
      // If somehow only jokers left, allow them
      return nonJokers.length > 0 ? nonJokers : hand;
    }
    if (!leadSuit || leadSuit === 'joker') return hand; // No lead suit constraint
    // Must follow suit, BUT jokers are always playable (exempt from follow-suit)
    const suitCards = hand.filter(c => c.suit === leadSuit);
    const jokers = hand.filter(c => c.suit === 'joker');
    if (suitCards.length > 0) {
      // Must follow suit, but can also choose to play a joker instead
      return [...suitCards, ...jokers];
    }
    return hand; // Can play anything if can't follow suit
  }

  // Determine the winner of a trick
  function determineTrickWinner(cardsPlayed, trumpSuit) {
    // cardsPlayed: [{playerIndex, card}, ...]
    let winnerIdx = 0;
    let winnerCard = cardsPlayed[0].card;
    const leadSuit = cardsPlayed[0].card.suit === 'joker' ? null : cardsPlayed[0].card.suit;

    for (let i = 1; i < cardsPlayed.length; i++) {
      const card = cardsPlayed[i].card;
      if (beats(card, winnerCard, trumpSuit, leadSuit)) {
        winnerIdx = i;
        winnerCard = card;
      }
    }
    return cardsPlayed[winnerIdx].playerIndex;
  }

  // Does cardA beat cardB?
  function beats(cardA, cardB, trumpSuit, leadSuit) {
    const valA = cardValue(cardA, trumpSuit, leadSuit);
    const valB = cardValue(cardB, trumpSuit, leadSuit);
    return valA > valB;
  }

  // Card value in context of current trick
  function cardValue(card, trumpSuit, leadSuit) {
    // Big Joker: always highest
    if (card.id === 'BIG_JOKER') return 1000;

    // Small Joker: 
    // - If no trump cards on table context, it's very high (900)
    // - But loses to any trump card
    // We handle this by giving it value between non-trump and trump
    if (card.id === 'SMALL_JOKER') return 500; // Below trump A (which will be ~200+), above non-trump

    // Trump suit cards
    if (card.suit === trumpSuit) {
      return 200 + RANK_VALUES[card.rank]; // 200-212
    }

    // Lead suit cards
    if (card.suit === leadSuit) {
      return 100 + RANK_VALUES[card.rank]; // 100-112
    }

    // Off-suit (no value)
    return RANK_VALUES[card.rank]; // 0-12
  }

  // Refined trick winner that handles Small Joker correctly
  function determineTrickWinnerRefined(cardsPlayed, trumpSuit) {
    const leadCard = cardsPlayed[0].card;
    const leadSuit = leadCard.suit === 'joker' ? null : leadCard.suit;

    // Check if any trump card was played
    const hasTrump = cardsPlayed.some(cp => cp.card.suit === trumpSuit);

    let bestIdx = 0;
    let bestVal = -1;

    for (let i = 0; i < cardsPlayed.length; i++) {
      const card = cardsPlayed[i].card;
      let val;

      if (card.id === 'BIG_JOKER') {
        val = 1000;
      } else if (card.id === 'SMALL_JOKER') {
        // Small joker loses to trump but beats everything else
        val = hasTrump ? 150 : 900; // If trump was played, small joker is below trump
      } else if (card.suit === trumpSuit) {
        val = 200 + RANK_VALUES[card.rank];
      } else if (card.suit === leadSuit) {
        val = 100 + RANK_VALUES[card.rank];
      } else {
        val = RANK_VALUES[card.rank];
      }

      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }

    return cardsPlayed[bestIdx].playerIndex;
  }

  // Bidding validation
  function isValidBid(bid, currentHighBid, phase = 'BIDDING', gameState = null) {
    if (bid === 0) return true; // Pass
    if (bid < 5 || bid > 9) return false;

    // Initial bidding phase: starts at 5, can go to 6-7 normally, 8-9 for strong hands
    if (phase === 'BIDDING') {
      if (currentHighBid === 0) return bid >= 5 && bid <= 7; // First bid: 5-7
      return bid > currentHighBid && bid <= 9; // Can raise to 8-9 if confident
    }

    // Raise phase (RAISE_CHECK after 5 tricks): only winning team can raise
    if (phase === 'RAISE_CHECK' && gameState) {
      const biddingTeam = gameState.currentRound?.biddingTeam;
      const tricksPlayed = gameState.currentRound?.tricksPlayed || 0;
      const tricksTaken = gameState.currentRound?.tricksTaken || { A: 0, B: 0 };
      const isWinningTeam = tricksTaken[biddingTeam] >= tricksPlayed;

      // Raise option only comes after 5 tricks, and only for winning team
      if (tricksPlayed < 5) return false;
      if (!isWinningTeam) return false;

      // Winning team can raise up to 9
      return bid > currentHighBid && bid <= 9;
    }

    // Default fallback (shouldn't reach here in normal flow)
    if (currentHighBid === 0) return bid >= 5;
    return bid > currentHighBid;
  }

  // Scoring
  function calculateScore(biddingTeam, bid, tricksTaken) {
    const teamATricks = tricksTaken['A'] || 0;
    const teamBTricks = tricksTaken['B'] || 0;
    const biddingTricks = biddingTeam === 'A' ? teamATricks : teamBTricks;
    const opposingTeam = biddingTeam === 'A' ? 'B' : 'A';

    const result = { A: 0, B: 0, gs: false, ls: false };

    if (biddingTricks === 9) {
      // Grand Slam
      result[biddingTeam] = 30;
      result.gs = true;
    } else if (biddingTricks === 8) {
      // Little Slam
      result[biddingTeam] = 15;
      result.ls = true;
    } else if (biddingTricks >= bid) {
      // Bid met — winner gets exactly what they bid
      result[biddingTeam] = bid;
    } else {
      // Bid failed — opponents get double the bid
      result[opposingTeam] = bid * 2;
    }

    return result;
  }

  // Check if game is over (62 points)
  function isGameOver(scores) {
    return scores.A >= 62 || scores.B >= 62;
  }

  function getWinner(scores) {
    if (scores.A >= 62) return 'A';
    if (scores.B >= 62) return 'B';
    return null;
  }

  // Create initial game state
  function createGameState() {
    return {
      phase: 'WAITING', // WAITING, BIDDING, TRUMP_SELECT, PLAYING, RAISE_CHECK, ROUND_END, GAME_OVER
      players: [], // [{id, name, seat, connected}]
      hands: [[], [], [], [], [], []],
      scores: { A: 0, B: 0 },
      currentRound: {
        bid: 0,
        bidder: -1,
        biddingTeam: null,
        trumpSuit: null,
        currentBidder: 0,
        bids: [],
        passCount: 0,
        tricks: [],
        currentTrick: [],
        tricksTaken: { A: 0, B: 0 },
        trickLeader: 0,
        currentPlayer: 0,
        tricksPlayed: 0,
        raised: false,
      },
      dealer: 0,
      roundHistory: [],
    };
  }

  return {
    SUITS, RANKS, RANK_VALUES,
    createDeck, dealCards,
    getTeam, getTeamPlayers,
    sortHand, canFollowSuit, getPlayableCards,
    determineTrickWinnerRefined,
    isValidBid, calculateScore,
    isGameOver, getWinner,
    createGameState,
  };
})();
