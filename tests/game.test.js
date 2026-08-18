/**
 * Headless unit tests for the pure rules engine (engine/game.js).
 *
 * These run with no browser, no server, no network - just plain function
 * calls against plain objects, per the "pure logic core gets fast headless
 * tests" rule from the ship-flow playbook. See README's Testing section
 * for what is and isn't covered here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as game from '../engine/game.js';
import * as utils from '../engine/utils.js';

function makePlayer(id, overrides = {}) {
    return {
        id,
        name: id,
        seat_index: overrides.seat_index ?? 0,
        money_cents: overrides.money_cents ?? game.GAME_CONSTANTS.STARTING_MONEY,
        status: overrides.status ?? 'active',
        is_bot: overrides.is_bot ?? false,
        ...overrides
    };
}

function makeRoom(overrides = {}) {
    return {
        code: 'ABCD',
        current_round: 0,
        starting_player_index: 0,
        pot_cents: 0,
        table_total: 0,
        phase: 'lobby',
        turn_player_id: null,
        ...overrides
    };
}

function makeRoundState(overrides = {}) {
    return {
        round_no: 1,
        bets_json: {},
        has_raised_json: {},
        bet_action_count_json: {},
        finalized_json: {},
        played_count: 0,
        log_json: [],
        ...overrides
    };
}

describe('utils: deck & shuffle', () => {
    it('creates a 40-card deck with ten of each value 0-3', () => {
        const deck = utils.createDeck();
        expect(deck).toHaveLength(40);
        for (let value = 0; value <= 3; value++) {
            expect(deck.filter(c => c === value)).toHaveLength(10);
        }
    });

    it('shuffle preserves the multiset of cards without mutating the input', () => {
        const deck = utils.createDeck();
        const shuffled = utils.shuffleArray(deck);
        expect(shuffled).toHaveLength(deck.length);
        expect([...shuffled].sort()).toEqual([...deck].sort());
        expect(deck).toHaveLength(40); // original untouched
    });
});

describe('game.js is a pure module', () => {
    it('imports nothing beyond its own engine/utils.js sibling (no network/DOM dependency)', async () => {
        const src = await import('node:fs/promises').then(fs =>
            fs.readFile(new URL('../engine/game.js', import.meta.url), 'utf8')
        );
        const imports = [...src.matchAll(/^\s*import .*from ['"](.+)['"]/gm)].map(m => m[1]);
        expect(imports).toEqual(['./utils.js']);
    });
});

describe('game.startNewRound', () => {
    let room, players;

    beforeEach(() => {
        room = makeRoom();
        players = [
            makePlayer('p1', { seat_index: 0 }),
            makePlayer('p2', { seat_index: 1 }),
            makePlayer('p3', { seat_index: 2 })
        ];
    });

    it('deals only half of the eventual 4-card hand before betting', () => {
        const result = game.startNewRound(room, players);
        expect(result.gameOver).toBe(false);
        expect(result.roundState.cards_per_player).toBe(4);
        expect(result.hands['p1']).toHaveLength(2);
        expect(result.hands['p2']).toHaveLength(2);
        expect(result.hands['p3']).toHaveLength(2);
        // 6 cards dealt (3 players x 2) out of 40.
        expect(result.deck).toHaveLength(34);
    });

    it('deals only half of the eventual 6-card hand before betting when only 2 are active', () => {
        players = [makePlayer('p1', { seat_index: 0 }), makePlayer('p2', { seat_index: 1 })];
        const result = game.startNewRound(room, players);
        expect(result.roundState.cards_per_player).toBe(6);
        expect(result.hands['p1']).toHaveLength(3);
        expect(result.hands['p2']).toHaveLength(3);
    });

    it('reports gameOver when fewer than 2 players have money', () => {
        players = [makePlayer('p1', { money_cents: 100000 }), makePlayer('p2', { money_cents: 0 })];
        const result = game.startNewRound(room, players);
        expect(result.gameOver).toBe(true);
        expect(result.winner.id).toBe('p1');
    });

    it('demotes broke active players to spectator', () => {
        players.push(makePlayer('p4', { seat_index: 3, money_cents: 0 }));
        game.startNewRound(room, players);
        const broke = players.find(p => p.id === 'p4');
        expect(broke.status).toBe('spectator');
    });

    it('declares the game over on money alone, even if a broke player is still marked active', () => {
        // Simulates the exact gap that could let a round start (or keep
        // going) when it should have already ended: a player at $0 whose
        // status never got synced back to 'spectator'. The win check must
        // not depend on status being accurate - money_cents is the only
        // thing that actually determines who's still in the game.
        players = [
            makePlayer('p1', { money_cents: 400000, status: 'active' }),
            makePlayer('p2', { money_cents: 0, status: 'active' }), // stale - should be spectator
            makePlayer('p3', { money_cents: 0, status: 'active' })
        ];
        const result = game.startNewRound(room, players);
        expect(result.gameOver).toBe(true);
        expect(result.winner.id).toBe('p1');
    });

    it('mutates room in place (phase/turn/round) and returns a fresh round state', () => {
        const result = game.startNewRound(room, players);
        expect(room.phase).toBe('betting');
        expect(room.current_round).toBe(1);
        expect(room.turn_player_id).toBe(result.startingPlayer.id);
        expect(result.roundState.round_no).toBe(1);
        expect(result.roundState.log_json).toHaveLength(1);
    });
});

describe('game.dealRemainingHands', () => {
    it('tops each player up to the full hand size using the leftover deck', () => {
        const room = makeRoom();
        const players = [
            makePlayer('p1', { seat_index: 0 }),
            makePlayer('p2', { seat_index: 1 }),
            makePlayer('p3', { seat_index: 2 })
        ];
        const result = game.startNewRound(room, players);
        const handsMap = new Map(Object.entries(result.hands));

        game.dealRemainingHands(result.activePlayers, handsMap, result.deck, result.roundState.cards_per_player);

        expect(handsMap.get('p1')).toHaveLength(4);
        expect(handsMap.get('p2')).toHaveLength(4);
        expect(handsMap.get('p3')).toHaveLength(4);
        // All 12 cards (3 players x 4) came out of the same 40-card deck.
        expect(result.deck).toHaveLength(40 - 12);
    });

    it('is a no-op for a player already dealt up to the full hand size', () => {
        const handsMap = new Map([['p1', [0, 1, 2, 3]]]);
        const deck = [0, 1, 2, 3, 0, 1];
        game.dealRemainingHands([makePlayer('p1')], handsMap, deck, 4);
        expect(handsMap.get('p1')).toHaveLength(4);
        expect(deck).toHaveLength(6); // untouched
    });
});

describe('game.processBet', () => {
    let room, players, roundState;

    beforeEach(() => {
        room = makeRoom({ phase: 'betting', pot_cents: 0, turn_player_id: 'p1' });
        players = [makePlayer('p1'), makePlayer('p2')];
        roundState = makeRoundState();
    });

    it('rejects a bet/call/finalize from a player when it is not their turn', () => {
        const result = game.processBet(room, players, roundState, 'p2', 'bet', 10000);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not your turn/i);
    });

    it('rejects finalize before any bet action', () => {
        const result = game.processBet(room, players, roundState, 'p1', 'finalize', null);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/must bet or call/i);
    });

    it('rejects an invalid bet amount', () => {
        const result = game.processBet(room, players, roundState, 'p1', 'bet', 12345);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/invalid bet amount/i);
    });

    it('applies a valid bet: deducts money, grows the pot, marks a raise', () => {
        const result = game.processBet(room, players, roundState, 'p1', 'bet', 10000);
        expect(result.success).toBe(true);
        expect(result.action).toBe('raise'); // first bet on an empty table is a raise
        expect(players.find(p => p.id === 'p1').money_cents).toBe(game.GAME_CONSTANTS.STARTING_MONEY - 10000);
        expect(room.pot_cents).toBe(10000);
        expect(roundState.bets_json['p1']).toBe(10000);
    });

    it('rejects finalize below the $100 minimum unless the player is broke', () => {
        game.processBet(room, players, roundState, 'p1', 'bet', 10000);
        room.turn_player_id = 'p2';
        game.processBet(room, players, roundState, 'p2', 'bet', 10000);
        room.turn_player_id = 'p1';
        const result = game.processBet(room, players, roundState, 'p1', 'finalize', null);
        expect(result.success).toBe(true); // $100 bet satisfies the minimum
    });

    it('rejects finalize until every active player has acted once', () => {
        game.processBet(room, players, roundState, 'p1', 'bet', 10000);
        const result = game.processBet(room, players, roundState, 'p1', 'finalize', null);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/all players have bet/i);
    });

    it('rejects call when nobody has bet yet - no free check allowed', () => {
        const result = game.processBet(room, players, roundState, 'p1', 'call', null);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/must bet before you can call/i);
        expect(players.find(p => p.id === 'p1').money_cents).toBe(game.GAME_CONSTANTS.STARTING_MONEY);
        expect(roundState.finalized_json['p1']).toBeFalsy();
    });

    it('call matches only the difference to the table-high bet', () => {
        game.processBet(room, players, roundState, 'p1', 'bet', 50000);
        room.turn_player_id = 'p2';
        const result = game.processBet(room, players, roundState, 'p2', 'call', null);
        expect(result.success).toBe(true);
        expect(result.amount).toBe(50000);
        expect(players.find(p => p.id === 'p2').money_cents).toBe(game.GAME_CONSTANTS.STARTING_MONEY - 50000);
    });

    it('a regular bet that empties the stack auto-finalizes too, not just ALL-IN', () => {
        players[0].money_cents = 10000; // exactly $100
        game.processBet(room, players, roundState, 'p1', 'bet', 10000);
        expect(players[0].money_cents).toBe(0);
        expect(roundState.finalized_json['p1']).toBe(true);
    });

    it('call auto-finalizes - there is no further action left to take', () => {
        game.processBet(room, players, roundState, 'p1', 'bet', 50000);
        room.turn_player_id = 'p2';
        game.processBet(room, players, roundState, 'p2', 'call', null);
        expect(roundState.finalized_json['p2']).toBe(true);
    });

    it('all-in bets the player\'s entire remaining balance', () => {
        players[0].money_cents = 5000; // less than the $100 minimum
        const result = game.processBet(room, players, roundState, 'p1', 'all-in', null);
        expect(result.success).toBe(true);
        expect(result.amount).toBe(5000);
        expect(players[0].money_cents).toBe(0);
    });

    it('all-in auto-finalizes - a broke player has no further action left', () => {
        players[0].money_cents = 5000;
        game.processBet(room, players, roundState, 'p1', 'all-in', null);
        expect(roundState.finalized_json['p1']).toBe(true);
    });

    it('rejects a bet from an inactive/spectator player', () => {
        players[0].status = 'spectator';
        const result = game.processBet(room, players, roundState, 'p1', 'bet', 10000);
        expect(result.success).toBe(false);
    });

});

describe('game.processCardPlay', () => {
    let room, players, roundState;

    beforeEach(() => {
        room = makeRoom({ phase: 'playing', turn_player_id: 'p1' });
        players = [makePlayer('p1', { seat_index: 0 }), makePlayer('p2', { seat_index: 1 })];
        roundState = makeRoundState({ play_order: ['p1', 'p2'] });
    });

    it('rejects a play when it is not that player\'s turn', () => {
        const result = game.processCardPlay(room, players, roundState, 'p2', 1);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not your turn/i);
    });

    it('adds the card value to the table total and advances the turn', () => {
        const result = game.processCardPlay(room, players, roundState, 'p1', 3);
        expect(result.success).toBe(true);
        expect(result.bust).toBe(false);
        expect(result.total).toBe(3);
        expect(room.table_total).toBe(3);
        expect(room.turn_player_id).toBe('p2');
    });

    it('flags a bust once the total reaches the threshold (10)', () => {
        room.table_total = 8;
        const result = game.processCardPlay(room, players, roundState, 'p1', 2);
        expect(result.bust).toBe(true);
        expect(result.eliminatedPlayer.id).toBe('p1');
        expect(result.total).toBe(10);
    });

    it('flags a bust when the total overshoots the threshold', () => {
        room.table_total = 8;
        const result = game.processCardPlay(room, players, roundState, 'p1', 3);
        expect(result.bust).toBe(true);
        expect(result.total).toBe(11);
    });
});

describe('game.endRound - weighted pot distribution', () => {
    it('splits the pot proportionally to survivors\' bets, remainder to the last survivor', () => {
        const room = makeRoom({ pot_cents: 200000, starting_player_index: 0 });
        const players = [
            makePlayer('a', { money_cents: 0 }),
            makePlayer('b', { money_cents: 0 }),
            makePlayer('c', { money_cents: 0 }),
            makePlayer('d', { money_cents: 0 })
        ];
        const roundState = makeRoundState({
            bets_json: { a: 50000, b: 40000, c: 20000, d: 10000 }
        });

        const result = game.endRound(room, players, roundState, 'd');

        expect(result.survivors.map(s => s.id).sort()).toEqual(['a', 'b', 'c']);
        // (50000/110000)*200000 = 90909.09 -> floor 90909
        expect(result.potDistributions['a']).toBe(90909);
        // (40000/110000)*200000 = 72727.27 -> floor 72727
        expect(result.potDistributions['b']).toBe(72727);
        // c is last in iteration order and absorbs the rounding remainder
        expect(result.potDistributions['c']).toBe(200000 - 90909 - 72727);

        // The full pot is always distributed - no cents left on the table
        const sum = Object.values(result.potDistributions).reduce((s, v) => s + v, 0);
        expect(sum).toBe(200000);

        // Player money was actually credited
        expect(players.find(p => p.id === 'a').money_cents).toBe(90909);

        // Pot resets and the round-end result exposes real fields (regression
        // guard for a bug where this returned undefined `perPlayer`/`remainder`
        // instead of the actual potDistributions/totalDistributed computed above)
        expect(room.pot_cents).toBe(0);
        expect(result.totalDistributed).toBe(200000);
        expect(result.potDistributions).toBeDefined();
    });

    it('splits equally when no survivor bet anything (edge case)', () => {
        const room = makeRoom({ pot_cents: 300 });
        const players = [makePlayer('a', { money_cents: 0 }), makePlayer('b', { money_cents: 0 }), makePlayer('c', { money_cents: 0 })];
        const roundState = makeRoundState({ bets_json: {} });

        const result = game.endRound(room, players, roundState, 'c');

        expect(result.survivors).toHaveLength(2);
        const sum = Object.values(result.potDistributions).reduce((s, v) => s + v, 0);
        expect(sum).toBe(300);
    });

    it('rotates the starting player clockwise, wrapping at MAX_PLAYERS', () => {
        const room = makeRoom({ pot_cents: 100, starting_player_index: 3 });
        const players = [makePlayer('a', { money_cents: 0 }), makePlayer('b', { money_cents: 0 })];
        const roundState = makeRoundState({ bets_json: { a: 100 } });

        game.endRound(room, players, roundState, 'b');

        expect(room.starting_player_index).toBe(0); // (3 + 1) % 4
    });

    it('syncs the eliminated player to spectator immediately, not just at the next round start', () => {
        const room = makeRoom({ pot_cents: 100000, starting_player_index: 0 });
        // a went all-in and busts - money_cents is already 0 from that bet
        // (processBet deducts it at bet time; endRound never gives the
        // eliminated player a pot share). c is the lone survivor.
        const players = [
            makePlayer('a', { money_cents: 0, status: 'active' }),
            makePlayer('c', { money_cents: 500000, status: 'active' })
        ];
        const roundState = makeRoundState({ bets_json: { a: 100000, c: 0 } });

        game.endRound(room, players, roundState, 'a');

        expect(players.find(p => p.id === 'a').status).toBe('spectator');
    });
});

describe('game.checkGameOver', () => {
    it('returns the sole remaining player once everyone else is broke', () => {
        const players = [makePlayer('a', { money_cents: 100000 }), makePlayer('b', { money_cents: 0 })];
        expect(game.checkGameOver(players).id).toBe('a');
    });

    it('returns null while 2+ players still have money', () => {
        const players = [makePlayer('a', { money_cents: 100000 }), makePlayer('b', { money_cents: 50000 })];
        expect(game.checkGameOver(players)).toBeNull();
    });
});

describe('game.transitionToPlaying + game.applyPositionChoice', () => {
    it('identifies the highest bettor and lets them move to first position', () => {
        const room = makeRoom({ starting_player_index: 0 });
        const players = [
            makePlayer('a', { seat_index: 0 }),
            makePlayer('b', { seat_index: 1 }),
            makePlayer('c', { seat_index: 2 })
        ];
        const roundState = makeRoundState({ bets_json: { a: 10000, b: 30000, c: 20000 }, log_json: [] });

        const transition = game.transitionToPlaying(room, players, roundState);
        expect(transition.highestBettorId).toBe('b');
        expect(transition.needsPositionChoice).toBe(true);

        const applied = game.applyPositionChoice(room, players, roundState, 'first');
        expect(applied.firstPlayer.id).toBe('b');
        expect(room.turn_player_id).toBe('b');
    });

    it('lets the highest bettor move to last position', () => {
        const room = makeRoom({ starting_player_index: 0 });
        const players = [
            makePlayer('a', { seat_index: 0 }),
            makePlayer('b', { seat_index: 1 }),
            makePlayer('c', { seat_index: 2 })
        ];
        const roundState = makeRoundState({ bets_json: { a: 10000, b: 30000, c: 20000 }, log_json: [] });

        game.transitionToPlaying(room, players, roundState);
        const applied = game.applyPositionChoice(room, players, roundState, 'last');
        expect(applied.firstPlayer.id).toBe('a'); // b moved to the back, a is now first
    });

    it('breaks a tied highest bet in favor of whoever reached it first in turn order, and announces the tie', () => {
        const room = makeRoom({ starting_player_index: 0 });
        const players = [
            makePlayer('a', { seat_index: 0 }),
            makePlayer('b', { seat_index: 1 }),
            makePlayer('c', { seat_index: 2 })
        ];
        // b and c both bet 30000 - b comes first from starting_player_index 0.
        const roundState = makeRoundState({ bets_json: { a: 10000, b: 30000, c: 30000 }, log_json: [] });

        const transition = game.transitionToPlaying(room, players, roundState);
        expect(transition.highestBettorId).toBe('b');

        const tieEntry = roundState.log_json.find(e => e.type === 'tie_break');
        expect(tieEntry).toBeTruthy();
        expect(tieEntry.message).toMatch(/tied with c/);
    });

    it('breaks a tie by true chronological order, not seat order, when a raise happens on a later lap', () => {
        // a is seat 0 (first in raw seat order), b is seat 1. Both end up
        // tied at $1,000, but b reaches it FIRST in real turn order: a bets
        // small on lap 1, b goes ALL-IN for the full $1,000 on lap 1, then
        // a doesn't reach $1,000 until a second lap. Seat order alone would
        // wrongly hand the tie to a (seat 0 < seat 1) - this is exactly the
        // reported bug where the wrong player got the highest-bettor power.
        const room = makeRoom({ starting_player_index: 0 });
        const players = [
            makePlayer('a', { seat_index: 0, money_cents: 100000 }),
            makePlayer('b', { seat_index: 1, money_cents: 100000 }),
            makePlayer('c', { seat_index: 2, money_cents: 100000 })
        ];
        const roundState = makeRoundState();
        room.turn_player_id = 'a';

        game.processBet(room, players, roundState, 'a', 'bet', 20000); // lap 1: a -> $200
        room.turn_player_id = 'b';
        game.processBet(room, players, roundState, 'b', 'all-in', null); // lap 1: b -> $1,000 (ties eventually)
        room.turn_player_id = 'c';
        game.processBet(room, players, roundState, 'c', 'bet', 20000); // lap 1: c -> $200
        room.turn_player_id = 'a';
        game.processBet(room, players, roundState, 'a', 'all-in', null); // lap 2: a -> $1,000 (ties, but later)

        const transition = game.transitionToPlaying(room, players, roundState);
        expect(transition.highestBettorId).toBe('b');

        const tieEntry = roundState.log_json.find(e => e.type === 'tie_break');
        expect(tieEntry.playerId).toBe('b');
    });

    it('play order after GO FIRST holds for the whole round, not just the first card', () => {
        const room = makeRoom({ starting_player_index: 0 });
        const players = [
            makePlayer('a', { seat_index: 0 }),
            makePlayer('b', { seat_index: 1 }),
            makePlayer('c', { seat_index: 2 }),
            makePlayer('d', { seat_index: 3 })
        ];
        const roundState = makeRoundState({ bets_json: { a: 10000, b: 10000, c: 10000, d: 30000 }, log_json: [] });

        game.transitionToPlaying(room, players, roundState);
        game.applyPositionChoice(room, players, roundState, 'first'); // d (highest bettor) goes first
        expect(roundState.play_order).toEqual(['d', 'a', 'b', 'c']);

        game.processCardPlay(room, players, roundState, 'd', 0);
        expect(room.turn_player_id).toBe('a'); // not b - naive seat_index math would have picked b
    });

    it('does not announce a tie when there isn\'t one', () => {
        const room = makeRoom({ starting_player_index: 0 });
        const players = [
            makePlayer('a', { seat_index: 0 }),
            makePlayer('b', { seat_index: 1 })
        ];
        const roundState = makeRoundState({ bets_json: { a: 10000, b: 30000 }, log_json: [] });

        game.transitionToPlaying(room, players, roundState);
        expect(roundState.log_json.find(e => e.type === 'tie_break')).toBeUndefined();
    });

    it('an ALL-IN bet counts the same as a regular bet for highest-bettor position choice', () => {
        const room = makeRoom({ phase: 'betting', turn_player_id: 'a', starting_player_index: 0 });
        const players = [
            makePlayer('a', { seat_index: 0, money_cents: 30000 }),
            makePlayer('b', { seat_index: 1, money_cents: 100000 })
        ];
        const roundState = makeRoundState();

        // b bets a modest, ordinary amount first.
        room.turn_player_id = 'b';
        game.processBet(room, players, roundState, 'b', 'bet', 10000);
        // a shoves their entire (smaller) stack - still less than b's
        // money, but more than b's actual bet, so a should be highest.
        room.turn_player_id = 'a';
        game.processBet(room, players, roundState, 'a', 'all-in', null);

        const transition = game.transitionToPlaying(room, players, roundState);
        expect(transition.highestBettorId).toBe('a');
        expect(transition.highestBet).toBe(30000);
    });
});

describe('game.isBettingComplete / game.getNextBettingPlayer', () => {
    it('is not complete until every active player has finalized', () => {
        const players = [makePlayer('a'), makePlayer('b')];
        expect(game.isBettingComplete(players, { a: true })).toBe(false);
        expect(game.isBettingComplete(players, { a: true, b: true })).toBe(true);
    });

    it('skips already-finalized players when finding the next to act', () => {
        const players = [
            makePlayer('a', { seat_index: 0 }),
            makePlayer('b', { seat_index: 1 }),
            makePlayer('c', { seat_index: 2 })
        ];
        const next = game.getNextBettingPlayer(players, 0, { b: true });
        expect(next.id).toBe('c');
    });

    it('returns null once everyone has finalized', () => {
        const players = [makePlayer('a', { seat_index: 0 }), makePlayer('b', { seat_index: 1 })];
        expect(game.getNextBettingPlayer(players, 0, { a: true, b: true })).toBeNull();
    });
});
