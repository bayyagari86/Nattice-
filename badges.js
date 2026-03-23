// ============================================================
// BADGES & POINTS SYSTEM
// ============================================================
// Tracks achievements, streaks, and awards badges during gameplay.
// All state is in-memory (no persistent storage needed).

const Badges = (() => {
  // Player stats (tracked per game session)
  let stats = {
    tricksWon: 0,
    tricksPlayed: 0,
    roundsWon: 0,
    roundsPlayed: 0,
    bidsWon: 0,
    bidsMade: 0,
    slamCount: 0,
    grandSlamCount: 0,
    currentStreak: 0,    // Consecutive tricks won
    bestStreak: 0,
    trumpCalls: 0,
    points: 0,           // Total badge points
  };

  // Badge definitions
  const BADGES = [
    { id: 'first_trick',   name: 'First Blood',      icon: '\u2694\ufe0f',  desc: 'Win your first trick',                condition: () => stats.tricksWon >= 1, pts: 10 },
    { id: 'trick_5',       name: 'Trick Master',      icon: '\ud83c\udccf',  desc: 'Win 5 tricks in one game',            condition: () => stats.tricksWon >= 5, pts: 25 },
    { id: 'trick_15',      name: 'Card Shark',        icon: '\ud83e\udd88',  desc: 'Win 15 tricks in one game',           condition: () => stats.tricksWon >= 15, pts: 50 },
    { id: 'streak_3',      name: 'Hot Streak',        icon: '\ud83d\udd25',  desc: '3 consecutive tricks won',            condition: () => stats.bestStreak >= 3, pts: 30 },
    { id: 'streak_5',      name: 'Unstoppable',       icon: '\u26a1',        desc: '5 consecutive tricks won',            condition: () => stats.bestStreak >= 5, pts: 60 },
    { id: 'bid_winner',    name: 'Promise Keeper',    icon: '\ud83e\udd1d',  desc: 'Win a round you bid on',              condition: () => stats.bidsWon >= 1, pts: 20 },
    { id: 'bid_3',         name: 'Reliable',          icon: '\ud83c\udfaf',  desc: 'Win 3 rounds you bid on',             condition: () => stats.bidsWon >= 3, pts: 40 },
    { id: 'little_slam',   name: 'Little Slam',       icon: '\ud83c\udf1f',  desc: 'Achieve a Little Slam (8 tricks)',    condition: () => stats.slamCount >= 1, pts: 75 },
    { id: 'grand_slam',    name: 'Grand Slam',        icon: '\ud83d\udc51',  desc: 'Achieve a Grand Slam (9 tricks)',     condition: () => stats.grandSlamCount >= 1, pts: 150 },
    { id: 'trump_caller',  name: 'Trump Caller',      icon: '\ud83d\udce3',  desc: 'Call trump 3 times',                  condition: () => stats.trumpCalls >= 3, pts: 35 },
    { id: 'round_5',       name: 'Endurance',         icon: '\ud83d\udcaa',  desc: 'Play 5 rounds in a session',          condition: () => stats.roundsPlayed >= 5, pts: 30 },
    { id: 'round_win_3',   name: 'Dominant',          icon: '\ud83c\udfc6',  desc: 'Win 3 rounds',                        condition: () => stats.roundsWon >= 3, pts: 50 },
    { id: 'points_100',    name: 'Centurion',         icon: '\ud83d\udcaf',  desc: 'Earn 100 badge points',               condition: () => stats.points >= 100, pts: 0 },
    { id: 'points_300',    name: 'Legend',             icon: '\ud83c\udf1f',  desc: 'Earn 300 badge points',               condition: () => stats.points >= 300, pts: 0 },
  ];

  let earnedBadges = new Set();
  let onBadgeCallback = null;

  function reset() {
    stats = {
      tricksWon: 0, tricksPlayed: 0,
      roundsWon: 0, roundsPlayed: 0,
      bidsWon: 0, bidsMade: 0,
      slamCount: 0, grandSlamCount: 0,
      currentStreak: 0, bestStreak: 0,
      trumpCalls: 0, points: 0,
    };
    earnedBadges = new Set();
  }

  function onBadgeEarned(cb) {
    onBadgeCallback = cb;
  }

  function checkBadges() {
    for (const badge of BADGES) {
      if (!earnedBadges.has(badge.id) && badge.condition()) {
        earnedBadges.add(badge.id);
        stats.points += badge.pts;
        if (onBadgeCallback) {
          onBadgeCallback(badge);
        }
      }
    }
  }

  // Events called by Game module
  function recordTrickWin(myTeam, winnerTeam) {
    stats.tricksPlayed++;
    if (winnerTeam === myTeam) {
      stats.tricksWon++;
      stats.currentStreak++;
      if (stats.currentStreak > stats.bestStreak) {
        stats.bestStreak = stats.currentStreak;
      }
      stats.points += 2; // 2 pts per trick won
    } else {
      stats.currentStreak = 0;
    }
    checkBadges();
  }

  function recordRoundEnd(myTeam, result) {
    stats.roundsPlayed++;
    const myScore = result.scoreChange[myTeam] || 0;
    if (myScore > 0) {
      stats.roundsWon++;
    }
    if (result.ls && result.biddingTeam === myTeam) {
      stats.slamCount++;
      stats.points += 15;
    }
    if (result.gs && result.biddingTeam === myTeam) {
      stats.grandSlamCount++;
      stats.points += 30;
    }
    checkBadges();
  }

  function recordBidWon(myTeam, biddingTeam, bidMet) {
    if (biddingTeam === myTeam) {
      stats.bidsMade++;
      if (bidMet) {
        stats.bidsWon++;
        stats.points += 5;
      }
    }
    checkBadges();
  }

  function recordTrumpCall() {
    stats.trumpCalls++;
    stats.points += 3;
    checkBadges();
  }

  function getStats() { return { ...stats }; }
  function getEarnedBadges() {
    return BADGES.filter(b => earnedBadges.has(b.id));
  }
  function getAllBadges() { return BADGES; }
  function getPoints() { return stats.points; }

  return {
    reset, onBadgeEarned,
    recordTrickWin, recordRoundEnd, recordBidWon, recordTrumpCall,
    getStats, getEarnedBadges, getAllBadges, getPoints,
  };
})();
