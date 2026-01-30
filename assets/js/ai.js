/**
 * AI logic for NOT10
 * Implements different AI personalities with varied strategies
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
        
        // Calculate hand strength (simple heuristic)
        const handStrength = this.evaluateHandStrength(gameState.tableTotal);
        
        // Personality-based decision
        switch (this.personality) {
            case AI_PERSONALITIES.CAUTIOUS:
                return this.cautiousBetting(hasRaisedOnce, highestBet, myBet, handStrength);
            
            case AI_PERSONALITIES.AGGRESSIVE:
                return this.aggressiveBetting(hasRaisedOnce, highestBet, myBet, handStrength);
            
            case AI_PERSONALITIES.BALANCED:
            default:
                return this.balancedBetting(hasRaisedOnce, highestBet, myBet, handStrength);
        }
    }
    
    /**
     * Cautious betting strategy
     */
    cautiousBetting(hasRaised, highestBet, myBet, handStrength) {
        // Must raise at least once
        if (!hasRaised) {
            // Raise minimum amount
            return { action: 'raise', amount: 10000 }; // $100
        }
        
        // If hand is weak, just call
        if (handStrength < 0.5) {
            return { action: 'call', amount: null };
        }
        
        // Sometimes raise again with good hand (20% chance)
        if (handStrength > 0.7 && Math.random() < 0.2) {
            return { action: 'raise', amount: 10000 };
        }
        
        return { action: 'call', amount: null };
    }
    
    /**
     * Balanced betting strategy
     */
    balancedBetting(hasRaised, highestBet, myBet, handStrength) {
        if (!hasRaised) {
            // Raise based on hand strength
            if (handStrength > 0.7) {
                return { action: 'raise', amount: Math.random() < 0.5 ? 20000 : 10000 };
            } else if (handStrength > 0.4) {
                return { action: 'raise', amount: 10000 };
            } else {
                return { action: 'raise', amount: 10000 }; // Minimum
            }
        }
        
        // Raise again based on hand strength (40% chance with good hand)
        if (handStrength > 0.6 && Math.random() < 0.4) {
            const raiseOptions = [10000, 20000];
            return { action: 'raise', amount: raiseOptions[Math.floor(Math.random() * raiseOptions.length)] };
        }
        
        return { action: 'call', amount: null };
    }
    
    /**
     * Aggressive betting strategy
     */
    aggressiveBetting(hasRaised, highestBet, myBet, handStrength) {
        if (!hasRaised) {
            // Always raise higher amounts
            const raiseOptions = [20000, 50000];
            const amount = raiseOptions[Math.floor(Math.random() * raiseOptions.length)];
            
            // Sometimes raise max even with bad hand (bluff)
            if (Math.random() < 0.3) {
                return { action: 'raise', amount: 50000 };
            }
            
            return { action: 'raise', amount };
        }
        
        // Often raise again (60% chance)
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
        
        // If we called (matched highest bet), finalize
        if (myBet === highestBet && highestBet > 0) {
            return true;
        }
        
        // Personality-based finalize decision
        switch (this.personality) {
            case AI_PERSONALITIES.CAUTIOUS:
                // Cautious AI finalizes after 1-2 bets
                return Math.random() < 0.7;
                
            case AI_PERSONALITIES.BALANCED:
                // Balanced AI finalizes after 1-3 bets
                return Math.random() < 0.5;
                
            case AI_PERSONALITIES.AGGRESSIVE:
                // Aggressive AI may bet multiple times before finalizing (bluff)
                return Math.random() < 0.4;
                
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
        
        // Personality-based card selection
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
    
    /**
     * Cautious card choice - always play safest
     */
    cautiousCardChoice(tableTotal, safeCards, riskyCards) {
        if (safeCards.length > 0) {
            // Play lowest safe card to minimize total
            return Math.min(...safeCards);
        }
        
        // All cards bust - play lowest
        return Math.min(...this.hand);
    }
    
    /**
     * Balanced card choice
     */
    balancedCardChoice(tableTotal, safeCards, riskyCards) {
        if (safeCards.length > 0) {
            // Usually play a middle-value safe card
            const sorted = [...safeCards].sort((a, b) => a - b);
            const midIndex = Math.floor(sorted.length / 2);
            return sorted[midIndex];
        }
        
        // All cards bust - play lowest
        return Math.min(...this.hand);
    }
    
    /**
     * Aggressive card choice - sometimes risks
     */
    aggressiveCardChoice(tableTotal, safeCards, riskyCards) {
        // If total is very low, might play higher card aggressively
        if (tableTotal < 5 && safeCards.length > 0) {
            // Play highest safe card
            return Math.max(...safeCards);
        }
        
        if (safeCards.length > 0) {
            // Usually play safe, but pick randomly
            return safeCards[Math.floor(Math.random() * safeCards.length)];
        }
        
        // All cards bust - play lowest
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
        
        // Factors:
        // 1. Percentage of safe cards
        // 2. Number of low cards (0s and 1s are valuable)
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
 * Create AI players for offline game
 * @param {number} count - Number of AI players (1-3)
 * @returns {Array<AIPlayer>} Array of AI players
 */
export function createAIPlayers(count = 3) {
    const personalities = [
        AI_PERSONALITIES.CAUTIOUS,
        AI_PERSONALITIES.BALANCED,
        AI_PERSONALITIES.AGGRESSIVE
    ];
    
    const names = [
        'Cautious Carl',
        'Balanced Betty',
        'Aggressive Alex'
    ];
    
    const aiPlayers = [];
    
    for (let i = 0; i < Math.min(count, 3); i++) {
        const ai = new AIPlayer(
            `ai_${i + 1}`,
            names[i],
            personalities[i],
            i + 1 // Seat index (human is seat 0)
        );
        aiPlayers.push(ai);
    }
    
    return aiPlayers;
}

/**
 * Execute AI turn for betting
 * @param {AIPlayer} ai - AI player
 * @param {Object} gameState - Game state
 * @param {Object} roundState - Round state
 * @returns {Promise<{action: string, amount: number|null}>} Betting decision
 */
export async function executeAIBet(ai, gameState, roundState) {
    // Small delay to simulate thinking
    await utils.sleep(500 + Math.random() * 1000);
    
    const decision = ai.chooseBetAction(gameState, roundState);
    
    // Get current bet amounts
    const bets = roundState.bets_json || {};
    const highestBet = Math.max(0, ...Object.values(bets));
    const myCurrentBet = bets[ai.id] || 0;
    const callAmount = highestBet - myCurrentBet;
    
    // Validate decision based on money
    if (decision.action === 'raise') {
        const bets = roundState.bets_json || {};
        const highestBet = Math.max(0, ...Object.values(bets));
        const newBet = highestBet + decision.amount;
        
        // Check if AI can afford
        if (ai.money_cents < newBet - myCurrentBet) {
            // Fall back to minimum raise or call
            const minRaise = highestBet + 10000;
            if (ai.money_cents >= minRaise - myCurrentBet) {
                decision.amount = 10000;
            } else {
                decision.action = 'call';
                decision.amount = null;
            }
        }
    }
    
    // Handle CALL - check if calling would be an all-in or near all-in
    if (decision.action === 'call') {
        const handStrength = ai.evaluateHandStrength(gameState.tableTotal);
        
        // If calling requires all or most of AI's money, be more conservative
        if (callAmount >= ai.money_cents * 0.8) {
            // This is an all-in or near all-in situation
            if (ai.personality === 'cautious') {
                // Cautious AI rarely calls all-ins unless hand is very strong
                if (handStrength > 0.85) {
                    decision.action = callAmount >= ai.money_cents ? 'all-in' : 'call';
                } else {
                    // Fold instead - just finalize with current bet
                    decision.shouldFinalize = true;
                    return decision;
                }
            } else if (ai.personality === 'aggressive') {
                // Aggressive AI calls all-ins with decent hands
                if (handStrength > 0.5) {
                    decision.action = callAmount >= ai.money_cents ? 'all-in' : 'call';
                } else {
                    decision.shouldFinalize = true;
                    return decision;
                }
            } else {
                // Balanced AI needs good hand to call all-ins
                if (handStrength > 0.7) {
                    decision.action = callAmount >= ai.money_cents ? 'all-in' : 'call';
                } else {
                    decision.shouldFinalize = true;
                    return decision;
                }
            }
        }
    }
    
    // Decide if AI should finalize after this bet
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
    // Small delay to simulate thinking
    await utils.sleep(500 + Math.random() * 1500);
    
    const card = ai.chooseCard(tableTotal);
    return card;
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
 * Get random AI personality
 * @returns {string} Random personality type
 */
export function getRandomPersonality() {
    const types = Object.values(AI_PERSONALITIES);
    return types[Math.floor(Math.random() * types.length)];
}

/**
 * Simulate AI thinking message
 * @param {AIPlayer} ai - AI player
 * @param {string} phase - Current phase ('betting' or 'playing')
 * @returns {string} Thinking message
 */
export function getAIThinkingMessage(ai, phase) {
    const thinkingMessages = {
        betting: [
            `${ai.name} is considering the bet...`,
            `${ai.name} is calculating odds...`,
            `${ai.name} is thinking about raising...`
        ],
        playing: [
            `${ai.name} is choosing a card...`,
            `${ai.name} is planning the move...`,
            `${ai.name} is analyzing the table...`
        ]
    };
    
    const messages = thinkingMessages[phase] || thinkingMessages.playing;
    return messages[Math.floor(Math.random() * messages.length)];
}
