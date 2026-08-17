/**
 * Throwaway smoke test: 2 human players joining the same room -> should
 * auto-fill exactly 2 bots (not 3), plus a mid-lobby disconnect/reconnect
 * check for player A. Deleted after use, not a permanent fixture.
 */
import WebSocket from 'ws';

const URL = process.env.SMOKE_URL || 'ws://localhost:8123/ws';
const A_ID = 'smoke-a-' + Math.random().toString(36).slice(2, 8);
const B_ID = 'smoke-b-' + Math.random().toString(36).slice(2, 8);

function log(...a) { console.log('[smoke-2p]', ...a); }
function fail(msg) { console.error('[smoke-2p] FAIL:', msg); process.exit(1); }

let roomCode = null;
let aReconnected = false;
let bJoined = false;
let botCountVerified = false;
let aSessionToken = null;

let wsA = new WebSocket(URL);
let wsB;

wsA.on('open', () => {
    log('A connecting, creating room...');
    wsA.send(JSON.stringify({ type: 'create_room', playerId: A_ID, name: 'PlayerA' }));
});

wsA.on('message', (raw) => {
    const data = JSON.parse(raw.toString());
    if (data.type === 'error') { fail('A got error: ' + data.message); return; }
    if (data.type !== 'state') return;
    if (data.sessionToken) aSessionToken = data.sessionToken;

    if (!roomCode) {
        roomCode = data.room.code;
        log('room created:', roomCode);
        wsA.send(JSON.stringify({ type: 'set_ready', ready: true }));

        // Now bring B in
        wsB = new WebSocket(URL);
        wsB.on('open', () => {
            wsB.send(JSON.stringify({ type: 'join_room', playerId: B_ID, name: 'PlayerB', roomCode }));
        });
        wsB.on('message', (raw2) => {
            const d2 = JSON.parse(raw2.toString());
            if (d2.type === 'error') { fail('B got error: ' + d2.message); return; }
            if (d2.type !== 'state') return;
            if (!bJoined && d2.players.length === 2) {
                bJoined = true;
                log('B joined, 2 players in lobby');
                wsB.send(JSON.stringify({ type: 'set_ready', ready: true }));
                setTimeout(() => wsA.send(JSON.stringify({ type: 'start_game' })), 200);
            }
            if (d2.room.status === 'in_game' && !botCountVerified) {
                verifyBots(d2);
            }
        });
        return;
    }

    if (data.room.status === 'in_game' && !botCountVerified) {
        verifyBots(data);
    }
});

function verifyBots(data) {
    botCountVerified = true;
    const bots = data.players.filter(p => p.is_bot);
    const humans = data.players.filter(p => !p.is_bot);
    log(`players: ${data.players.length} total, ${humans.length} human, ${bots.length} bot`);
    if (humans.length !== 2) fail(`expected 2 humans, got ${humans.length}`);
    if (bots.length !== 2) fail(`expected 2 bots for a 2-human game, got ${bots.length}`);
    log('PASS: 2 humans -> exactly 2 bots auto-filled');

    // Now test reconnection: drop A's socket mid-game, then rejoin
    log('dropping A connection to test reconnect...');
    wsA.terminate();

    setTimeout(() => {
        const wsA2 = new WebSocket(URL);
        wsA2.on('open', () => {
            wsA2.send(JSON.stringify({ type: 'rejoin', playerId: A_ID, roomCode, sessionToken: aSessionToken }));
        });
        wsA2.on('message', (raw3) => {
            const d3 = JSON.parse(raw3.toString());
            if (d3.type === 'error') { fail('A rejoin got error: ' + d3.message); return; }
            if (d3.type === 'state' && !aReconnected) {
                aReconnected = true;
                log('PASS: A reconnected and received state, hand length =', d3.yourHand.length);
                log('ALL CHECKS PASSED');
                wsA2.close();
                wsB.close();
                process.exit(0);
            }
        });
    }, 1500); // within the 30s disconnect grace period
}

setTimeout(() => {
    if (!aReconnected) fail('Timed out before reconnect completed');
}, 30000);
