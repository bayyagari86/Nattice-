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

## 4. Host migration

- On host disconnect (unclean), each surviving client runs the same
  deterministic election: lowest-seat human, connected, non-AI wins.
- If elected, the peer calls `Network.promoteToHost()`, rebuilds
  `peerToSeat` / `seatToPeer` from the current state, installs host
  listeners, and broadcasts `HOST_MIGRATED { hostPeerId, state, ... }`.
- Other clients update `currentHostPeerId` and continue.
- The mesh (already established by `PEER_LIST` during onboarding) means
  the new host can talk to everyone without re-signaling.
- 10-second safety timeout: if `HOST_MIGRATED` never arrives, clients
  drop to the title screen instead of hanging.

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

### 3. Network resilience (what's already in this branch)

- **Graceful leave** — clients send a `__BYE__` on `beforeunload`/`pagehide`
  so other peers don't wait for the 12s heartbeat timeout to notice.
- **ICE state monitoring** — `iceconnectionstatechange: failed` / `closed`
  triggers immediate leave detection; `disconnected` waits 3s for recovery.
- **Heartbeat** — 5s ping interval, 12s eviction timeout for silent peers.
- **Idempotent connection setup** — duplicate `open` events (which PeerJS
  fires on some NAT paths) no longer cause double `SEAT_ASSIGNED`.
- **Host migration** — ungraceful host drop triggers deterministic
  election; surviving lowest-seat human takes over.
- **Client reconnect** — disconnected clients retain their seat + hand
  for a rejoin window.

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
