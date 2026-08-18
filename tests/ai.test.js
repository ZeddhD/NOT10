/**
 * Headless unit tests for engine/ai.js's betting confidence blend - the
 * "read the table, not just your own hand" improvement (pot odds +
 * survivor count layered on hand strength).
 */
import { describe, it, expect } from 'vitest';
import { AIPlayer, executeAIBet, choosePosition } from '../engine/ai.js';

describe('AIPlayer.evaluateBetConfidence', () => {
    const ai = new AIPlayer('p1', 'Bot', 'balanced', 0);

    it('a cheap call against a big pot raises confidence over hand strength alone', () => {
        const cheap = ai.evaluateBetConfidence(0.3, 100000, 5000, 4);
        const noPot = ai.evaluateBetConfidence(0.3, 0, 5000, 4);
        expect(cheap).toBeGreaterThan(noPot);
    });

    it('an expensive call relative to the pot lowers confidence', () => {
        const expensive = ai.evaluateBetConfidence(0.5, 1000, 100000, 4);
        expect(expensive).toBeLessThan(0.5 * 0.65 + 0.5 * 0.25 + 0); // below the "neutral pot odds" baseline
    });

    it('fewer survivors nudges confidence up, never past 1', () => {
        const fourLeft = ai.evaluateBetConfidence(0.9, 50000, 50000, 4);
        const twoLeft = ai.evaluateBetConfidence(0.9, 50000, 50000, 2);
        expect(twoLeft).toBeGreaterThanOrEqual(fourLeft);
        expect(twoLeft).toBeLessThanOrEqual(1);
    });

    it('checking (no cost to call) falls back to hand strength with neutral pot odds', () => {
        const result = ai.evaluateBetConfidence(0.4, 100000, 0, 4);
        expect(result).toBeCloseTo(0.4 * 0.65 + 0.5 * 0.25, 5);
    });

    it('stays within 0-1 at the extremes', () => {
        expect(ai.evaluateBetConfidence(1, 1000000, 1, 2)).toBeLessThanOrEqual(1);
        expect(ai.evaluateBetConfidence(0, 0, 1000000, 4)).toBeGreaterThanOrEqual(0);
    });
});

describe('executeAIBet raise affordability', () => {
    it('does not downgrade an affordable small raise just because someone else already bet a lot', async () => {
        // decision.amount is added to the AI's OWN current bet, not a
        // target relative to the table's highest bet - a bot with plenty
        // of money for its own $100 raise used to get wrongly downgraded
        // to a call whenever another player's bet (here $900) was already
        // far above what the bot itself had committed ($0 so far).
        const ai = new AIPlayer('p1', 'Bot', 'cautious', 0); // cautious's first action is always raise $100
        ai.money_cents = 50000; // $500 - trivially affords a $100 raise
        ai.hand = [0, 1];
        const roundState = {
            bets_json: { p2: 90000 }, // someone else already bet $900
            has_raised_json: {},
            bet_action_count_json: {}
        };
        const gameState = { tableTotal: 0, potCents: 90000, activePlayerCount: 2 };

        const decision = await executeAIBet(ai, gameState, roundState);

        expect(decision.action).toBe('raise');
        expect(decision.amount).toBe(10000);
    });
});

describe('choosePosition edge cases', () => {
    it('returns a safe choice instead of NaN/Infinity math on an empty hand', () => {
        const ai = new AIPlayer('p1', 'Bot', 'balanced', 0);
        ai.hand = [];
        expect(() => choosePosition(ai)).not.toThrow();
        expect(['first', 'last']).toContain(choosePosition(ai));
    });
});
