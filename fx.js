// ============================================================
// FX MODULE — 3D Card Animations & Particle Effects
// Pure CSS 3D transforms + lightweight JS — NO Three.js, NO WebGL
// ============================================================

const FX = (() => {
  // Ensure the #fx-layer exists inside .game-table
  function ensureFXLayer() {
    let layer = document.getElementById('fx-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'fx-layer';
      const table = document.querySelector('.game-table');
      if (table) table.appendChild(layer);
    }
    return layer;
  }

  // === DEAL ANIMATION ===
  // Cards fly from center deck to each player position with 3D rotation
  function dealCards(positions) {
    const layer = ensureFXLayer();
    if (!layer) return;

    const suitSymbols = ['♠', '♥', '♦', '♣', '★', '♣'];

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];

      setTimeout(() => {
        const card = document.createElement('div');
        card.className = 'fx-deal-card';

        // Add a suit symbol inside for visual flair
        const inner = document.createElement('div');
        inner.className = 'fx-deal-card-symbol';
        inner.textContent = suitSymbols[i];
        card.appendChild(inner);

        layer.appendChild(card);

        // Force reflow to ensure the start position is applied
        card.offsetHeight;

        // Calculate target transform
        const dx = pos.x - 50;
        const dy = pos.y - 50;

        // Animate to target position
        requestAnimationFrame(() => {
          card.style.transition = 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.45s ease-out';
          card.style.transform = `translate(calc(-50% + ${dx}vw * 0.6), calc(-50% + ${dy}vh * 0.6)) perspective(600px) rotateY(360deg) rotateX(15deg) scale(0.7)`;
          card.style.opacity = '0.3';
        });

        // Cleanup
        setTimeout(() => {
          if (card.parentNode) card.parentNode.removeChild(card);
        }, 600);
      }, i * 100);
    }

    // Full cleanup after all animations
    setTimeout(() => {
      const remaining = layer.querySelectorAll('.fx-deal-card');
      remaining.forEach(c => { if (c.parentNode) c.parentNode.removeChild(c); });
    }, 1200);
  }

  // === CARD PLAY FLY ANIMATION ===
  // When player plays a card, it flies from hand to trick position with 3D tilt
  function cardPlayFly(fromRect, toX, toY, cardHtml) {
    const layer = ensureFXLayer();
    if (!layer) return;

    const table = document.querySelector('.game-table');
    if (!table) return;
    const tableRect = table.getBoundingClientRect();

    // Calculate start position relative to game-table
    const startX = fromRect.left - tableRect.left + fromRect.width / 2;
    const startY = fromRect.top - tableRect.top + fromRect.height / 2;

    // Calculate end position (percentage to pixels)
    const endX = (toX / 100) * tableRect.width;
    const endY = (toY / 100) * tableRect.height;

    // Create flying card
    const flyCard = document.createElement('div');
    flyCard.className = 'fx-card-fly';
    flyCard.innerHTML = `<div class="card-mini" style="pointer-events:none">${cardHtml}</div>`;
    flyCard.style.left = startX + 'px';
    flyCard.style.top = startY + 'px';
    flyCard.style.transform = 'translate(-50%, -50%) perspective(800px) rotateX(0deg) scale(1)';

    layer.appendChild(flyCard);

    // Force reflow
    flyCard.offsetHeight;

    // Animate
    requestAnimationFrame(() => {
      flyCard.style.transition = 'all 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
      flyCard.style.left = endX + 'px';
      flyCard.style.top = endY + 'px';
      flyCard.style.transform = 'translate(-50%, -50%) perspective(800px) rotateX(-15deg) scale(0.75)';
      flyCard.style.opacity = '0.6';
    });

    // Cleanup
    setTimeout(() => {
      if (flyCard.parentNode) flyCard.parentNode.removeChild(flyCard);
    }, 380);
  }

  // === TRICK WIN CELEBRATION ===
  // Particle burst from the trick winner's position
  function trickWinBurst(winnerRelIdx, teamColor) {
    const layer = ensureFXLayer();
    if (!layer) return;

    // Get trick card positions (same as used in UI)
    const trickPositions = [
      { x: 50, y: 62 },  // Me (bottom)
      { x: 35, y: 52 },  // Left
      { x: 35, y: 35 },  // Top-left
      { x: 50, y: 28 },  // Top
      { x: 65, y: 35 },  // Top-right
      { x: 65, y: 52 },  // Right
    ];

    const pos = trickPositions[winnerRelIdx] || trickPositions[0];
    const table = document.querySelector('.game-table');
    if (!table) return;
    const tableRect = table.getBoundingClientRect();

    const cx = (pos.x / 100) * tableRect.width;
    const cy = (pos.y / 100) * tableRect.height;

    const particleCount = 25;
    const suitSymbols = ['♠', '♥', '♦', '♣', '★'];
    const colors = ['#d4a853', '#ffd700', '#ffffff', teamColor || '#58a6ff'];

    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement('div');
      particle.className = 'fx-particle';

      // Randomly choose between circle and suit symbol
      const useSuit = Math.random() > 0.6;
      if (useSuit) {
        particle.textContent = suitSymbols[Math.floor(Math.random() * suitSymbols.length)];
        particle.style.fontSize = (6 + Math.random() * 8) + 'px';
        particle.style.borderRadius = '0';
        particle.style.width = 'auto';
        particle.style.height = 'auto';
        particle.style.background = 'none';
        particle.style.color = colors[Math.floor(Math.random() * colors.length)];
      } else {
        const size = 4 + Math.random() * 6;
        particle.style.width = size + 'px';
        particle.style.height = size + 'px';
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
      }

      particle.style.left = cx + 'px';
      particle.style.top = cy + 'px';
      particle.style.position = 'absolute';
      particle.style.pointerEvents = 'none';
      particle.style.zIndex = '14';

      layer.appendChild(particle);

      // Random velocity
      const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
      const distance = 40 + Math.random() * 100;
      const targetX = cx + Math.cos(angle) * distance;
      const targetY = cy + Math.sin(angle) * distance;
      const duration = 500 + Math.random() * 400;

      // Force reflow
      particle.offsetHeight;

      requestAnimationFrame(() => {
        particle.style.transition = `all ${duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
        particle.style.left = targetX + 'px';
        particle.style.top = targetY + 'px';
        particle.style.opacity = '0';
        particle.style.transform = `scale(0.3) rotate(${Math.random() * 360}deg)`;
      });

      // Cleanup
      setTimeout(() => {
        if (particle.parentNode) particle.parentNode.removeChild(particle);
      }, duration + 50);
    }

    // Screen edge flash
    const flash = document.createElement('div');
    flash.className = 'fx-flash';
    flash.style.background = teamColor || 'rgba(212,168,83,0.15)';
    document.body.appendChild(flash);

    setTimeout(() => {
      if (flash.parentNode) flash.parentNode.removeChild(flash);
    }, 500);
  }

  // === GRAND/LITTLE SLAM CELEBRATION ===
  // Bigger confetti-like celebration
  function slamCelebration() {
    const layer = ensureFXLayer();
    if (!layer) return;

    const table = document.querySelector('.game-table');
    if (!table) return;
    const tableRect = table.getBoundingClientRect();

    const particleCount = 60;
    const colors = ['#d4a853', '#ffd700', '#ffffff', '#ffc107', '#ff9800', '#e0b864'];
    const suitSymbols = ['♠', '♥', '♦', '♣', '★'];

    for (let i = 0; i < particleCount; i++) {
      setTimeout(() => {
        const confetti = document.createElement('div');
        confetti.className = 'fx-confetti';

        // Random start position at top
        const startX = Math.random() * tableRect.width;
        const startY = -10;

        confetti.style.left = startX + 'px';
        confetti.style.top = startY + 'px';
        confetti.style.position = 'absolute';
        confetti.style.pointerEvents = 'none';

        // Random type
        const useSuit = Math.random() > 0.5;
        if (useSuit) {
          confetti.textContent = suitSymbols[Math.floor(Math.random() * suitSymbols.length)];
          confetti.style.fontSize = (8 + Math.random() * 12) + 'px';
          confetti.style.background = 'none';
          confetti.style.color = colors[Math.floor(Math.random() * colors.length)];
          confetti.style.width = 'auto';
          confetti.style.height = 'auto';
        } else {
          const size = 4 + Math.random() * 8;
          confetti.style.width = size + 'px';
          confetti.style.height = size + 'px';
          confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        }

        layer.appendChild(confetti);

        // Force reflow
        confetti.offsetHeight;

        // Animate falling with wobble
        const duration = 1500 + Math.random() * 1000;
        const endX = startX + (Math.random() - 0.5) * 200;
        const endY = tableRect.height + 20;
        const rotation = Math.random() * 720 - 360;

        requestAnimationFrame(() => {
          confetti.style.transition = `all ${duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
          confetti.style.left = endX + 'px';
          confetti.style.top = endY + 'px';
          confetti.style.opacity = '0';
          confetti.style.transform = `rotate(${rotation}deg) scale(0.5)`;
        });

        // Cleanup
        setTimeout(() => {
          if (confetti.parentNode) confetti.parentNode.removeChild(confetti);
        }, duration + 50);
      }, i * 30); // Stagger
    }

    // Screen pulse/flash
    const flash = document.createElement('div');
    flash.className = 'fx-flash';
    flash.style.background = 'rgba(212,168,83,0.2)';
    flash.style.animation = 'fxFlash 0.6s ease-out forwards';
    document.body.appendChild(flash);

    setTimeout(() => {
      if (flash.parentNode) flash.parentNode.removeChild(flash);
    }, 700);

    // Second flash for extra impact
    setTimeout(() => {
      const flash2 = document.createElement('div');
      flash2.className = 'fx-flash';
      flash2.style.background = 'rgba(255,215,0,0.12)';
      flash2.style.animation = 'fxFlash 0.5s ease-out forwards';
      document.body.appendChild(flash2);
      setTimeout(() => {
        if (flash2.parentNode) flash2.parentNode.removeChild(flash2);
      }, 600);
    }, 300);
  }

  return { dealCards, cardPlayFly, trickWinBurst, slamCelebration };
})();
