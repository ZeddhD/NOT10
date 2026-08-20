# NOT10 — Design & Evaluation Document

**Author:** Zawad Ahsan
**Live deployment:** https://not10.onrender.com
**Repository:** this repository (`main` branch)

This document exists alongside `README.md` (player-facing) and
`DEPLOYMENT.md` (ops-facing) to record the *why* behind NOT10's
architecture, the concrete engineering problems it solved, and an honest
account of what has and hasn't been verified. It is written to be read
on its own, without needing to reconstruct reasoning from commit
history.

---

## 1. Overview

NOT10 is a real-time multiplayer betting/card game for 2-4 players,
inspired by a game featured in the anime *Kakegurui*. Each round, players
bet on a hidden hand of cards, the highest bettor earns the right to
choose to play FIRST or LAST, and players then take turns playing cards
face-up onto a shared table total — whoever pushes the total to or past
10 busts and is eliminated from the round; the pot splits among the
survivors, weighted by what they had at risk.

The project is built and deployed with no external services: no
database, no auth provider, no third-party API. Game state lives in
server memory for the lifetime of a room; a deployment restart or a
free-tier host spinning down loses in-progress games, which is an
accepted trade-off for a casual, free, session-based game rather than an
oversight (see §7).

**Scope, for context:** ~9,200 lines across the rules engine, server,
client, and test suite (excluding node_modules and build artifacts) —
engine 1,319 lines, server 890 lines, client 2,579 lines, tests 1,281
lines, markup/styling 3,140 lines. Single runtime dependency (`ws`);
`vitest` for testing. Built solo.

---

## 2. System Architecture

NOT10 is split into three layers with a strict one-way dependency
direction: **engine → server → client** never reversed.

```
engine/          Pure rules engine. No network, no DOM, no timers.
  game.js          Round lifecycle: dealing, betting, position choice,
                   card play, bust detection, weighted pot distribution.
  ai.js            Bot decision-making (betting personalities, card play,
                   position choice) - also drives a disconnected human's
                   seat, see §4.2.
  utils.js         Deck/shuffle, turn-order helpers, formatting.

server/          Thin session/network layer. Owns connections, rooms,
                   reconnection, and timing. Contains no game rules of
                   its own - every rule decision is delegated to engine/.
  rooms.js         RoomManager: WebSocket message routing, room/player
                   lifecycle, the bot/disconnected-player autopilot
                   tick loop, per-connection state broadcast.
  index.html/js    HTTP + WebSocket server bootstrap.

assets/js/       Browser client. Vanilla JS, no framework, no build
                   step. Renders server-pushed state; never computes
                   game outcomes locally.
  app.js           WebSocket message handling, state diffing for UI
                   cues (turn changes, payouts, log entries).
  ui.js            All DOM rendering/manipulation.
  sound.js         Synthesized Web Audio cues (no audio files).
  wsClient.js      Reconnect-with-backoff WebSocket wrapper.
```

**Why this split, specifically:**

- `engine/` being pure (no imports of anything network- or DOM-related)
  is what makes `tests/game.test.js` and `tests/ai.test.js` able to run
  headlessly, in milliseconds, with no server or browser involved. Every
  rule of the game — bust threshold, payout weighting, turn order — is
  verifiable in isolation from the infrastructure that delivers it.
- `server/` is **the single source of truth for game state**. The
  client never decides whether a move is legal; it sends an intent
  (`play_card`, `bet`, `choose_position`) and renders whatever the
  server broadcasts back. This isn't just clean layering — it's the
  actual security boundary (§5).
- The client holds no game logic that matters for fairness. Sound and
  animation timing are the only "local" decisions it makes, and both are
  derived from server-broadcast state, never invented client-side.

---

## 3. Core Game Design & Rationale

Three mechanics were deliberately engineered on top of the base rules,
each solving a specific balance problem rather than being added for
their own sake:

### 3.1 Partial-deal betting
Only half of each player's hand is dealt before betting opens; the rest
is dealt immediately after the highest bettor's FIRST/LAST choice
resolves (`dealRemainingHands`, called from both the normal-resolution
and auto-pilot paths in `server/rooms.js`). This ensures the bet and the
position choice are both made on a real, incomplete signal — not a
fully-known hand — which is what gives the betting phase actual
uncertainty instead of it being a formality.

### 3.2 FIRST payout bonus
Choosing to play LAST gives a structural information advantage (you see
the running total before every one of your turns, all round) with no
offsetting cost. `GAME_CONSTANTS.FIRST_POSITION_BONUS` (1.15×) weights
the FIRST-choosing highest bettor's bet upward *for pot-share purposes
only* — real money at risk is untouched — so FIRST becomes a genuine
risk/reward trade instead of a strictly worse option.

### 3.3 Two-player underdog comeback bonus
At exactly two active players, the wealthier player can always outbid
the sole remaining opponent for highest-bettor status, every round, with
no dilution from a third player the way there is at 3-4. `computeUnderdogFactor`
computes a continuous 0-1 dial from how far behind the trailing player
is (not a threshold, so there's no cliff to hover just above), which
boosts the underdog's *effective* bet weight — both for winning the
position-choice auction and for pot-share — up to fixed maxima. This is
explicitly a drama choice, not a fairness one, and is documented as such
in `GAME_CONSTANTS`: deliberately not applied at 3-4 players, where the
usual dynamics already provide enough variance.

These three were shipped, verified against the existing test suite, and
had the in-app "How to Play" modal and payout-preview UI updated to
describe them accurately — an earlier version of the Strategy Guide had
the FIRST/LAST bonus attribution backwards, caught and corrected during
a full repository audit (see §6).

---

## 4. Concurrency & Real-Time Correctness

This is the section most relevant to evaluating the system as a
distributed/real-time program rather than a CRUD app. Real-time
multiplayer introduces failure modes that don't exist in synchronous,
single-player code, and several were found and fixed with actual
root-cause analysis rather than surface patches. Two representative case
studies:

### 4.1 Premature AI takeover on disconnect
**Symptom** (reported from real multiplayer play, never reproduced in
solo/vs-AI testing): a player's own turn appeared to be taken by the AI,
sandwiched between their real turns, for no apparent reason.

**Root cause:** `server/rooms.js`'s per-room tick loop treated a
disconnected human exactly like a bot the instant `connected` flipped to
`false` — with no grace period at all, unlike the 30-second window
already protecting a lobby seat from being freed too eagerly. A brief
WiFi blip or a backgrounded mobile tab (which most browsers suspend
JS/timers on) would cause the very next 1-second tick to auto-play a
card or bet on the player's behalf, often before they'd even noticed the
drop. This is invisible in solo testing because one machine talking to
its own local server essentially never has a genuine mid-session
disconnect.

**Fix:** a separate `AUTOPILOT_GRACE_MS` (5s) window, distinct from the
existing lobby-seat `DISCONNECT_GRACE_MS` (30s) — long enough to absorb
a normal blip, short enough not to stall the table. An explicit "Leave"
still hands control over immediately, since that player isn't coming
back. Applied to both the bet/card turn loop and the FIRST/LAST
position-choice auto-pick path, which had the identical gap.

**Verification:** a new integration test opens two real WebSocket
connections, drives the game into the playing phase, disconnects the
player on turn, reconnects within the grace window, and asserts the
server did not act on their behalf — `tests/server.test.js`, *"a brief
disconnect mid-turn does not hand the turn to the AI"*.

### 4.2 Card plays before a pending decision resolved
**Root cause:** `transitionToPlaying` flips `room.phase` to `'playing'`
and sets a provisional `turn_player_id` (the first player under the
current seat order) the instant betting closes — even when a highest
bettor still has an outstanding FIRST/LAST decision and every player's
hand is still the partial, pre-choice deal. If that provisional
turn-holder was a player other than the bettor, the server's
`processCardPlay` had no check for a pending decision — only whose turn
it nominally was — so that player really could play a card before the
decision (and the real play order it produces) existed. This broke a
core rule of the game: nobody sees the resulting play order or acts
until the highest bettor's choice is in.

**Fix:** `processCardPlay` now unconditionally rejects any play while
`roundState.awaiting_position_choice` is true, independent of
`turn_player_id`. The client was also given a distinct "waiting for X to
choose" render state for this case, so it doesn't just reject the click
silently — it never looks playable in the first place.

**Verification:** an engine-level unit test reproduces the exact
condition (`turn_player_id` pointing at a non-bettor while
`awaiting_position_choice` is true) and asserts the play is rejected and
`table_total` doesn't move — `tests/game.test.js`.

### 4.3 Other correctness fixes made during a full-repository audit
(Commit `81cef58`, done independent of any specific bug report — a
deliberate pass looking for edge cases outside existing coverage.)

- **Duplicate player objects on retry:** re-sending `join_room` for a
  seat already held (a double-click, a client retry before the first
  response arrived) pushed a second player object sharing the same id —
  every downstream assumption of one object per id (seat order,
  active-player counts, turn order) silently corrupted. Fixed by
  re-attaching the socket instead, mirroring a friendly rejoin.
- **Decorative "ready" toggle:** the host could start a game once merely
  *one* human was ready, sweeping any other unready human into the game
  with no say. Fixed to require every seated human to be ready.
- **AI raise-affordability miscalculation:** compared a bot's money
  against `highestBet + raiseAmount - myCurrentBet` instead of the raise
  increment alone — wrongly downgraded easily affordable raises to calls
  on almost every first raise of a betting lap.
- **Unguarded empty-hand division:** `choosePosition`'s hand-strength
  math would divide by zero on an empty hand — currently unreachable
  given fixed hand sizes, but hardened defensively rather than left as a
  latent crash.

---

## 5. Security Model

- **Server-authoritative hands.** Player hands live only in
  `Room.hands` (server memory) and are never broadcast in full; each
  client's state payload is built per-recipient, including only that
  player's own hand (`_broadcast` in `rooms.js`). The server does not
  send everything and trust the client to hide the rest.
- **Session tokens gate reconnection.** A player id is a client-side
  UUID, not proof of identity — without a secret, server-issued
  `sessionToken` checked on every `rejoin`, anyone who learned another
  player's id could take over their seat, hand, and money mid-game.
- **Per-connection rate limiting** (`RATE_LIMIT_MAX_MESSAGES` in a
  sliding 5s window) bounds how fast a single connection can flood the
  room-tick/broadcast loop, without being tight enough to affect normal
  play.
- **All game-legality checks are server-side and re-derived from
  authoritative state**, never trusted from client-submitted values —
  demonstrated concretely by §4.2, where a UI-only fix would not have
  been sufficient.

---

## 6. Testing Strategy & Results

Three-tier suite, `vitest run`, currently **73 passing tests**:

| File | What it covers | Why this tier |
|---|---|---|
| `tests/game.test.js` (55 tests) | Pure engine rules: dealing, betting, position choice, pot math, edge cases like the §4.2 fix | Headless, runs in ~35ms — the right layer for anything that's a *rule*, not an infrastructure behavior |
| `tests/ai.test.js` (7 tests) | Bot decision-making, including the §4.3 affordability fix | Same reasoning — pure logic, no network needed to catch it |
| `tests/server.test.js` (11 tests) | Real HTTP + WebSocket server, driven by real `ws` client connections: reconnection timing, duplicate-tab handling, the full turn-advancement loop under concurrent connections | These bugs (§4.1, the duplicate-join fix) are only reachable with a real server and real timing — a mocked or headless version of this layer would not have caught them |

Every fix in §4 has a regression test added in the same commit that
fixed it, not as a follow-up. Two smoke-test scripts that predated this
suite (`scripts/smoke-test*.js`) were deleted as fully superseded once
the suite covered the same ground with actual assertions rather than
console output a human had to read.

**What this suite does *not* cover** (see §7): no automated client-side
(browser DOM) tests exist. UI changes in this project have been verified
by manually driving the deployed app in a real (Playwright-controlled,
headless) browser session and inspecting screenshots/DOM state, which is
real verification but not a regression-preventing automated test.

---

## 7. Known Limitations & Future Work

Stated plainly, not minimized:

- **No automated client-side tests.** The single largest asymmetry in
  the project — strong backend/engine discipline, none on the frontend.
  Every UI feature this project has shipped was verified once, by hand
  (or by a one-off scripted browser session), not by a suite that
  re-verifies itself on every future change.
- **No accessibility support.** Confirmed by reading the code, not
  assumed: interactive elements (cards, several controls) are `<div>`s
  with only a `click` handler — no `tabindex`, `role`, or keyboard
  handler, so a keyboard-only user cannot play a card. No `aria-live`
  regions exist for state changes a sighted player gets for free (your
  turn, a bust, a payout). Palette contrast has never been measured
  against WCAG. The one accessibility-relevant behavior that does exist
  — a global `prefers-reduced-motion` override killing all
  animation/transition durations — arrived as a side effect of general
  polish, not a dedicated pass.
- **No persistence.** In-memory-only room state is a deliberate scope
  boundary for a free, casual game, not an oversight — but it does mean
  no match history, no accounts, no stats across sessions.
- **No formal evaluation beyond developer/author testing.** There is no
  user study, no load-testing data, no performance benchmarking under
  concurrent load beyond what the integration test suite exercises.
  "It works" is currently substantiated by a live public deployment and
  hands-on multiplayer play by the author, not by independent
  measurement.
- **Onboarding is a single static "How to Play" modal**, kept accurate
  as mechanics changed, but with no in-context/first-time teaching
  layer. Assessed as low-severity given the game's actual usage pattern
  (played in small groups where a human typically explains the rules),
  not a blocking gap.

---

## 8. Conclusion

NOT10 demonstrates a complete, deployed, real-time multiplayer system
with a deliberately layered architecture, a server-authoritative
security model, and a test suite that has repeatedly caught real
concurrency bugs rather than being written after the fact to pad
coverage numbers. Its most significant remaining gaps — client-side test
automation and accessibility — are identified and scoped above, not
undiscovered.
