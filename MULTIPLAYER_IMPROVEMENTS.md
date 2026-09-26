# Multiplayer Improvements

This branch (`multiplayer-improvements`) hardens the WebRTC multiplayer layer.

## 1. Reconnect + rejoin fixes

- **Hand restoration on rejoin** — `handleRejoinRequest` used to call
  `disconnectedPlayers.delete(playerId)` *before* reading `dcInfo.hand`,
  which meant a reconnecting player always came back to an empty hand.
  We now read `dcInfo` first, restore the hand, then delete the record.
- **Client → host addressing** — clients used to derive the host peer as
  `seatToPeer.get(0)`, which breaks if the host isn't in seat 0 (and always
  breaks after host migration). Introduced `getHostPeerId()` that prefers
  the authoritative `hostPeerId` sent by the host during handshake.
- Host now includes its own `hostPeerId` in every `SEAT_ASSIGNED`, and
  the client records it as `currentHostPeerId`.

## 2. State-sync anti-race

State updates and `CARD_PLAYED` messages used to interleave without
ordering guarantees, causing phantom cards / stuck hands.

- Host stamps every `broadcastState()` with a monotonic `state.version`.
  Clients ignore `STATE_UPDATE` whose version is `<= lastAppliedStateVersion`.
- `CARD_PLAYED` carries a per-play `seq` number. Clients dedupe on
  `(seat, cardId, seq)` before removing from a hand.
- `DEAL_ALL` resets the version window and clears the played-card set.

## 3. Lobby / timers UX

- **Deadline-based countdowns.** `state.currentRound.raiseDeadline` and
  `state.currentRound.turnDeadline` are broadcast in state so *every*
  client renders a live countdown \u2014 no host \u2192 client tick messages.
- Raise dialog shows a live "Raise Discussion (Ns)" counter that turns
  red under 5 seconds.
- The turn indicator ("\u23f1 Ns") appears next to the "X is playing..."
  text for everyone except the acting player.
- Lobby now shows `humanCount/6 players joined` and a **Start Now**
  button (disabled below 2 players) that fills the remaining seats
  with bots \u2014 no more waiting to hit exactly 6.
- Per-seat **connection indicator** (\u2713 Connected / Disconnected \u2013 bot playing).
- Per-seat **kick button**, host-only. Kicked peers receive `KICKED`
  and are dropped from the reconnect table.

## 4. Host migration (protocol v2)

Every authority message carries a **host term** (`_t`). The term only goes
up, and the highest term wins:

- **Election.** When the host vanishes, each survivor picks the
  lowest-seat connected human. If that player doesn't take over within 8s
  it's excluded and the next one is tried. A player who has lost *all*
  connections assumes it is the one that dropped and reconnects instead
  of promoting itself.
- **Promotion.** The new host bumps the term, registers the alias
  `TC_<room>_<term>` so newcomers and rejoiners can find it, and asks every
  client for its hand (4s window; player actions are buffered meanwhile).
- **Hand recovery.** `Engine.recoverHands` rebuilds a consistent deal from
  the reported hands plus the unseen rest of the deck, honouring observed
  voids (a seat that didn't follow suit gets none of that suit). Only the
  departed host's and bots' hands are re-dealt; they were never visible to
  anyone. Anyone whose hand changed receives `DEAL_HAND`.
- **Resume.** Play picks up from the exact phase: bidding, trump select,
  mid-trick, raise window, round end.
- **Split brain.** A host that sees a higher term steps down and rejoins.
  Two hosts with the same term: the lower seat keeps it. Clients reject
  lower-term authority with `STALE_TERM`, which makes a stale host check
  itself. A host that comes back from the background probes for newer
  terms right away and every 15s after that.

## 5. Identity, rejoin, and privacy

- Each player gets a random 256-bit **seat secret**. The host stores only
  its SHA-256. Rejoin needs the secret, so nobody can take another seat by
  sending that player's id.
- The session (`room`, `playerId`, `secret`, `seat`, `term`, known peers) is
  saved in `localStorage` for 3h. A refresh or crash offers **Rejoin game**;
  if the session is under 10 minutes old, it rejoins automatically.
- Rejoin keeps trying, with backoff, for up to 2 minutes behind a
  "Reconnecting…" banner. It finds the room at the current host's alias,
  not just the original room ID.
- **Private deal.** Each player receives only their own hand (the old
  `DEAL_ALL` sent all six to everyone). Opponents' card backs come from
  `handCounts`.
- **Rejected plays roll back.** A client plays optimistically. If the host
  refuses the card, `PLAY_REJECTED` returns it to the hand.
- A host refresh no longer ends the game. It triggers migration, and the
  old host rejoins as a player. Only `Game.leaveGame()` ends the room on purpose (the UI has no Leave button yet).

## 6. Transport (network.js)

- **Ordered delivery.** Encrypt/send and receive/decrypt each run through
  a serial queue. Before this, async AES could reorder messages.
- **Heartbeat for every role.** 5s ping, 12s eviction. If the tab was
  suspended (a timer gap over 10s), liveness resets instead of evicting
  everyone.
- **Signaling never gives up.** It reconnects to the broker with backoff
  capped at 30s.
- **Duplicate connections** (both sides dial at once) are resolved
  deterministically: the channel dialed by the smaller peer id wins.
- **Version skew.** `PROTOCOL_VERSION` is checked on join. The service
  worker fetches the app shell network-first, so players are not stuck on
  mixed versions.

## Production configuration

### 1. TURN server (recommended)

Without TURN, ~10–20% of players on symmetric NATs (some corporate,
mobile, and hotel networks) cannot connect over WebRTC. Add TURN in
`index.html`:

```html
<script>
  window.NATTICE_CONFIG = {
    turnServers: [
      { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' },
      { urls: 'turn:turn.example.com:443?transport=tcp', username: 'user', credential: 'pass' },
    ],
  };
</script>
```

**Free/cheap TURN providers:**
- **Metered.ca** — 50 GB/month free tier, dashboard-generated credentials.
- **Twilio Network Traversal** — pay-as-you-go (~$0.40/GB), first ~3GB/month free.
- **Self-host coturn** on a $5 VPS. See `https://github.com/coturn/coturn`.

A card game uses ~1 KB/s per peer relayed, so even 50 GB/month covers
thousands of hours of TURN-fallback play. Direct P2P connections (the
common case) don't consume TURN bandwidth at all.

### 2. Own PeerJS broker (optional)

PeerJS cloud (`0.peerjs.com`) is free but shared and occasionally goes
down. For production, run your own with the `peer` npm package:

```js
// server.js
const { PeerServer } = require('peer');
PeerServer({ port: 9000, path: '/' });
```

Deploy to any Node host (Fly.io, Railway, a VPS). Then in `index.html`:

```html
<script>
  window.NATTICE_CONFIG = {
    peerHost: 'peer.example.com',
    peerPort: 443,
    peerPath: '/',
    peerSecure: true,  // requires TLS termination in front of the broker
  };
</script>
```

### 3. Network resilience

See sections 4–6 above.

## Tests

| Command | What it covers |
|---|---|
| `npm test` | jsdom unit tests: lobby/UI, protocol invariants, `Engine.recoverHands` (random mid-round deals, voids, invalid or duplicate claims), seat-secret hashing, large-payload encryption |
| `npm run test:e2e:smoke` | 2 tabs: join, start, host crash leads to promotion |
| `npm run test:e2e:resilience` | 3 isolated browser contexts plus 3 bots with autoplayers. Covers: forged rejoin refused; host killed mid-trick (one new host, higher term, hands match the host's copy, round finishes); client refresh (same seat, same hand, no host change); host frozen 25s (other player takes over, woken host steps down, one host) |
| `npm run test:e2e` | both E2E suites |

**What these tests cannot prove.** Everything runs on one machine over
loopback with a local PeerJS broker. They do not exercise:

- real NATs or TURN relays
- packet loss, jitter, or cellular handoffs
- the public PeerJS cloud's rate limits
- mobile OSes that kill background tabs

The "freeze" is simulated: traffic is dropped and `visibilitychange` is
faked. A crash here is detected in milliseconds because the browser closes
the channel. On a real network drop, detection relies on the 12s heartbeat.
Real-internet confidence still needs a manual session on phones across
different networks. See DEPLOYMENT.md.

## Testing suggestions

- `multi-room-test.html` and `load-test.html` still apply. Recommended
  extra manual scenarios:
  1. Join 3 clients, kill the host's tab \u2014 seat-1 client should
     announce "You are now the host" and the game should keep playing.
  2. Join a client, disconnect it mid-round, rejoin \u2014 the same hand
     should be restored.
  3. Play a card at exactly the moment a `STATE_UPDATE` arrives \u2014
     the client console should log at least one dropped stale update
     rather than a phantom card.
