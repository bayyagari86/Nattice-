// ============================================================
// CRYPTO MODULE — AES-256-GCM Encryption + Secure Card Shuffle
// ============================================================

const GameCrypto = (() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Generate a random AES-256 key
  async function generateKey() {
    return await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // Export key to base64
  async function exportKey(key) {
    const raw = await crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(raw)));
  }

  // Import key from base64
  async function importKey(b64) {
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  }

  // Encrypt a string with AES-256-GCM
  async function encrypt(plaintext, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(plaintext)
    );
    const combined = new Uint8Array(12 + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), 12);
    return btoa(String.fromCharCode(...combined));
  }

  // Decrypt an AES-256-GCM encrypted string
  async function decrypt(ciphertextB64, key) {
    const combined = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return decoder.decode(plaintext);
  }

  // Derive a shared room key from a passphrase
  async function deriveRoomKey(passphrase, salt) {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode(salt),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // Cryptographically secure Fisher-Yates shuffle
  function secureShuffleDeck(deck) {
    const arr = [...deck];
    for (let i = arr.length - 1; i > 0; i--) {
      const randomValues = new Uint32Array(1);
      crypto.getRandomValues(randomValues);
      const j = randomValues[0] % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Generate a commitment hash for a deck order (to prove fairness)
  async function commitDeck(deckOrder, nonce) {
    const data = encoder.encode(JSON.stringify(deckOrder) + nonce);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)));
  }

  // Verify a commitment
  async function verifyCommitment(deckOrder, nonce, commitment) {
    const computed = await commitDeck(deckOrder, nonce);
    return computed === commitment;
  }

  // Generate a random room code
  function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const rng = new Uint8Array(6);
    crypto.getRandomValues(rng);
    for (let i = 0; i < 6; i++) {
      code += chars[rng[i] % chars.length];
    }
    return code;
  }

  // Generate a unique player ID
  function generatePlayerId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  return {
    generateKey, exportKey, importKey,
    encrypt, decrypt, deriveRoomKey,
    secureShuffleDeck, commitDeck, verifyCommitment,
    generateRoomCode, generatePlayerId,
  };
})();
