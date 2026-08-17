# NOT10 - Deployment Guide

> **NOT10 is a self-contained Node.js server - no external database, no
> account setup, no config file. Push the repo, deploy, play.**

This guide covers running NOT10 locally and deploying it.

---

## Stack

- **`engine/`** - pure JavaScript game rules (deck, betting, bust
  detection, pot distribution, AI personalities). Zero network/DOM
  imports; runs headless in `npm test`.
- **`server/`** - a plain Node.js HTTP + WebSocket server
  (`server/index.js`, `server/rooms.js`). Owns rooms, connections,
  reconnection, and bot control, entirely in memory. Calls into `engine/`
  for all game rules and contains none of them itself.
- **`assets/` + `index.html`** - the browser client (vanilla JS, no
  framework, no build step). Served as static files by the same Node
  process that runs the WebSocket endpoint - one service, one URL, one
  deploy.

There is no database. Room/player/hand state lives in the server
process's memory for as long as the room is active, and is swept away
automatically once it's been idle for 2 hours (`server/rooms.js`'s
`_reapIdleRooms`). This means a server restart drops any in-progress
games - acceptable for a casual card game, not something to build a
tournament platform on without adding persistence.

---

## Run Locally

```bash
npm install
npm start
```

Then open `http://localhost:8000`. That's it - the same process serves
the page and the WebSocket endpoint, so there's nothing else to run and
no separate frontend dev server.

For development with auto-restart on file changes:

```bash
npm run dev
```

### Play with others on your network

Find your machine's LAN IP (`ipconfig` on Windows, `ifconfig`/`ip a` on
Mac/Linux), then have other players on the same WiFi visit
`http://<your-ip>:8000`.

### Run the tests

```bash
npm test
```

Headless engine tests (`tests/game.test.js`, Vitest) - no server, no
browser, no network. See README's Testing section for what this does and
doesn't cover, and `scripts/smoke-test.js` / `scripts/smoke-test-2p.js`
for the live, scripted checks that exercise the parts a unit test can't
(reconnection, bot timing, the full WebSocket protocol) - run those
against a locally running server (`npm start` in one terminal,
`node scripts/smoke-test.js` in another).

---

## Deploy (Free Tier)

This repo includes a `Dockerfile` and `render.yaml` for
[Render](https://render.com) - no credit card required on the free tier.

1. Push this repo to GitHub.
2. In the Render dashboard: **New → Blueprint**, point it at the repo.
   Render reads `render.yaml` and provisions the service automatically.
   (Or: **New → Web Service**, environment = Docker, and it'll pick up
   the `Dockerfile` directly.)
3. Wait for the build (~1-2 min: just `npm ci`, no frontend build step).
   Render gives you a `https://<name>.onrender.com` URL - that's what
   players open.
4. Free tier spins down after 15 minutes idle and takes ~30-60s to wake
   back up on the next request. Fine for a game night; not for
   always-on use. (Waking up loses any in-memory rooms, same as a
   restart - see "no database" above.)

Fly.io and Railway also work with the same `Dockerfile` if you'd rather
use one of those - both read a `Dockerfile` directly with no extra config
needed, and both respect the `$PORT` environment variable the same way
Render does (`server/index.js` reads `process.env.PORT`).

### Nothing else to configure

There's no `config.js`, no database URL, no API keys, no account to
create beyond your Render/Fly/Railway login. If a deploy fails, it's a
Node/Docker problem, not a "did I paste the right credentials" problem -
check the platform's build logs first.

---

## Testing Your Deployment

- [ ] Visit the deployed URL - menu screen loads
- [ ] "Play vs AI" works (this never touches the server's room logic)
- [ ] Create a lobby, note the room code
- [ ] Open the URL in a second tab/incognito window, join with the code
- [ ] Both mark ready, host starts - game begins
- [ ] Try solo: create a lobby, ready up alone, start - 3 bots should
      auto-fill and the game should play itself if you don't act
- [ ] Refresh the tab mid-game - you should reconnect into the same seat
      within a couple seconds, not get bounced to the menu
- [ ] Play a full round to a bust - pot distributes, next round starts

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Blank page / "Cannot GET /" | Make sure you're hitting the Node server's URL/port, not opening `index.html` directly via `file://` - the WebSocket client needs to reach `/ws` on the same origin |
| "Connection lost" toast that never clears | Check the server is actually running / hasn't crashed - check platform logs. `wsClient.js` retries with backoff automatically once the server is back |
| Bots never act | Check server logs for errors in the "Turn loop" - see `server/rooms.js::_tick` |
| Room not found after a deploy | Free-tier host spun down and lost in-memory state (see "no database" above) - this is expected, not a bug |
| Reconnect doesn't restore my hand | Reconnect uses the `player_id` stored in `localStorage` (`assets/js/storage.js`) - clearing browser storage or switching browsers loses that identity |

---

**Happy deploying!**
