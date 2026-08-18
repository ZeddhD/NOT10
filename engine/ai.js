/**
 * AI logic for NOT10
 * Implements different AI personalities with varied strategies. Shared
 * unchanged between offline browser play and the server's bot control -
 * this file has no network/DOM dependency either way.
 */

import * as utils from './utils.js';
import * as game from './game.js';

// AI personality types
export const AI_PERSONALITIES = {
    CAUTIOUS: 'cautious',
    BALANCED: 'balanced',
    AGGRESSIVE: 'aggressive'
};

/**
 * AI Player class
 */
export class AIPlayer {
    constructor(id, name, personality, seatIndex) {
        this.id = id;
        this.name = name;
        this.personality = personality;
        this.seat_index = seatIndex;
        this.money_cents = game.GAME_CONSTANTS.STARTING_MONEY;
        this.status = 'active';
        this.is_ready = true;
        this.hand = [];
    }

    /**
     * Choose a betting action
     * @param {Object} gameState - Current game state
     * @param {Object} roundState - Current round state
     * @returns {{action: string, amount: number|null}} Betting decision
     */
    chooseBetAction(gameState, roundState) {
        const bets = roundState.bets_json || {};
        const hasRaised = roundState.has_raised_json || {};
        const highestBet = Math.max(0, ...Object.values(bets));
        const myBet = bets[this.id] || 0;
        const hasRaisedOnce = hasRaised[this.id] || false;

        const handStrength = this.evaluateHandStrength(gameState.tableTotal);
        // Reads the table, not just its own hand: a call that's cheap
        // relative to the pot is worth taking on a weaker hand than the
        // same call would be against a small pot (classic pot odds), and
        // fewer survivors means whoever's left splits a bigger relative
        // share, worth leaning in for a bit more.
        const callAmount = Math.max(0, highestBet - myBet);
        const confidence = this.evaluateBetConfidence(
            handStrength, gameState.potCents || 0, callAmount, gameState.activePlayerCount || 4
        );

        switch (this.personality) {
            case AI_PERSONALITIES.CAUTIOUS:
                return this.cautiousBetting(hasRaisedOnce, highestBet, myBet, confidence);
            case AI_PERSONALITIES.AGGRESSIVE:
                return this.aggressiveBetting(hasRaisedOnce, highestBet, myBet, confidence);
            case AI_PERSONALITIES.BALANCED:
            default:
                return this.balancedBetting(hasRaisedOnce, highestBet, myBet, confidence);
        }
    }

    /**
     * Blend raw hand strength with pot odds and survivor count into a
     * single 0-1 confidence score the betting personalities act on.
     * @param {number} handStrength - 0-1, own-hand-only score
     * @param {number} potCents - Current pot size
     * @param {number} callAmount - Cost to match the table's highest bet
     * @param {number} activePlayerCount - Players still active this round
     * @returns {number} 0-1 confidence score
     */
    evaluateBetConfidence(handStrength, potCents, callAmount, activePlayerCount) {
        // No cost to call (checking, or already at the table high) - pot
        // odds don't apply, so lean on hand strength alone.
        const potOdds = callAmount > 0 ? potCents / (potCents + callAmount) : 0.5;
        const survivorFactor = Math.max(0, Math.min(0.15, (4 - activePlayerCount) * 0.05));
        return Math.max(0, Math.min(1, handStrength * 0.65 + potOdds * 0.25 + survivorFactor));
    }

    cautiousBetting(hasRaised, highestBet, myBet, handStrength) {
        if (this.money_cents < 10000) {
            return { action: 'all-in', amount: null };
        }
        if (!hasRaised) {
            return { action: 'raise', amount: 10000 };
        }
        if (handStrength < 0.5) {
            return { action: 'call', amount: null };
        }
        if (handStrength > 0.7 && Math.random() < 0.2) {
            return { action: 'raise', amount: 10000 };
        }
        return { action: 'call', amount: null };
    }

    balancedBetting(hasRaised, highestBet, myBet, handStrength) {
        if (this.money_cents < 10000) {
            return { action: 'all-in', amount: null };
        }
        if (!hasRaised) {
            if (handStrength > 0.7) {
                return { action: 'raise', amount: Math.random() < 0.5 ? 20000 : 10000 };
            } else if (handStrength > 0.4) {
                return { action: 'raise', amount: 10000 };
            } else {
                return { action: 'raise', amount: 10000 };
            }
        }
        if (handStrength > 0.6 && Math.random() < 0.4) {
            const raiseOptions = [10000, 20000];
            return { action: 'raise', amount: raiseOptions[Math.floor(Math.random() * raiseOptions.length)] };
        }
        return { action: 'call', amount: null };
    }

    aggressiveBetting(hasRaised, highestBet, myBet, handStrength) {
        if (this.money_cents < 10000) {
            return { action: 'all-in', amount: null };
        }
        if (!hasRaised) {
            const raiseOptions = [20000, 50000];
            const amount = raiseOptions[Math.floor(Math.random() * raiseOptions.length)];
            if (Math.random() < 0.3) {
                return { action: 'raise', amount: 50000 };
            }
            return { action: 'raise', amount };
        }
        if (Math.random() < 0.6) {
            const raiseOptions = [10000, 20000, 50000];
            return { action: 'raise', amount: raiseOptions[Math.floor(Math.random() * raiseOptions.length)] };
        }
        return { action: 'call', amount: null };
    }

    /**
     * Decide if AI should finalize bet
     * @param {Object} gameState - Current game state
     * @param {Object} roundState - Current round state
     * @returns {boolean} Should finalize now
     */
    shouldFinalizeBet(gameState, roundState) {
        const bets = roundState.bets_json || {};
        const myBet = bets[this.id] || 0;
        const highestBet = Math.max(0, ...Object.values(bets));

        if (myBet === highestBet && highestBet > 0) {
            return true;
        }

        switch (this.personality) {
            case AI_PERSONALITIES.CAUTIOUS: {
                const t = 0.6 + Math.random() * 0.2;
                return Math.random() < t;
            }
            case AI_PERSONALITIES.BALANCED: {
                const t = 0.4 + Math.random() * 0.2;
                return Math.random() < t;
            }
            case AI_PERSONALITIES.AGGRESSIVE: {
                const t = 0.3 + Math.random() * 0.2;
                return Math.random() < t;
            }
            default:
                return true;
        }
    }

    /**
     * Choose a card to play
     * @param {number} tableTotal - Current table total
     * @returns {number} Card value to play
     */
    chooseCard(tableTotal) {
        if (this.hand.length === 0) {
            throw new Error('AI has no cards to play');
        }

        const safeCards = this.hand.filter(card => tableTotal + card < game.GAME_CONSTANTS.BUST_THRESHOLD);
        const riskyCards = this.hand.filter(card => tableTotal + card >= game.GAME_CONSTANTS.BUST_THRESHOLD);

        switch (this.personality) {
            case AI_PERSONALITIES.CAUTIOUS:
                return this.cautiousCardChoice(tableTotal, safeCards, riskyCards);
            case AI_PERSONALITIES.AGGRESSIVE:
                return this.aggressiveCardChoice(tableTotal, safeCards, riskyCards);
            case AI_PERSONALITIES.BALANCED:
            default:
                return this.balancedCardChoice(tableTotal, safeCards, riskyCards);
        }
    }

    cautiousCardChoice(tableTotal, safeCards) {
        if (safeCards.length > 0) {
            return Math.min(...safeCards);
        }
        return Math.min(...this.hand);
    }

    balancedCardChoice(tableTotal, safeCards) {
        if (safeCards.length > 0) {
            const sorted = [...safeCards].sort((a, b) => a - b);
            const midIndex = Math.floor(sorted.length / 2);
            return sorted[midIndex];
        }
        return Math.min(...this.hand);
    }

    aggressiveCardChoice(tableTotal, safeCards) {
        if (tableTotal < 5 && safeCards.length > 0) {
            return Math.max(...safeCards);
        }
        if (safeCards.length > 0) {
            return safeCards[Math.floor(Math.random() * safeCards.length)];
        }
        return Math.min(...this.hand);
    }

    /**
     * Evaluate hand strength
     * @param {number} tableTotal - Current table total
     * @returns {number} Strength score (0-1)
     */
    evaluateHandStrength(tableTotal) {
        if (this.hand.length === 0) return 0;

        const safeCards = this.hand.filter(card => tableTotal + card < game.GAME_CONSTANTS.BUST_THRESHOLD);
        const lowCards = this.hand.filter(card => card <= 1);

        const safeFactor = safeCards.length / this.hand.length;
        const lowCardFactor = lowCards.length / this.hand.length;

        return (safeFactor * 0.6) + (lowCardFactor * 0.4);
    }

    /**
     * Remove a card from hand
     * @param {number} cardValue - Card value to remove
     */
    removeCard(cardValue) {
        const index = this.hand.indexOf(cardValue);
        if (index > -1) {
            this.hand.splice(index, 1);
        }
    }

    /**
     * Set hand
     * @param {Array<number>} cards - Array of card values
     */
    setHand(cards) {
        this.hand = [...cards];
    }
}

/**
 * Execute AI turn for betting
 * @param {AIPlayer} ai - AI player
 * @param {Object} gameState - Game state
 * @param {Object} roundState - Round state
 * @returns {Promise<{action: string, amount: number|null}>} Betting decision
 */
export async function executeAIBet(ai, gameState, roundState) {
    await utils.sleep(500 + Math.random() * 1000);

    const decision = ai.chooseBetAction(gameState, roundState);

    const bets = roundState.bets_json || {};
    const highestBet = Math.max(0, ...Object.values(bets));
    const myCurrentBet = bets[ai.id] || 0;
    const callAmount = highestBet - myCurrentBet;

    if (decision.action === 'raise') {
        // decision.amount is added to the AI's OWN current bet (matches
        // processBet's 'bet' action: newPlayerBet = currentPlayerBet +
        // amount), not a target to reach relative to the table's highest
        // bet - affordability is just "can I afford this increment," not
        // "can I afford highestBet + this increment." The old formula
        // compared against highestBet + decision.amount - myCurrentBet,
        // which wildly overestimated the cost whenever someone else had
        // already bet more than the AI had committed (i.e. almost every
        // first raise of a lap), making bots back off from raises they
        // could easily afford.
        if (ai.money_cents < decision.amount) {
            const minRaise = game.GAME_CONSTANTS.RAISE_AMOUNTS[0];
            if (ai.money_cents >= minRaise) {
                decision.amount = minRaise;
            } else {
                decision.action = 'call';
                decision.amount = null;
            }
        }
    }

    if (decision.action === 'call') {
        const handStrength = ai.evaluateBetConfidence(
            ai.evaluateHandStrength(gameState.tableTotal), gameState.potCents || 0, callAmount, gameState.activePlayerCount || 4
        );

        // There is no fold in NOT10 - every active player must bet, call,
        // or go all-in. "Back out with a weak hand" is only a real option
        // once you've already made your mandatory first action this round
        // (bet_action_count_json >= 1); before that, finalize() is invalid
        // (engine rejects it) and the AI would loop forever retrying the
        // same illegal action every tick, freezing the game on its turn.
        const actionCount = roundState.bet_action_count_json || {};
        const hasActedThisRound = (actionCount[ai.id] || 0) >= 1;

        if (callAmount >= ai.money_cents * 0.8) {
            const strengthThreshold = ai.personality === 'cautious' ? 0.85
                : ai.personality === 'aggressive' ? 0.5
                : 0.7;

            if (handStrength > strengthThreshold) {
                decision.action = callAmount >= ai.money_cents ? 'all-in' : 'call';
            } else if (hasActedThisRound) {
                decision.action = 'finalize';
                decision.shouldFinalize = true;
                return decision;
            } else {
                decision.action = callAmount >= ai.money_cents ? 'all-in' : 'call';
            }
        }
    }

    decision.shouldFinalize = (decision.action === 'call') || ai.shouldFinalizeBet(gameState, roundState);

    return decision;
}

/**
 * Execute AI turn for card playing
 * @param {AIPlayer} ai - AI player
 * @param {number} tableTotal - Current table total
 * @returns {Promise<number>} Card value to play
 */
export async function executeAICardPlay(ai, tableTotal) {
    await utils.sleep(500 + Math.random() * 1500);
    return ai.chooseCard(tableTotal);
}

/**
 * AI personality descriptions for display
 */
export const AI_DESCRIPTIONS = {
    [AI_PERSONALITIES.CAUTIOUS]: 'Plays it safe, bets conservatively, avoids risks',
    [AI_PERSONALITIES.BALANCED]: 'Moderate strategy, adapts to situation',
    [AI_PERSONALITIES.AGGRESSIVE]: 'High risk, high reward, loves to bluff'
};

/**
 * AI chooses position (first or last) when they are highest bettor.
 * Only looks at the hand itself, not the table - this choice always
 * happens at the very start of the playing phase, before any card has
 * been played, so the table total is always 0 when it's called.
 * @param {AIPlayer} ai - AI player
 * @returns {string} 'first' or 'last'
 */
export function choosePosition(ai) {
    // Not reachable in normal play (the partial hand dealt before betting
    // is always at least 2 cards - see startNewRound's halfCount), but an
    // empty hand here would otherwise divide by zero (NaN avgCard) and
    // Math.max/min(...[]) returning -Infinity/Infinity - cheap to guard
    // against outright rather than trust that invariant forever.
    if (ai.hand.length === 0) return 'last';

    const avgCard = ai.hand.reduce((sum, card) => sum + card, 0) / ai.hand.length;
    const maxCard = Math.max(...ai.hand);
    const minCard = Math.min(...ai.hand);

    const hasStrongHand = avgCard < 1.5 || maxCard <= 1;
    const hasWeakHand = avgCard > 2 || minCard >= 2;

    if (ai.personality === 'cautious') {
        return hasStrongHand && Math.random() > 0.3 ? 'first' : 'last';
    } else if (ai.personality === 'aggressive') {
        return hasWeakHand && Math.random() > 0.3 ? 'last' : 'first';
    } else {
        if (hasStrongHand) {
            return Math.random() > 0.4 ? 'first' : 'last';
        } else if (hasWeakHand) {
            return Math.random() > 0.3 ? 'last' : 'first';
        } else {
            return Math.random() > 0.5 ? 'first' : 'last';
        }
    }
}
