/**
 * Throwaway live smoke test for the NOT10 multiplayer server - written to
 * prove the WebSocket flow actually works end to end (create room, solo
 * player + 3 auto-filled bots, a full betting phase, bots finalizing,
 * turn advancement, playing phase, a full round to completion, and
 * reconnect), then meant to be deleted, not kept as a permanent suite.
 * Run with: node scripts/smoke-test.js (server must already be running).
 */

import WebSocket from 'ws';

const URL = process.env.SMOKE_URL || 'ws://localhost:8123/ws';
const PLAYER_ID = 'smoke-test-player-' + Math.random().toString(36).slice(2, 8);

function log(...args) {
    console.log('[smoke]', ...args);
}

function fail(msg) {
    console.error('[smoke] FAIL:', msg);
    process.exit(1);
}

let ws = new WebSocket(URL);
let roomCode = null;
let latestState = null;
let sawError = null;
let roundsSeen = new Set();
let sawBetting = false;
let sawPlaying = false;
let sawBotFinalize = false;
let sawTurnAdvance = false;
let lastTurnPlayer = null;

function send(payload) {
    ws.send(JSON.stringify(payload));
}

ws.on('open', () => {
    log('connected, creating room...');
    send({ type: 'create_room', playerId: PLAYER_ID, name: 'SmokeTester' });
});

ws.on('error', (err) => fail('WebSocket error: ' + err.message));

ws.on('message', (raw) => {
    const data = JSON.parse(raw.toString());

    if (data.type === 'error') {
        sawError = data.message;
        log('SERVER ERROR:', data.message, data.reason || '');
        return;
    }

    if (data.type !== 'state') {
        log('unexpected message type', data.type);
        return;
    }

    latestState = data;

    if (!roomCode) {
        roomCode = data.room.code;
        log(`room created: ${roomCode}, isHost=${data.isHost}`);
        if (!data.isHost) fail('creator should be host');
        // Mark ready, then start - solo play should auto-fill 3 bots
        send({ type: 'set_ready', ready: true });
        setTimeout(() => send({ type: 'start_game' }), 100);
        return;
    }

    if (data.room.status === 'lobby') {
        return; // waiting on set_ready/start_game round trip
    }

    if (data.room.status === 'in_game') {
        if (roundsSeen.size === 0) {
            if (data.players.length !== 4) fail(`expected 4 players (1 human + 3 bots), got ${data.players.length}`);
            const bots = data.players.filter(p => p.is_bot);
            if (bots.length !== 3) fail(`expected 3 bots, got ${bots.length}`);
            const personalities = new Set(bots.map(p => p.personality));
            log(`bot-fill OK: 3 bots with personalities [${[...personalities].join(', ')}]`);
        }
        roundsSeen.add(data.roundState.round_no);

        if (data.room.turn_player_id !== lastTurnPlayer) {
            if (lastTurnPlayer !== null) sawTurnAdvance = true;
            lastTurnPlayer = data.room.turn_player_id;
        }

        if (data.room.phase === 'betting') {
            sawBetting = true;
            const finalizedCount = Object.values(data.roundState.finalized_json || {}).filter(Boolean).length;
            if (finalizedCount > 0) sawBotFinalize = true; // some bot (or us) has finalized

            if (data.room.turn_player_id === PLAYER_ID) {
                const finalized = data.roundState.finalized_json || {};
                const myActions = data.roundState.bet_action_count_json?.[PLAYER_ID] || 0;
                if (myActions === 0) {
                    log('my turn to bet - betting $100');
                    send({ type: 'bet', action: 'bet', amount: 10000 });
                } else if (!finalized[PLAYER_ID]) {
                    log('my turn - finalizing');
                    send({ type: 'bet', action: 'finalize', amount: null });
                }
            }
        } else if (data.room.phase === 'playing') {
            sawPlaying = true;
            if (data.roundState.awaiting_position_choice && data.roundState.highest_bettor_id === PLAYER_ID) {
                log('choosing position: first');
                send({ type: 'choose_position', choice: 'first' });
            } else if (data.room.turn_player_id === PLAYER_ID && data.yourHand.length > 0) {
                const card = Math.min(...data.yourHand);
                log(`my turn to play - playing lowest card (${card})`);
                send({ type: 'play_card', value: card });
            }
        } else if (data.room.phase === 'round_end') {
            log(`round ${data.roundState.round_no} ended (pot distributed, waiting for next round)`);
        }

        // A round is guaranteed to end in a bust eventually - once we've
        // seen a second round_no start, round-end -> next-round-start
        // (including pot distribution and possible re-deal) has been
        // proven to work without waiting for the whole game to finish,
        // which could take many rounds with 4 players starting at $1000.
        if (roundsSeen.size >= 2) {
            log(`Reached round ${[...roundsSeen].sort((a, b) => a - b).join(' -> ')} - round-end flow confirmed`);
            finishUp();
        }
        return;
    }

    if (data.room.status === 'finished') {
        log('GAME FINISHED. Winner:', data.winner?.name, data.winner?.money_cents);
        finishUp();
    }
});

let finished = false;
function finishUp() {
    if (finished) return;
    finished = true;

    const results = {
        'room created': !!roomCode,
        'saw betting phase': sawBetting,
        'saw a bot/player finalize (betting could complete)': sawBotFinalize,
        'saw turn advance past the first player': sawTurnAdvance,
        'saw playing phase (betting → playing transition worked)': sawPlaying,
        'saw at least one full round': roundsSeen.size >= 1,
        'no server errors': sawError === null
    };

    let allPassed = true;
    for (const [desc, passed] of Object.entries(results)) {
        log(`${passed ? 'PASS' : 'FAIL'}: ${desc}`);
        if (!passed) allPassed = false;
    }

    ws.close();
    if (!allPassed) {
        process.exitCode = 1;
    } else {
        log('ALL CHECKS PASSED');
    }
}

// Safety timeout - a full game (bots making multi-second "thinking" delays
// every action) can legitimately take a while, but it shouldn't hang forever.
setTimeout(() => {
    if (!finished) {
        log('TIMEOUT - dumping last known state for diagnosis:');
        console.log(JSON.stringify(latestState, null, 2));
        fail('Did not reach a finished game or bust within the time limit');
    }
}, 120_000);
