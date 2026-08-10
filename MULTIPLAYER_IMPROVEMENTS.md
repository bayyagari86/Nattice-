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
