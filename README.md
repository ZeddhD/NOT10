# NOT10 - Multiplayer Card & Betting Game

> **A strategic card game where survival beats ambition. Don't be the one to hit 10!**

NOT10 is a fast-paced multiplayer card and betting game with AI opponents
and an elegant dark-themed interface. The frontend is vanilla HTML/CSS/JS
(no framework, no build step); multiplayer runs on a small self-contained
Node.js WebSocket server with no external database - deploy it and play,
nothing else to configure.

---

## 🎮 Game Overview

NOT10 is a 2-4 player card game that combines poker-style betting with strategic card play. The goal is simple: **avoid being the player who pushes the table total to 10 or above**. Each round features a mandatory betting phase followed by tense card-playing decisions where one wrong move eliminates you from winning the pot.

### 🃏 Core Rules

| Element | Description |
|---------|-------------|
| **Deck** | 40 cards total (10 each of values: 0, 1, 2, 3) |
| **Starting Money** | $1,000 per player |
| **Players** | 2-4 players (human or AI) |
| **Cards Dealt** | 4 cards (3-4 players) or 6 cards (2 players) |
| **Minimum Bet** | $100 (or all-in if less than $100) |
| **Betting** | Incremental add-on betting (+$100, +$200, +$500) with mandatory FINALIZE |
| **Card Play** | Players take turns playing one card; table total increases by card value |
| **Bust Threshold** | Table total ≥10 eliminates the player who reached it |
| **Pot Distribution** | **WEIGHTED**: Proportional to bet amount (big bets = big rewards if you survive) |
| **Play Order Advantage** | **Highest bettor CHOOSES position** (go FIRST or LAST) |
| **Victory Condition** | Last player with money wins the game |

---

## ✨ Key Features

### 🌐 Multiplayer Mode
- **Private Lobbies**: Create unique 6-character room codes to play with friends
- **Real-Time Sync**: A single WebSocket connection per player, server-authoritative state
- **Smart Bot Fill**: Starting with fewer than 4 humans auto-fills the rest with bots
  (1 human → 3 bots, 2 → 2, 3 → 1, 4 → none), personality assigned randomly per seat
- **Reconnect Support**: A dropped connection gets a 30-second grace period before
  anything happens; browser refresh reconnects into the same seat automatically

### 🤖 AI Mode
- **Offline Play**: No internet required - play against AI anytime, no server needed at all
- **3 Personalities**: Face Cautious, Balanced, and Aggressive AI opponents
- **Smart Decisions**: AI uses probability-based strategies for betting and card play

### 🎨 User Experience
- **Dark Theme**: Eye-friendly interface with smooth animations
- **Responsive Design**: Optimized for desktop, tablet, and mobile
- **Spectator Mode**: Bankrupt players can watch the game continue
- **Action Log**: Track all bets, raises, and card plays in real-time

### 🔒 Security & Fair Play
- **Server-authoritative hands**: the server never sends any player's hand to
  anyone but that player - not "hidden by the UI," genuinely never
  transmitted to other clients over the wire
- **Bot control lives entirely server-side** - no client "controls" bots,
  so there's no host-desync failure mode to worry about
- **Disconnected humans are auto-piloted** (using the same AI logic as
  bots) after the grace period expires, so a dropped connection can't
  stall the game for everyone else

---

## 📖 Complete Gameplay Loop

### 1️⃣ **Game Start**
- 1-4 players join a lobby and mark themselves as "Ready"
- Host clicks "Start Game" (works solo too - see Smart Bot Fill above)
- Missing seats auto-fill with AI bots to reach 4 total players
- Each active player receives their starting hand (4 cards, or 6 cards if only 2 players)

### 2️⃣ **Betting Phase** 💰
Every round begins with strategic betting using the incremental system:

#### 📋 **Betting Rules**
```
MANDATORY REQUIREMENTS:
• Minimum bet: $100 (no exceptions unless going all-in)
• Players with less than $100 MUST go all-in (no other options)
• MUST make at least ONE bet action before finalizing
• ALL players must finalize before playing phase begins

Betting Actions:
1. BET: Add money in increments (+$100, +$200, +$500)
   - Add to your current bet total
   - Can bet multiple times before finalizing
   - Build up psychological pressure
   
2. CALL: Match the current highest bet
   - Adds difference to match highest bet
   - Automatically finalizes your bet
   - Cannot bet again after calling
   
3. ALL-IN: Bet all your remaining money
   - Forced option if you have less than $100
   - High-risk, high-reward move
   - Automatically finalizes
   
4. FINALIZE: Lock in your current bet and pass turn
   - Only available AFTER you've made at least one bet action
   - Once finalized, you cannot bet again this round
   - Visual indicator: Green border + "✓ FINALIZED"
```

#### 💡 **Strategic Implications**
- **First Action**: You MUST bet/call/all-in before you can finalize
- **Multiple Bets**: Build your bet across multiple turns to bluff or gauge reactions
- **Timing**: Finalize early to show strength, or late to gather information
- **Forced All-In**: Players below $100 have no choice - creates desperate situations

### 3️⃣ **Playing Phase** 🃏

#### 🎯 **Play Order Advantage: Highest Bettor Chooses Position**

**Game-Changing Rule:** The player who bet the most during betting phase gets to **CHOOSE** their play order position - go **FIRST** or go **LAST**.

**Why This Choice Matters:**
```
Scenario: Table total is 7, you have [2] and [3]

If you choose to GO FIRST:
- Apply pressure early - force others to deal with higher total
- Show confidence (intimidation factor)
- Best when you have LOW cards (0s, 1s)
- Risk: Less information about what's coming

If you choose to GO LAST:
- See all other players' cards first
- Know exact table total before your turn
- Choose [2] or [3] with perfect information
- Best when you have HIGH/RISKY cards (2s, 3s)
```

**Strategic Decision Matrix:**
- **Strong hand (all 0s, 1s)**: Choose FIRST → Put pressure on opponents, look confident
- **Weak hand (2s, 3s)**: Choose LAST → Use information advantage to survive
- **Mixed hand (variety)**: Depends on table dynamics and opponents' behavior
- **Bluff opportunity**: Bet big with weak hand, choose FIRST to fake strength

**Why Choice > Always Last:**
- Adds skill-based decision making
- Rewards players who understand position value
- Creates mind games ("Why did they choose first?")
- More strategic depth than fixed position

#### 🃏 **Standard Turn Order**
The real tension begins:

```
Base Turn Order: Clockwise from starting player
Highest Bettor: Prompted to choose FIRST or LAST position
Modified Order: Adjusted based on choice

On Your Turn:
  1. Select one card from your hand
  2. Card value adds to the TABLE TOTAL
  3. If TABLE TOTAL ≥ 10 → You're ELIMINATED
  4. Next player's turn
```

**Example Round:**
```
Table Total: 0
Player A plays [2] → Total: 2
Player B plays [3] → Total: 5  
Player C plays [1] → Total: 6
Player D plays [3] → Total: 9
Player A plays [2] → Total: 11 → BUSTED! (eliminated)

Player B, C, D continue playing...
Last survivor wins the pot 💰
```

### 4️⃣ **Round End** 🏆

#### 💰 **Weighted Pot Distribution**
Survivors receive pot share **proportional to their bet**:

**Formula:** `Your Share = (Your Bet ÷ Total Survivor Bets) × Pot`

**Example:**
```
Pot: $2,000
Player A bet: $500, survived → Gets (500/1100) × $2,000 = $909
Player B bet: $400, survived → Gets (400/1100) × $2,000 = $727
Player C bet: $200, survived → Gets (200/1100) × $2,000 = $364
Player D bet: $100, BUSTED  → Gets $0

Winner Analysis:
Player A: Bet $500, won $909 = +$409 profit ✅
Player B: Bet $400, won $727 = +$327 profit ✅
Player C: Bet $200, won $364 = +$164 profit ✅
Player D: Bet $100, lost $100 = -$100 loss ❌
```

**Key Insights:**
- Big bets = Big rewards (if you survive)
- Big bets = Big losses (if you bust)
- Small bets = Small rewards (safe but less profit)
- Your profit depends on: your bet, survivors' bets, and pot size

#### 📊 **Other Round End Details**
- **Eliminated Player**: Loses their entire bet
- **Starting Player**: Rotates clockwise (randomly chosen at game start)
- **Pot Reset**: Fully distributed, no remainder carries over
- New round starts (if 2+ players have money)

### 5️⃣ **Game Over** 👑
- Game ends when only 1 player has money remaining
- Winner takes all glory (and virtual cash)
- In multiplayer, the host can hit **Play Again** to reset the same room
  (same code, same human players, fresh $1000 each) for a rematch

---

## 🎯 Strategy Guide

### Betting Phase Tactics

#### 💡 **Core Strategy: Weighted Distribution Changes Everything**

**OLD System (Equal Split):** Always bet minimum
**NEW System (Weighted):** Big bets = big rewards if you survive

#### 🎯 **Optimal Betting Strategies**

1. **Strong Hand Strategy (Multiple 0s, 1s)**
   - **Action**: Bet aggressively ($300-$500)
   - **Goal**: Maximize pot share when you survive
   - **Bonus**: Get last play position advantage
   - **Example**: With [0,0,1,1], bet $500 for huge payoff

2. **Weak Hand Bluff (Multiple 2s, 3s)**
   - **Action**: Bet $200-$300 to secure last position
   - **Goal**: Play last = see others' cards first
   - **Risk**: Bigger loss if you bust
   - **When**: Table likely to go high (many players still in)

3. **Safe Play (Moderate Hand)**
   - **Action**: Bet minimum $100
   - **Goal**: Minimize loss if you bust
   - **Result**: Small profit if you survive
   - **When**: Uncertain about hand strength

4. **Forced All-In (<$100)**
   - **Bluff**: Act confident even with bad hand
   - **Fold**: Others might overbet and bust
   - **Bonus**: If multiple survivors, you get small share

#### ⚡ **Advanced Tactics**

- **First Bet Matters**: You can't finalize until you bet at least once - use this wisely
- **Incremental Building**: Bet +$100, +$100, +$200 across turns to apply gradual pressure
- **Position Bidding**: Bet $300+ just to secure last play position (worth it with 2s and 3s)
- **Pot Building**: With strong hand, bet high early to encourage others to match
- **Low Money Pressure**: Being forced to all-in with <$100 creates desperate bluffing opportunities
- **Survivor Count Math**: Fewer survivors = larger pot share per person

### Card Playing Tactics
- **Early Game** (Total 0-3): Safe to play 2s and 3s
- **Mid Game** (Total 4-6): Play 1s and 2s cautiously  
- **Danger Zone** (Total 7-9): Only play 0s and 1s if possible
- **Last Resort**: Sometimes you must play a card that busts you - try to force others first!

### AI Personality Behaviors
- **Cautious**: 
  - Minimum bets ($100)
  - Finalization: 60-80% chance per turn (randomized)
  - All-in threshold: Only with 85%+ hand strength
  - All-in forced if <$100
  
- **Balanced**: 
  - Moderate bets ($100-$200)
  - Finalization: 40-60% chance per turn (randomized)
  - All-in threshold: 70%+ hand strength
  - Balanced risk-reward decisions
  
- **Aggressive**: 
  - High bets ($200-$500)
  - Finalization: 30-50% chance per turn (randomized)
  - All-in threshold: 50%+ hand strength
  - Frequent bluffing and pressure plays

---

## 🛠️ How This Was Built

### Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **`engine/`** | Pure JavaScript | Game rules - zero network/DOM imports, runs headless in `npm test` |
| **`server/`** | Node.js + [`ws`](https://www.npmjs.com/package/ws) | HTTP + WebSocket server; owns rooms/connections/bots in memory |
| **`assets/` + `index.html`** | Vanilla HTML5, CSS3, ES6+ JS | Browser client - no framework, no build step |
| **Deployment** | Docker (Render/Fly/Railway) | One service, no database, no external accounts |

### Architecture Highlights

**🧩 Three-Layer Split**
- `engine/game.js` is a **pure rules engine**: plain functions over plain
  state objects, mutated in place, returning plain results. It imports
  nothing but its own `engine/utils.js` sibling - no network, no DOM -
  which is what makes `tests/game.test.js` able to run headlessly.
- `server/rooms.js` is the thin session/network layer: it owns rooms,
  WebSocket connections, reconnection, and bot-turn timing, and calls
  into `engine/` for every actual rule. It contains no rules itself.
- `assets/js/app.js` + `ui.js` are the presentation layer: `ui.js` only
  ever renders whatever state it's given; `app.js` wires the WebSocket
  transport (`wsClient.js`) to the UI, and reuses the *same* `engine/`
  module directly (served as a static file, imported via a relative
  path) for the fully offline AI mode - one source of truth for the
  rules, whether you're playing solo offline or connected to a server.

**🖥️ Server-Authoritative State**
- All room/player/hand/round state lives in server memory
  (`server/rooms.js`'s `Room` class) - there is no database.
- Every WebSocket message the server sends is a full, per-recipient
  snapshot (`room`, `players`, `roundState`, and *only your own*
  `yourHand`) - the client never has to reconcile partial updates, and
  never even receives another player's cards to begin with.
- A background sweep (`_reapIdleRooms`) drops rooms that have been
  empty for 2 hours, so a long-running server doesn't accumulate rooms
  forever.

**🤖 Bot & Disconnected-Player Control**
- Bots are controlled entirely by the server (`_tick`, `_autoBet`,
  `_autoPlayCard` in `server/rooms.js`) - there's no "host's browser
  drives the bots" indirection, so there's nothing to desync.
- A disconnected human is treated exactly like a bot for turn purposes
  once their 30-second reconnect grace period expires (same AI
  decision code, `FALLBACK_PERSONALITY = 'cautious'`), so one dropped
  connection can't stall the table for everyone else. Reconnecting
  hands control back immediately.

### Development Principles
- ✅ **No frameworks** - Pure vanilla JavaScript frontend
- ✅ **No frontend build step** - the browser loads ES modules directly, no bundler
- ✅ **One runtime dependency** (`ws`) for the whole server - no framework, no ORM
- ✅ **No external services** - no database, no third-party account, nothing to configure post-deploy
- ✅ **Progressive enhancement** - AI mode needs no server connection at all
- ✅ **Idempotent operations** - safe reconnects and page refreshes

---

## 🚀 Quick Start

**Want to play immediately?**
```bash
npm install
npm start
```
Open `http://localhost:8000`, click "Play vs AI" - no setup, no config file, works instantly.

**Want multiplayer (with friends, or deployed)?**
- Still just `npm start` - multiplayer runs on the same server, same command.
- See [DEPLOYMENT.md](DEPLOYMENT.md) for deploying it publicly.

---

## 📁 Project Structure

```
NOT10/
├── index.html                 # Main HTML (all game screens)
├── README.md                  # This file - features & gameplay
├── DEPLOYMENT.md              # Deployment guide
├── package.json                # `ws` (runtime) + vitest (dev/test)
├── Dockerfile                   # Single-stage: no build step needed
├── .dockerignore
├── render.yaml                  # Declarative Render (Docker web service) deploy config
│
├── engine/                     # Pure rules engine - no network/DOM
│   ├── game.js                 # Betting, card play, bust detection, pot distribution
│   ├── ai.js                    # AI personalities (bots + auto-piloted disconnects)
│   └── utils.js                 # Deck/shuffle/turn-order helpers
│
├── server/                     # Thin network/session layer
│   ├── index.js                 # HTTP static file server + /healthz + WebSocket upgrade
│   └── rooms.js                  # In-memory RoomManager: rooms, reconnection, bot control
│
├── assets/
│   ├── css/
│   │   └── styles.css         # Complete styling + design rules (top comment)
│   │
│   └── js/
│       ├── app.js             # Controller: routing, UI wiring, WS message handling
│       ├── ui.js              # UI rendering functions (pure presentation)
│       ├── wsClient.js         # WebSocket transport (connect/reconnect/send)
│       └── storage.js         # LocalStorage utilities (player id, session)
│
├── tests/
│   └── game.test.js           # Headless unit tests for engine/game.js
│
└── scripts/
    ├── smoke-test.js            # Live WebSocket check: solo game, bot-fill, full round
    └── smoke-test-2p.js         # Live check: 2-human bot-fill count + reconnection
```

---

## 🔧 Key Technical Implementation

### Game Logic (`engine/game.js`)
```javascript
startNewRound()       // Initialize round, deal cards, set starting player
processBet()          // Handle bets, calls, all-ins, and finalizations
processCardPlay()     // Process card plays, check bust condition
endRound()            // Weighted pot distribution, rotate starting player
isBettingComplete()   // Check if all active players have finalized
transitionToPlaying() // Move from betting to playing phase
applyPositionChoice() // Apply the highest bettor's first/last choice
checkGameOver()        // Only one player left with money?
```
Every function above is pure and synchronous - it mutates the room/player
objects it's given and returns a plain result. It never touches the
network.

### Server / Session Layer (`server/rooms.js`)
```javascript
class RoomManager {
  handleMessage(ws, raw)     // Dispatches every client message by type
  handleDisconnect(ws)       // Starts the 30s reconnect grace period
  _startGame(ws)              // Bot auto-fill (randomized personalities), starts round 1
  _advanceBetting(room, id)   // Next player's turn, or transition to playing
  _endRound(room, id)          // Pot distribution, game-over check, next round
  _tick(room)                  // Per-room heartbeat: bot / disconnected-human autoplay
  _broadcast(room)             // Per-recipient state - only your own hand, ever
}
```

### AI System (`engine/ai.js`)
```javascript
AIPlayer class       // AI player with personality, hand, money
chooseBetAction()    // Betting decisions based on personality
shouldFinalizeBet()  // Decide when to finalize bet
chooseCard()         // Card selection logic (avoid busting)
executeAIBet()       // Execute AI betting with delay and smart all-in decisions
executeAICardPlay()  // Execute AI card play with delay
choosePosition()     // First/last position choice based on hand strength
```
Used identically by offline AI mode (in-browser) and by the server's bot
control - one implementation, no drift between the two.

### WebSocket Transport (`assets/js/wsClient.js`)
```javascript
connect(onMessage, onOpen)  // Opens the socket, auto-reconnects with backoff
send(payload)                 // Sends (or queues, if mid-reconnect) a message
```

### UI Rendering (`ui.js`)
```javascript
renderSeats()        // Show players in lobby
renderGameTable()    // Display player panels with finalized indicators
renderHand()         // Show player's cards
updatePlayerBets()   // Update bet displays
showPlayedCard()     // Show played card next to player panel
addLogEntry()        // Add action to game log
showGameOver()       // Display winner & final standings
```

---

## 🧪 Testing

`engine/game.js` is a pure rules engine - no network, no storage, no DOM -
so it has a headless unit test suite that runs in milliseconds:

```bash
npm install
npm test
```

`tests/game.test.js` covers deck/shuffle integrity, every betting action
(bet/call/all-in/finalize) including its failure paths, bust detection,
weighted pot distribution and its rounding-remainder handling, game-over
detection, and position-choice turn ordering.

For anything that depends on timing, concurrency, or the actual network
protocol - which a unit test can't see - there are throwaway, scripted
live checks against a running server:

```bash
npm start                       # in one terminal
node scripts/smoke-test.js      # in another: solo game, 3-bot fill, full round
node scripts/smoke-test-2p.js   # 2-human bot-fill count + mid-game reconnect
```

**What this does NOT verify** (the honest gap, updated as it changes):
- Anything purely visual/client-side in `ui.js` or `styles.css` - the
  card animations, position-choice screen, spectator view, etc. have
  only been checked by reading the code, not by opening a browser.
- Long-running stability - the smoke tests exercise one room for one or
  two rounds; they don't prove behavior under many concurrent rooms or
  over hours of uptime.
- The `Room` class's behavior under truly pathological timing (e.g. a
  player disconnecting at the exact moment their grace-period timer
  would have fired) - plausible edge cases exist that neither the unit
  tests nor the smoke tests specifically target.

A clean `npm test` run means the rules are correct in isolation; the
smoke tests mean the protocol and bot/reconnect timing work in the
scenarios they actually exercise - neither is a substitute for someone
playing a real multi-tab game before a game night that matters.

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| **Blank page / can't connect** | Make sure you're visiting the server's URL (e.g. `http://localhost:8000`), not opening `index.html` directly - the game needs to reach `/ws` on the same origin |
| **"Connection lost" toast** | The server isn't reachable - check it's actually running / check deploy logs. The client retries automatically once it's back |
| **Can't reconnect after refresh** | localStorage must be enabled; the room must still exist server-side (see "no database" in DEPLOYMENT.md - a host restart/redeploy drops in-progress rooms) |
| **Players can't join** | Room code is case-insensitive but must be the full 6 characters; room must still be in the lobby (not already started) |
| **Bots not acting** | Check the server's logs/console for errors in `server/rooms.js`'s turn loop |

---

## 🔐 Security Considerations

### What's actually enforced
- **Hands are never sent to anyone but their owner.** This isn't a UI
  convention the client is trusted to respect - the server (`_broadcast`
  in `server/rooms.js`) only ever includes `yourHand` for the specific
  connection it's sending to. There is no message a malicious client can
  send that returns another player's cards, because the server never
  holds them anywhere the response-building code can reach across
  players.
- **Turn/phase/action validation** happens in `engine/game.js` on every
  message (wrong turn, wrong phase, insufficient funds, invalid bet
  amount, etc. are all rejected server-side), not just hidden by
  disabling buttons in the UI.

### Limitations
- There's no authentication - a player's identity is just whatever
  `player_id` their browser has in localStorage. Anyone with your room
  code can join if a seat is open; treat codes like a house key, share
  them only with people you intend to play with.
- No persistence - a server restart or redeploy loses all in-progress
  games (see DEPLOYMENT.md). Fine for casual play, not for anything
  where losing a game mid-way would be a real problem.
- Best for casual play with trusted friends, same as before.

---

## 🎨 Customization

### Change Theme Colors
Edit CSS variables in `assets/css/styles.css` (see the design-rules
comment at the top of the file for what each color is allowed to mean):
```css
:root {
    --bg-dark: #0a0e1a;
    --bg-medium: #1a1f35;
    --accent: #00d9ff;
    --success: #00ff88;
    --danger: #ff0055;
}
```

### Adjust Game Rules
Edit constants in `engine/game.js` (this single file is shared by both
offline AI mode and the multiplayer server, so a change here applies
everywhere):
```javascript
export const GAME_CONSTANTS = {
    STARTING_MONEY: 100000,    // $1000
    BUST_THRESHOLD: 10,        // Change bust limit
    RAISE_AMOUNTS: [10000, 20000, 50000] // Bet increments
};
```

### Modify AI Behavior
Adjust AI personalities in `engine/ai.js`:
- Change betting thresholds
- Modify card selection logic
- Add new personality types (also update `BOT_PERSONALITIES` in
  `server/rooms.js` if you want the new type available for auto-fill)

---

## 🌟 Future Enhancement Ideas

- [ ] Tournaments with bracket system
- [ ] Player statistics tracking
- [ ] Achievements and badges
- [ ] Sound effects and music
- [ ] Chat system
- [ ] Replay system
- [ ] Custom deck designs
- [ ] Animated card dealing
- [ ] Leaderboards
- [ ] Optional persistence (so a restart doesn't drop in-progress games)

---

## 📄 License

MIT License - Feel free to use, modify, and distribute.

## 🙏 Acknowledgments

Created as a demonstration of:
- A pure-logic-core / thin-network-layer / dumb-presentation-layer split
- Self-contained, database-free multiplayer game servers
- Vanilla JavaScript capabilities without frameworks
- Clean, maintainable code architecture

---

**Enjoy playing NOT10! 🎮**

For deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md)
