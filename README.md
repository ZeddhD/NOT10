# NOT10 - Multiplayer Card & Betting Game

> **A strategic card game where survival beats ambition. Don't be the one to hit 10!**

NOT10 is a fast-paced multiplayer card and betting game built entirely with vanilla JavaScript, featuring real-time synchronization, AI opponents, and an elegant dark-themed interface. Created as a demonstration of modern web development without frameworks or build tools.

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
- **Private Lobbies**: Create unique 4-character room codes to play with friends
- **Real-Time Sync**: Powered by Supabase Realtime for instant game state updates
- **Smart Bot Fill**: When starting with 2-3 humans, AI bots automatically fill remaining seats
- **Reconnect Support**: Browser refresh/reload automatically rejoins your game

### 🤖 AI Mode  
- **Offline Play**: No internet required - play against AI anytime
- **3 Personalities**: Face Cautious, Balanced, and Aggressive AI opponents
- **Smart Decisions**: AI uses probability-based strategies for betting and card play

### 🎨 User Experience
- **Dark Theme**: Eye-friendly interface with smooth animations
- **Responsive Design**: Optimized for desktop, tablet, and mobile
- **Spectator Mode**: Bankrupt players can watch the game continue
- **Action Log**: Track all bets, raises, and card plays in real-time

### 🔒 Security & Fair Play
- **Row Level Security**: Server-side policies prevent players from seeing others' cards
- **Anti-Cheat**: Hand cards stored securely in database, only accessible to card owner
- **Host-Controlled Bots**: Bot actions run on host client to prevent desync issues

### 🔒 Security & Fair Play
- **Row Level Security**: Server-side policies prevent players from seeing others' cards
- **Anti-Cheat**: Hand cards stored securely in database, only accessible to card owner
- **Host-Controlled Bots**: Bot actions run on host client to prevent desync issues

---

## 📖 Complete Gameplay Loop

### 1️⃣ **Game Start**
- 2-4 players join a lobby and mark themselves as "Ready"
- Host clicks "Start Game"
- If fewer than 4 humans, AI bots auto-fill empty seats
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
- **Cautious Carl**: 
  - Minimum bets ($100)
  - Finalization: 60-80% chance per turn (randomized)
  - All-in threshold: Only with 85%+ hand strength
  - All-in forced if <$100
  
- **Balanced Betty**: 
  - Moderate bets ($100-$200)
  - Finalization: 40-60% chance per turn (randomized)
  - All-in threshold: 70%+ hand strength
  - Balanced risk-reward decisions
  
- **Aggressive Alex**: 
  - High bets ($200-$500)
  - Finalization: 30-50% chance per turn (randomized)
  - All-in threshold: 50%+ hand strength
  - Frequent bluffing and pressure plays

---

## 🛠️ How This Was Built

NOT10 was created to demonstrate **modern vanilla JavaScript** capabilities without relying on frameworks or build tools.

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Vanilla HTML5, CSS3, ES6+ JavaScript | UI and game logic |
| **Backend** | Supabase (PostgreSQL + Realtime) | Database and real-time sync |
| **Deployment** | Static hosting (GitHub Pages, Vercel, Netlify) | Zero-server deployment |

### Architecture Highlights

**🎨 Client-Side Only**
- No build process - runs directly in browser
- ES6 modules for clean code organization
- Hash-based routing for screen navigation

**🗄️ Database Design**
```sql
rooms          -- Game lobbies
players        -- Player states (includes is_bot flag)
round_state    -- Current round data (bets, deck, logs)
hand_cards     -- Secure per-player card storage
actions        -- Event log for game history
```

**⚡ Real-Time Subscriptions**
- Room updates → Trigger game state refresh
- Player joins/leaves → Update lobby
- Round state changes → Sync all clients
- Hand card updates → Update player's private hand

**🤖 Bot Auto-Fill System**
- Deterministic bot IDs prevent duplicates on reconnect
- Host-only execution eliminates race conditions
- Reuses offline AI logic for multiplayer bots
- Cards stored in database like human players

### Development Principles
- ✅ **No frameworks** - Pure vanilla JavaScript
- ✅ **No build tools** - No webpack, no bundlers
- ✅ **No NPM dependencies** - Supabase loaded via CDN
- ✅ **Progressive enhancement** - Works offline (AI mode) without backend
- ✅ **Idempotent operations** - Safe reconnects and page refreshes

---

## 🚀 Quick Start

**Want to play immediately?**
1. Open `index.html` in your browser
2. Click "Play vs AI"
3. Start playing! (No setup required for AI mode)

**Want multiplayer?**
- See [DEPLOYMENT.md](DEPLOYMENT.md) for step-by-step setup instructions

**Want multiplayer?**
- See [DEPLOYMENT.md](DEPLOYMENT.md) for step-by-step setup instructions

---

## 📁 Project Structure

```
NOT10/
├── index.html                 # Main HTML (all game screens)
├── README.md                  # This file - features & gameplay
├── DEPLOYMENT.md              # Step-by-step deployment guide
├── .gitignore                 # Git ignore patterns
│
├── assets/
│   ├── css/
│   │   └── styles.css         # Complete styling (1000+ lines)
│   │
│   └── js/
│       ├── app.js             # Main controller & routing (1200+ lines)
│       ├── ui.js              # UI rendering functions (650+ lines)
│       ├── game.js            # Game logic & rules (550+ lines)
│       ├── ai.js              # AI opponent logic (370+ lines)
│       ├── supabaseClient.js  # Database operations (600+ lines)
│       ├── storage.js         # LocalStorage utilities (100+ lines)
│       ├── utils.js           # Helper functions (300+ lines)
│       ├── config.example.js  # Config template (copy to config.js)
│       └── config.js          # Your Supabase credentials (gitignored)
│
└── supabase/
    ├── schema.sql             # Database table definitions
    └── rls.sql                # Row-Level Security policies
```

---

## 🔧 Key Technical Implementation

### Game Logic (`game.js`)
```javascript
startNewRound()      // Initialize round, deal cards, set starting player
processBet()         // Handle bets, calls, all-ins, and finalizations
processCardPlay()    // Process card plays, check bust condition
endRound()           // Award pot to winner, check game over
getGameState()       // Get current state for AI/UI
isBettingComplete()  // Check if all players have finalized
transitionToPlaying()// Move from betting to playing phase
```

### AI System (`ai.js`)
```javascript
AIPlayer class       // AI player with personality, hand, money
chooseBetAction()    // Betting decisions based on personality
shouldFinalizeBet()  // Decide when to finalize bet
chooseCard()         // Card selection logic (avoid busting)
executeAIBet()       // Execute AI betting with delay and smart all-in decisions
executeAICardPlay()  // Execute AI card play with delay
```

### Multiplayer Sync (`supabaseClient.js`)
```javascript
// Room management
createRoom()         // Create new lobby
getRoom()            // Fetch room data
updateRoom()         // Update room state

// Player operations  
createPlayer()       // Join lobby
upsertBotPlayer()    // Create AI bot player
updatePlayer()       // Update player state

// Round state
initRoundState()     // Initialize new round
updateRoundState()   // Update round data
saveHandCards()      // Store player hands securely
getBotHandCards()    // Host reads bot hands

// Real-time subscriptions
subscribeToRoom()    // Listen for room changes
subscribeToPlayers() // Listen for player updates
subscribeToRoundState() // Listen for round changes
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

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| **"Supabase Not Configured"** | Create `assets/js/config.js` from `config.example.js` with valid credentials |
| **Can't reconnect after refresh** | Check localStorage is enabled; room must still be active |
| **Game state not updating** | Verify Supabase Realtime is enabled in project settings |
| **Cards not dealing** | Ensure all SQL scripts ran successfully; check RLS policies |
| **Players can't join** | Room code is case-sensitive; ensure room status is "lobby" |
| **Bots not working** | Check browser console for errors; host must stay connected |

---

## 🔐 Security Considerations

### Row Level Security (RLS)
Hand cards use Supabase RLS policies:
```sql
-- Players can ONLY read their own cards
CREATE POLICY "Players can read own cards"
ON hand_cards FOR SELECT
USING (player_id = auth.uid() OR is_bot = true);
```

### Limitations
- Client-side validation can be bypassed by determined users
- Best for casual play with trusted friends
- Consider server-side validation for competitive play

### Best Practices
- Play in private lobbies
- Share room codes only with trusted players
- Use environment variables for production deployments

---

## 🎨 Customization

### Change Theme Colors
Edit CSS variables in `assets/css/styles.css`:
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
Edit constants in `assets/js/game.js`:
```javascript
export const GAME_CONSTANTS = {
    STARTING_MONEY: 100000,    // $1000
    BUST_THRESHOLD: 10,        // Change bust limit
    RAISE_AMOUNTS: [10000, 20000, 50000] // Bet increments
};
```

### Modify AI Behavior
Adjust AI personalities in `assets/js/ai.js`:
- Change betting thresholds
- Modify card selection logic
- Add new personality types

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
- [ ] Spectator mode enhancements

---

## 📄 License

MIT License - Feel free to use, modify, and distribute.

## 🙏 Acknowledgments

Created as a demonstration of:
- Vanilla JavaScript capabilities without frameworks
- Real-time multiplayer game development
- Supabase for backend-as-a-service
- Clean, maintainable code architecture

---

**Enjoy playing NOT10! 🎮**

For deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md)

**Enjoy playing NOT10!** 🎮🃏
