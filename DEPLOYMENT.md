# Deployment guide

Nattice runs entirely on free-tier infrastructure. Total cost: **$0/month**.

## Architecture

```
┌─────────────────────────┐
│ Player's browser        │
│ (game.js + network.js)  │
└──────┬──────────────────┘
       │
       ├──── static files ───▶ Vercel (nattice.vercel.app)
       │                        Hobby plan — free forever
       │
       ├──── WebRTC signaling ▶ PeerJS Cloud (0.peerjs.com)
       │                        Free, shared, no signup
       │
       └──── TURN relay ──────▶ OpenRelay (openrelay.metered.ca)
                                Free, ~20 GB/mo shared pool
                                (only used when direct P2P fails)
```

**No database.** Game state lives on the host peer's browser and is
synced to other peers via WebRTC data channels. Host migration
preserves state when the host drops.

## What's free-tier

| Piece                | Provider     | Free tier                                             |
|----------------------|--------------|-------------------------------------------------------|
| Static site          | Vercel Hobby | Unlimited bandwidth, 100 GB build minutes/mo         |
| WebRTC signaling     | PeerJS Cloud | Free, rate-limited (~50 req/s per IP), shared         |
| TURN relay           | OpenRelay    | Free, ~20 GB/mo shared pool, community credentials    |
| STUN                 | Google       | Free, unlimited                                       |

## Deploying to Vercel

```bash
# One-time setup
npm i -g vercel
vercel login

# From the repo root
vercel                 # first deploy (creates project)
vercel --prod          # promote to production
```

Or push to GitHub and connect the repo in the Vercel dashboard — every
push to `main` auto-deploys.

The `vercel.json` in this repo sets:
- Long cache for `*.js` / `*.css` / `/assets/*` (immutable)
- No-cache for `index.html`, `sw.js`, `manifest.json` (so PWA updates land)
- Security headers (X-Frame-Options, Referrer-Policy, Permissions-Policy)

The `.vercelignore` excludes `node_modules/`, `tests/`, and unused
scratch HTML files so builds stay tiny.

## How multiplayer holds up on free tier

### PeerJS Cloud (signaling)

- **Purpose:** helps two browsers find each other and exchange SDP offers.
  Once connected, all game traffic goes browser-to-browser directly.
- **Load:** trivial. Each player sends ~3 small messages during handshake
  and then nothing else. Even 6-player rooms don't move the needle.
- **Failure mode:** occasional 5xx bursts. Our client (`network.js`)
  retries up to 3× with 1.5s + 3s backoff before surfacing the error to
  the player.
- **Upgrade path:** if PeerJS cloud becomes unreliable at scale, host your
  own broker on Render / Fly.io and set `window.NATTICE_CONFIG.peerHost`.
  See "Own broker" below.

### OpenRelay TURN

- **Purpose:** relays WebRTC data when direct P2P fails (symmetric NATs,
  corporate firewalls, some mobile carriers). Roughly 10–20% of players
  need this on any given day.
- **Load:** a card game uses ~1 KB/s per peer when relayed. The 20 GB/mo
  shared pool handles thousands of hours of TURN-fallback play.
- **Failure mode:** if OpenRelay's pool is exhausted, TURN attempts fail
  silently and those specific players can't connect. Direct P2P players
  are unaffected.
- **Upgrade path:** sign up for your own free credentials at
  [metered.ca](https://www.metered.ca/tools/openrelay/) (20 GB/mo, no
  credit card) and replace the `turnServers` array in `index.html`.

## Own broker (only if you need it)

You only need this if PeerJS cloud is dropping enough of your traffic to
be a real problem. For hobby use, don't bother.

1. Deploy `peer` (npm package) to Render / Fly.io / Railway free tier:

   ```js
   // server.js
   const express = require('express');
   const { ExpressPeerServer } = require('peer');
   const http = require('http');
   const app = express();
   app.get('/', (_req, res) => res.json({ status: 'ok' }));
   const server = http.createServer(app);
   const peerServer = ExpressPeerServer(server, { path: '/', proxied: true });
   app.use('/myapp', peerServer);
   server.listen(process.env.PORT || 9000);
   ```

2. In `index.html`, add these fields to `window.NATTICE_CONFIG`:

   ```js
   peerHost: 'your-broker.onrender.com',
   peerPort: 443,
   peerPath: '/myapp',
   peerSecure: true,
   ```

3. **Render note:** free-tier services sleep after 15 min of inactivity
   and take ~30s to wake. You'll want to add a warmup ping in
   `network.js` (`fetch('https://your-broker.onrender.com/')` before
   `new Peer(...)`) or hit UptimeRobot's free tier to ping every 5 min.

## Verifying a deployment

After deploying, test the full multiplayer path:

1. Open `https://your-site.vercel.app/` in two browsers (or one browser +
   one incognito window).
2. In browser A: click "Create room". Copy the room code.
3. In browser B: click "Join room", paste the code.
4. Browser B should appear in browser A's lobby within ~3 seconds.
5. Start the game. Play a hand.

If step 4 fails, check the browser console:
- `[Network] My peer ID: TC_...` — signaling worked.
- `[Network] Peer connected: TC_...` — WebRTC connected.
- If you see `iceConnectionState: failed` — TURN isn't reaching. Verify
  the OpenRelay URLs in `index.html` are reachable
  (`curl -v turn:openrelay.metered.ca:443` should not hang).

## Costs at scale

At what point does this stop being free?

| Concurrent players  | Bottleneck                | What breaks first                          |
|---------------------|---------------------------|--------------------------------------------|
| < 100               | Nothing                   | All free.                                  |
| 100–1,000           | PeerJS cloud rate limits  | Occasional handshake failures.             |
| 1,000+              | TURN bandwidth            | Symmetric-NAT players can't join.          |
| 10,000+             | Static bandwidth          | Vercel Hobby caps at ~100 GB/mo egress.    |

For anything past ~1,000 concurrent players, you'll want your own PeerJS
broker + paid Metered TURN (~$99/mo for 150 GB relay).
