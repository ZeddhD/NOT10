/**
 * Integration tests for the server/bot layer (server/rooms.js driving
 * engine/game.js + engine/ai.js over real WebSocket connections).
 *
 * Every bug this suite exists to catch was previously found only by a
 * human playing the deployed game and noticing something froze: a bot
 * escaping via an illegal 'finalize' before its first action, ALL-IN/a
 * money-emptying bet never auto-finalizing, GO FIRST/LAST only holding
 * for the round's first card, and a second tab for the same player
 * silently orphaning the first. None of that lived in engine/game.js's
 * unit tests, because the bugs were in how rooms.js/ai.js wire the pure
 * engine together over time and multiple connections - exactly what
 * this file checks going forward.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from '../server/rooms.js';

let server, wss, roomManager, port;

beforeAll(async () => {
    roomManager = new RoomManager();
    server = http.createServer();
    wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws) => {
        ws.on('message', (raw) => roomManager.handleMessage(ws, raw));
        ws.on('close', () => roomManager.handleDisconnect(ws));
    });
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
});

afterAll(async () => {
    roomManager.stop();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
});

function client() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const queue = [];
    const waiters = [];
    ws.on('message', (raw) => {
        const data = JSON.parse(raw.toString());
        const waiter = waiters.find(w => w.predicate(data));
        if (waiter) {
            waiters.splice(waiters.indexOf(waiter), 1);
            waiter.resolve(data);
        } else {
            queue.push(data);
        }
    });
    return {
        ws,
        ready: new Promise((resolve) => ws.on('open', resolve)),
        send: (msg) => ws.send(JSON.stringify(msg)),
        // Discards anything already buffered - use right before an action
        // whose *resulting* broadcast you're about to wait for, so a
        // loosely-matching predicate can't grab a stale message left over
        // from waiting through earlier (e.g. other players'/bots') turns.
        drain() { queue.length = 0; },
        waitFor(predicate, timeoutMs = 5000) {
            const buffered = queue.find(predicate);
            if (buffered) {
                queue.splice(queue.indexOf(buffered), 1);
                return Promise.resolve(buffered);
            }
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('waitFor timed out')), timeoutMs);
                waiters.push({ predicate, resolve: (d) => { clearTimeout(timer); resolve(d); } });
            });
        },
        close: () => ws.close()
    };
}

async function soloGame(playerId = 'p-' + Math.random().toString(36).slice(2, 8)) {
    const c = client();
    await c.ready;
    c.send({ type: 'create_room', playerId, name: 'Solo' });
    const created = await c.waitFor(d => d.type === 'state' && d.room?.status === 'lobby');
    const roomCode = created.room.code;
    c.send({ type: 'set_ready', ready: true });
    c.send({ type: 'start_game' });
    // starting_player_index is randomized - a bot may legitimately act
    // first (and now that processBet enforces turn order, it must be
    // actually our turn before this helper's callers act as the human).
    const state = await c.waitFor(
        d => d.type === 'state' && d.room?.status === 'in_game' && d.room.turn_player_id === playerId,
        15000
    );
    return { c, playerId, roomCode, state };
}

describe('solo Play vs AI room setup', () => {
    it('auto-fills exactly 3 bots named Carl/Betty/Alex with distinct personalities', async () => {
        const { c, state } = await soloGame();
        const bots = state.players.filter(p => p.is_bot);
        expect(bots).toHaveLength(3);
        expect(bots.map(b => b.name).sort()).toEqual(['Alex', 'Betty', 'Carl']);
        expect(new Set(bots.map(b => b.personality)).size).toBe(3);
        c.close();
    }, 15000);
});

describe('ALL-IN / money-emptying bet auto-finalize (the reported freeze)', () => {
    it('ALL-IN auto-finalizes and the turn moves off the player immediately', async () => {
        const { c, playerId, state } = await soloGame();
        expect(state.room.turn_player_id).toBe(playerId);
        c.drain();
        c.send({ type: 'bet', action: 'all-in', amount: null });
        const after = await c.waitFor(d => d.type === 'state' && d.roundState && d.room?.turn_player_id !== playerId);
        expect(after.roundState.finalized_json[playerId]).toBe(true);
        c.close();
    }, 15000);

    it('a regular BET that exactly empties the stack also auto-finalizes', async () => {
        const { c, playerId, roomCode } = await soloGame();
        // Force the player down to exactly $100 so a normal +$100 bet zeroes them.
        const room = roomManager.rooms.get(roomCode);
        room.players.find(p => p.id === playerId).money_cents = 10000;

        c.drain();
        c.send({ type: 'bet', action: 'bet', amount: 10000 });
        const after = await c.waitFor(d => d.type === 'state' && d.roundState && d.room?.turn_player_id !== playerId);
        expect(after.roundState.finalized_json[playerId]).toBe(true);
        c.close();
    }, 15000);
});

describe('GO FIRST/LAST play order holds for the whole round', () => {
    it('bets big enough to win position choice, goes first, and turn order after that follows play_order, not seat_index', async () => {
        const { c, playerId, roomCode, state } = await soloGame();
        // Give ourselves strictly more money than any bot can possibly bet
        // (bots start at the same $1000 as us) so ALL-IN deterministically
        // wins highest-bettor with no risk of a tie against bot randomness.
        const room = roomManager.rooms.get(roomCode);
        room.players.find(p => p.id === playerId).money_cents = 200000;

        c.drain();
        c.send({ type: 'bet', action: 'all-in', amount: null }); // also auto-finalizes

        const positionOffer = await c.waitFor(
            d => d.type === 'state' && d.roundState?.awaiting_position_choice && d.roundState?.highest_bettor_id === playerId,
            15000
        );
        expect(positionOffer).toBeTruthy();
        c.drain();
        c.send({ type: 'choose_position', choice: 'first' });

        const playing = await c.waitFor(d => d.type === 'state' && d.room?.phase === 'playing');
        expect(playing.room.turn_player_id).toBe(playerId);
        expect(playing.roundState.play_order[0]).toBe(playerId);

        // Play a card and confirm the NEXT turn is play_order[1], not whatever
        // raw seat_index adjacency from this player's seat would have produced.
        const card = Math.min(...playing.yourHand);
        c.drain();
        c.send({ type: 'play_card', value: card });
        const afterPlay = await c.waitFor(d => d.type === 'state' && d.roundState && d.room?.turn_player_id !== playerId);
        expect(afterPlay.room.turn_player_id).toBe(playing.roundState.play_order[1]);
        c.close();
    }, 25000);
});

describe('leaving mid-game does not freeze the room for everyone else', () => {
    it('room keeps progressing (round advances) after a human leaves mid-round', async () => {
        const a = client();
        const b = client();
        await Promise.all([a.ready, b.ready]);

        a.send({ type: 'create_room', playerId: 'la', name: 'A' });
        const created = await a.waitFor(d => d.type === 'state' && d.room?.status === 'lobby');
        const roomCode = created.room.code;
        a.send({ type: 'set_ready', ready: true });

        b.send({ type: 'join_room', playerId: 'lb', name: 'B', roomCode });
        await b.waitFor(d => d.type === 'state' && d.players?.length === 2);
        b.send({ type: 'set_ready', ready: true });
        a.send({ type: 'start_game' });

        await b.waitFor(d => d.type === 'state' && d.room?.status === 'in_game');
        a.send({ type: 'leave_room' });

        // B must actually play its own turns - a human turn only ever
        // advances on real input, same as a real client - or this proves
        // nothing beyond "bots kept ticking," which isn't the claim here.
        let roundsSeen = new Set();
        let finished = false;
        const deadline = Date.now() + 35000;
        while (Date.now() < deadline && roundsSeen.size < 2 && !finished) {
            const d = await b.waitFor(d => d.type === 'state', 15000);
            if (d.roundState) roundsSeen.add(d.roundState.round_no);
            if (d.room?.status === 'finished') finished = true;
            if (d.room?.turn_player_id === 'lb') {
                if (d.room.phase === 'betting') {
                    // There's no free check - if nobody's bet yet this
                    // round, 'call' is rejected (no new state follows,
                    // which would otherwise hang this loop forever). Bet
                    // for real when B is first to act, call otherwise.
                    const tableHighest = Math.max(0, ...Object.values(d.roundState?.bets_json || {}));
                    if (tableHighest === 0) {
                        b.send({ type: 'bet', action: 'bet', amount: 10000 });
                    } else {
                        b.send({ type: 'bet', action: 'call', amount: null });
                    }
                } else if (d.room.phase === 'playing' && d.yourHand?.length) {
                    b.send({ type: 'play_card', value: Math.min(...d.yourHand) });
                }
            }
            if (d.roundState?.awaiting_position_choice && d.roundState?.highest_bettor_id === 'lb') {
                b.send({ type: 'choose_position', choice: 'last' });
            }
        }
        // The point is "did it keep progressing", not "did it reach exactly
        // 2 rounds in this window" - either a second round or the game
        // actually finishing (a short game is possible) proves that.
        expect(roundsSeen.size >= 2 || finished).toBe(true);
        a.close();
        b.close();
    }, 40000);
});

describe('duplicate connection for the same player', () => {
    it('closes the older socket with code 4001 instead of leaving it silently orphaned', async () => {
        const first = client();
        await first.ready;
        const playerId = 'dup-' + Math.random().toString(36).slice(2, 8);
        first.send({ type: 'create_room', playerId, name: 'Dup' });
        const created = await first.waitFor(d => d.type === 'state');
        const roomCode = created.room.code;
        const sessionToken = created.sessionToken;

        const closeCode = new Promise((resolve) => first.ws.on('close', resolve));

        const second = client();
        await second.ready;
        second.send({ type: 'rejoin', playerId, roomCode, sessionToken });
        await second.waitFor(d => d.type === 'state');

        expect(await closeCode).toBe(4001);
        second.close();
    });
});

describe('rejoin requires the real session token', () => {
    it('rejects a rejoin with a wrong/missing token instead of handing over the seat', async () => {
        const owner = client();
        await owner.ready;
        const playerId = 'hijack-' + Math.random().toString(36).slice(2, 8);
        owner.send({ type: 'create_room', playerId, name: 'Owner' });
        const created = await owner.waitFor(d => d.type === 'state');
        const roomCode = created.room.code;

        const attacker = client();
        await attacker.ready;
        attacker.send({ type: 'rejoin', playerId, roomCode, sessionToken: 'not-the-real-token' });
        const rejected = await attacker.waitFor(d => d.type === 'error');
        expect(rejected.reason).toBe('rejoin_failed');

        owner.close();
        attacker.close();
    });
});

describe('hands exhausted without a bust ends the round as a push, not a freeze', () => {
    it('ends the round (new round starts) instead of stalling on an empty-handed turn', async () => {
        const { c, playerId, roomCode, state } = await soloGame();
        const room = roomManager.rooms.get(roomCode);

        // Force every active player's hand empty right now, then finalize
        // betting so play begins with nothing left to play. Also empty the
        // deck - otherwise dealRemainingHands (which tops every hand back
        // up to full size once the position choice below resolves, as it
        // does on every real round) would just refill what we just forced
        // empty from the still-full deck.
        for (const p of room.players.filter(p => p.status === 'active')) {
            room.hands.set(p.id, []);
        }
        room.deck = [];

        c.drain();
        c.send({ type: 'bet', action: 'all-in', amount: null }); // also auto-finalizes - guaranteed highest bettor

        // Going all-in also makes us the highest bettor, so the game will
        // wait on OUR position choice before it can even reach the empty
        // hands - drive that like a real client would, same as any other
        // human-must-act point.
        const positionOffer = await c.waitFor(
            d => d.type === 'state' && d.roundState?.awaiting_position_choice && d.roundState?.highest_bettor_id === playerId,
            15000
        );
        expect(positionOffer).toBeTruthy();
        c.send({ type: 'choose_position', choice: 'last' });

        const roundEndedOrNew = await c.waitFor(
            d => d.type === 'state' && (d.room?.phase === 'round_end' || d.roundState?.round_no > state.roundState.round_no),
            15000
        );
        expect(roundEndedOrNew).toBeTruthy();
        c.close();
    }, 25000);
});
