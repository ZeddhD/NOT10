/**
 * Headless unit tests for engine/ai.js's betting confidence blend - the
 * "read the table, not just your own hand" improvement (pot odds +
 * survivor count layered on hand strength).
 */
import { describe, it, expect } from 'vitest';
import { AIPlayer } from '../engine/ai.js';

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
