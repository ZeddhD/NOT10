/**
 * In-memory room/session layer for NOT10.
 * Owns rooms, WebSocket connections, reconnection, bot control, and
 * cleanup. Calls into engine/ for all game rules and contains none of
 * them itself - this is the "thin session/network layer" the pure engine
 * knows nothing about.
 *
 * Security model: hands are held only in server memory (Room.hands) and a
 * per-connection broadcast only ever includes the recipient's own hand -
 * the server builds each client's view, rather than sending everything
 * and trusting the client to hide the rest.
 */

import * as game from '../engine/game.js';
import * as ai from '../engine/ai.js';
import * as utils from '../engine/utils.js';

const DISCONNECT_GRACE_MS = 30_000;
const IDLE_ROOM_REAP_MS = 2 * 60 * 60 * 1000; // 2 hours
const REAP_CHECK_MS = 5 * 60 * 1000;
const TURN_TICK_MS = 1000;
const BOT_PERSONALITIES = ['cautious', 'balanced', 'aggressive'];
const FALLBACK_PERSONALITY = 'cautious'; // used to auto-pilot a disconnected human

// Matches the personality descriptions in the in-app help modal (Carl the
// cautious bot, Betty the balanced bot, Alex the aggressive bot) so a
// player who reads "how to play" recognizes the names at the table.
const BOT_NAMES = { cautious: 'Carl', balanced: 'Betty', aggressive: 'Alex' };

function botName(personality) {
    return BOT_NAMES[personality] || 'Bot';
}

class Room {
    constructor(code, hostId) {
        this.code = code;
        this.room = {
            code,
            host_id: hostId,
            status: 'lobby', // 'lobby' | 'in_game' | 'finished'
            current_round: 0,
            starting_player_index: Math.floor(Math.random() * game.GAME_CONSTANTS.MAX_PLAYERS),
            pot_cents: 0,
            table_total: 0,
            phase: 'lobby', // 'lobby' | 'betting' | 'playing' | 'round_end'
            turn_player_id: null
        };
        this.players = [];
        this.roundState = null;
        this.hands = new Map(); // playerId -> number[] (server-only, never fully broadcast)
        this.sockets = new Map(); // playerId -> ws
        this.disconnectTimers = new Map(); // playerId -> Timeout
        this.lastActivity = Date.now();
        this.turnLoopBusy = false; // re-entrancy guard for the per-room tick
        this.positionChoiceBusy = false;
    }

    touch() {
        this.lastActivity = Date.now();
    }
}

export class RoomManager {
    constructor() {
        this.rooms = new Map(); // code -> Room
        this.socketMeta = new Map(); // ws -> { code, playerId }

        this.turnInterval = setInterval(() => this._tickAll(), TURN_TICK_MS);
        this.reapInterval = setInterval(() => this._reapIdleRooms(), REAP_CHECK_MS);
    }

    stop() {
        clearInterval(this.turnInterval);
        clearInterval(this.reapInterval);
    }

    // ==========================================
    // CONNECTION LIFECYCLE
    // ==========================================

    handleMessage(ws, raw) {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            this._sendError(ws, 'Malformed message');
            return;
        }

        try {
            switch (msg.type) {
                case 'create_room': return this._createRoom(ws, msg);
                case 'join_room': return this._joinRoom(ws, msg);
                case 'rejoin': return this._rejoin(ws, msg);
                case 'set_ready': return this._setReady(ws, msg);
                case 'start_game': return this._startGame(ws);
                case 'bet': return this._handleBet(ws, msg);
                case 'choose_position': return this._handleChoosePosition(ws, msg);
                case 'play_card': return this._handlePlayCard(ws, msg);
                case 'leave_room': return this._leaveRoom(ws);
                case 'play_again': return this._playAgain(ws);
                default:
                    this._sendError(ws, `Unknown message type: ${msg.type}`);
            }
        } catch (err) {
            console.error('Error handling message', msg?.type, err);
            this._sendError(ws, 'Internal server error');
        }
    }

    handleDisconnect(ws) {
        const meta = this.socketMeta.get(ws);
        if (!meta) return;
        this.socketMeta.delete(ws);

        const room = this.rooms.get(meta.code);
        if (!room) return;

        room.sockets.delete(meta.playerId);
        const player = room.players.find(p => p.id === meta.playerId);
        if (player) player.connected = false;
        this._broadcast(room);

        const timer = setTimeout(() => this._resolveDisconnect(room, meta.playerId), DISCONNECT_GRACE_MS);
        room.disconnectTimers.set(meta.playerId, timer);
    }

    _resolveDisconnect(room, playerId) {
        room.disconnectTimers.delete(playerId);
        if (room.sockets.has(playerId)) return; // reconnected during the grace period

        const player = room.players.find(p => p.id === playerId);
        if (!player) return;

        if (room.room.status === 'in_game') {
            // Mid-game: leave them seated but server-piloted (see _tick) rather
            // than removing them, which would corrupt turn order / bet counts.
            player.connected = false;
            this._broadcast(room);
        } else {
            // Lobby or finished: same as leaving voluntarily.
            this._removePlayer(room, playerId);
        }
    }

    // ==========================================
    // ROOM / LOBBY
    // ==========================================

    _createRoom(ws, { playerId, name }) {
        const nameCheck = utils.validatePlayerName(name);
        if (!nameCheck.valid) return this._sendError(ws, nameCheck.error);

        let code;
        do {
            code = utils.generateRoomCode();
        } while (this.rooms.has(code));

        const room = new Room(code, playerId);
        room.players.push({
            id: playerId,
            name: name.trim(),
            seat_index: 0,
            money_cents: game.GAME_CONSTANTS.STARTING_MONEY,
            status: 'active',
            is_ready: false,
            is_bot: false,
            connected: true
        });

        this.rooms.set(code, room);
        this._attachSocket(room, ws, playerId);
        this._broadcast(room);
    }

    _joinRoom(ws, { playerId, name, roomCode }) {
        const nameCheck = utils.validatePlayerName(name);
        if (!nameCheck.valid) return this._sendError(ws, nameCheck.error);

        const room = this.rooms.get((roomCode || '').toUpperCase());
        if (!room) return this._sendError(ws, 'Room not found');
        if (room.room.status !== 'lobby') return this._sendError(ws, 'Game already in progress');

        const takenSeats = room.players.map(p => p.seat_index);
        let seatIndex = -1;
        for (let i = 0; i < game.GAME_CONSTANTS.MAX_PLAYERS; i++) {
            if (!takenSeats.includes(i)) { seatIndex = i; break; }
        }
        if (seatIndex === -1) return this._sendError(ws, 'Room is full (4 players max)');

        room.players.push({
            id: playerId,
            name: name.trim(),
            seat_index: seatIndex,
            money_cents: game.GAME_CONSTANTS.STARTING_MONEY,
            status: 'active',
            is_ready: false,
            is_bot: false,
            connected: true
        });

        this._attachSocket(room, ws, playerId);
        this._broadcast(room);
    }

    _rejoin(ws, { playerId, roomCode }) {
        const room = this.rooms.get((roomCode || '').toUpperCase());
        if (!room) return this._sendError(ws, 'Room not found', { reason: 'rejoin_failed' });

        const player = room.players.find(p => p.id === playerId);
        if (!player) return this._sendError(ws, 'You are not in this room', { reason: 'rejoin_failed' });

        const timer = room.disconnectTimers.get(playerId);
        if (timer) {
            clearTimeout(timer);
            room.disconnectTimers.delete(playerId);
        }

        player.connected = true;
        this._attachSocket(room, ws, playerId);
        this._broadcast(room);
    }

    _attachSocket(room, ws, playerId) {
        room.sockets.set(playerId, ws);
        this.socketMeta.set(ws, { code: room.code, playerId });
        room.touch();
    }

    _setReady(ws, { ready }) {
        const { room, player } = this._requirePlayer(ws);
        if (!room) return;
        player.is_ready = !!ready;
        room.touch();
        this._broadcast(room);
    }

    _leaveRoom(ws) {
        const meta = this.socketMeta.get(ws);
        if (!meta) return;
        const room = this.rooms.get(meta.code);
        if (!room) return;

        room.sockets.delete(meta.playerId);
        this.socketMeta.delete(ws);
        this._removePlayer(room, meta.playerId);
    }

    _removePlayer(room, playerId) {
        const wasHost = room.room.host_id === playerId;
        room.players = room.players.filter(p => p.id !== playerId);
        room.hands.delete(playerId);

        if (room.players.length === 0) {
            this.rooms.delete(room.code);
            return;
        }

        if (wasHost) {
            // Promote the next remaining human, falling back to whoever's left
            const nextHost = room.players.find(p => !p.is_bot) || room.players[0];
            room.room.host_id = nextHost.id;
        }

        room.touch();
        this._broadcast(room);
    }

    // ==========================================
    // GAME START
    // ==========================================

    _startGame(ws) {
        const { room, player } = this._requirePlayer(ws);
        if (!room) return;
        if (room.room.host_id !== player.id) return this._sendError(ws, 'Only the host can start the game');

        const readyHumans = room.players.filter(p => !p.is_bot && p.is_ready);
        if (readyHumans.length < 1) return this._sendError(ws, 'Need at least 1 ready player to start');

        // Auto-fill missing seats with bots (target 4 total), personality randomized
        const occupiedSeats = room.players.map(p => p.seat_index);
        const missingSeats = [];
        for (let i = 0; i < game.GAME_CONSTANTS.MAX_PLAYERS; i++) {
            if (!occupiedSeats.includes(i)) missingSeats.push(i);
        }
        const personalities = utils.shuffleArray(BOT_PERSONALITIES);
        missingSeats.forEach((seatIndex, idx) => {
            const personality = personalities[idx % personalities.length];
            room.players.push({
                id: `bot_${room.code}_${seatIndex}`,
                name: botName(personality),
                seat_index: seatIndex,
                money_cents: game.GAME_CONSTANTS.STARTING_MONEY,
                status: 'active',
                is_ready: true,
                is_bot: true,
                personality,
                connected: true
            });
        });

        room.room.status = 'in_game';
        room.room.current_round = 0;
        this._startRound(room);
    }

    _startRound(room) {
        const result = game.startNewRound(room.room, room.players);

        if (result.gameOver) {
            room.room.status = 'finished';
            room.touch();
            this._broadcast(room, { winner: result.winner });
            return;
        }

        room.roundState = result.roundState;
        room.hands = new Map(Object.entries(result.hands));
        room.touch();
        this._broadcast(room);
    }

    // ==========================================
    // BETTING
    // ==========================================

    _handleBet(ws, { action, amount }) {
        const { room, player } = this._requirePlayer(ws);
        if (!room || !room.roundState) return;

        const result = game.processBet(room.room, room.players, room.roundState, player.id, action, amount);
        if (!result.success) return this._sendError(ws, result.error);

        room.touch();
        this._advanceBetting(room, player.id);
    }

    /**
     * After any successful bet action, either hand the turn to the next
     * player who hasn't finalized, or - once everyone has - transition to
     * the playing phase. Runs entirely server-side, so there's exactly one
     * authoritative turn_player_id, no client-side races.
     */
    _advanceBetting(room, actingPlayerId) {
        const activePlayers = room.players.filter(p => p.status === 'active');

        if (game.isBettingComplete(activePlayers, room.roundState.finalized_json)) {
            game.transitionToPlaying(room.room, activePlayers, room.roundState);
        } else {
            const actingPlayer = room.players.find(p => p.id === actingPlayerId);
            const nextPlayer = actingPlayer
                ? game.getNextBettingPlayer(activePlayers, actingPlayer.seat_index, room.roundState.finalized_json)
                : null;
            if (nextPlayer) {
                room.room.turn_player_id = nextPlayer.id;
            }
        }

        this._broadcast(room);
    }

    _handleChoosePosition(ws, { choice }) {
        const { room, player } = this._requirePlayer(ws);
        if (!room || !room.roundState) return;
        if (!room.roundState.awaiting_position_choice) return this._sendError(ws, 'No position choice pending');
        if (room.roundState.highest_bettor_id !== player.id) return this._sendError(ws, 'Not your choice to make');

        const activePlayers = room.players.filter(p => p.status === 'active');
        game.applyPositionChoice(room.room, activePlayers, room.roundState, choice === 'first' ? 'first' : 'last');
        room.touch();
        this._broadcast(room);
    }

    // ==========================================
    // PLAYING
    // ==========================================

    _handlePlayCard(ws, { value }) {
        const { room, player } = this._requirePlayer(ws);
        if (!room || !room.roundState) return;

        const result = game.processCardPlay(room.room, room.players, room.roundState, player.id, value);
        if (!result.success) return this._sendError(ws, result.error);

        const hand = room.hands.get(player.id) || [];
        const idx = hand.indexOf(value);
        if (idx > -1) hand.splice(idx, 1);

        room.touch();

        if (result.bust) {
            this._endRound(room, player.id);
        } else {
            this._broadcast(room);
        }
    }

    _endRound(room, eliminatedPlayerId) {
        game.endRound(room.room, room.players, room.roundState, eliminatedPlayerId);
        room.touch();

        const winner = game.checkGameOver(room.players);
        if (winner) {
            room.room.status = 'finished';
            this._broadcast(room, { winner });
            return;
        }

        this._broadcast(room);
        setTimeout(() => {
            if (this.rooms.get(room.code) === room && room.room.status === 'in_game') {
                this._startRound(room);
            }
        }, 3000);
    }

    // ==========================================
    // REMATCH
    // ==========================================

    _playAgain(ws) {
        const { room, player } = this._requirePlayer(ws);
        if (!room) return;
        if (room.room.host_id !== player.id) return this._sendError(ws, 'Only the host can start a new game');

        // Drop bots, reset humans to a fresh lobby state, keep the same room code
        room.players = room.players.filter(p => !p.is_bot).map(p => ({
            ...p,
            money_cents: game.GAME_CONSTANTS.STARTING_MONEY,
            status: 'active',
            is_ready: false
        }));
        room.hands = new Map();
        room.roundState = null;
        room.room.status = 'lobby';
        room.room.phase = 'lobby';
        room.room.current_round = 0;
        room.room.pot_cents = 0;
        room.room.table_total = 0;
        room.room.turn_player_id = null;
        room.room.starting_player_index = Math.floor(Math.random() * game.GAME_CONSTANTS.MAX_PLAYERS);

        room.touch();
        this._broadcast(room);
    }

    // ==========================================
    // BOT / DISCONNECTED-PLAYER AUTOPLAY LOOP
    // ==========================================

    _tickAll() {
        for (const room of this.rooms.values()) {
            this._tick(room).catch(err => console.error(`Turn loop error in room ${room.code}:`, err));
        }
    }

    async _tick(room) {
        if (room.room.status !== 'in_game' || room.turnLoopBusy) return;

        // A bot's turn, or a disconnected human's turn - the server acts for
        // both the same way, so a dropped connection never stalls the game.
        if (room.roundState?.awaiting_position_choice) {
            await this._maybeAutoChoosePosition(room);
            return;
        }

        const turnPlayerId = room.room.turn_player_id;
        if (!turnPlayerId) return;
        const turnPlayer = room.players.find(p => p.id === turnPlayerId);
        if (!turnPlayer || turnPlayer.status !== 'active') return;
        if (turnPlayer.is_bot || !turnPlayer.connected) {
            room.turnLoopBusy = true;
            try {
                if (room.room.phase === 'betting') {
                    await this._autoBet(room, turnPlayer);
                } else if (room.room.phase === 'playing') {
                    await this._autoPlayCard(room, turnPlayer);
                }
            } finally {
                room.turnLoopBusy = false;
            }
        }
    }

    async _autoBet(room, player) {
        const personality = player.personality || FALLBACK_PERSONALITY;
        const aiInstance = new ai.AIPlayer(player.id, player.name, personality, player.seat_index);
        aiInstance.money_cents = player.money_cents;
        aiInstance.hand = room.hands.get(player.id) || [];

        const gameState = { tableTotal: room.room.table_total };
        const decision = await ai.executeAIBet(aiInstance, gameState, room.roundState);

        // Room state may have changed while we were "thinking" (e.g. the
        // player reconnected, or the round already ended) - bail if so.
        if (room.room.status !== 'in_game' || room.room.turn_player_id !== player.id) return;

        const result = game.processBet(
            room.room, room.players, room.roundState, player.id,
            decision.action === 'raise' ? 'bet' : decision.action,
            decision.amount
        );
        if (!result.success) {
            console.error(`Auto-bet failed for ${player.id}:`, result.error);
            return;
        }

        if (decision.shouldFinalize && decision.action !== 'finalize') {
            await utils.sleep(300);
            if (room.room.status !== 'in_game') return;
            const finalizeResult = game.processBet(room.room, room.players, room.roundState, player.id, 'finalize', null);
            if (!finalizeResult.success) {
                console.error(`Auto-finalize failed for ${player.id}:`, finalizeResult.error);
            }
        }

        room.touch();
        this._advanceBetting(room, player.id);
    }

    async _autoPlayCard(room, player) {
        const personality = player.personality || FALLBACK_PERSONALITY;
        const aiInstance = new ai.AIPlayer(player.id, player.name, personality, player.seat_index);
        aiInstance.hand = room.hands.get(player.id) || [];

        if (aiInstance.hand.length === 0) return; // shouldn't happen, but don't crash the loop

        const card = await ai.executeAICardPlay(aiInstance, room.room.table_total);

        if (room.room.status !== 'in_game' || room.room.turn_player_id !== player.id) return;

        const result = game.processCardPlay(room.room, room.players, room.roundState, player.id, card);
        if (!result.success) {
            console.error(`Auto-play failed for ${player.id}:`, result.error);
            return;
        }

        const hand = room.hands.get(player.id) || [];
        const idx = hand.indexOf(card);
        if (idx > -1) hand.splice(idx, 1);

        room.touch();

        if (result.bust) {
            this._endRound(room, player.id);
        } else {
            this._broadcast(room);
        }
    }

    async _maybeAutoChoosePosition(room) {
        if (room.positionChoiceBusy) return;
        const bettorId = room.roundState?.highest_bettor_id;
        const bettor = room.players.find(p => p.id === bettorId);
        if (!bettor || (!bettor.is_bot && bettor.connected)) return; // a connected human chooses themselves

        room.positionChoiceBusy = true;
        try {
            const personality = bettor.personality || FALLBACK_PERSONALITY;
            const aiInstance = new ai.AIPlayer(bettor.id, bettor.name, personality, bettor.seat_index);
            aiInstance.hand = room.hands.get(bettor.id) || [];

            await utils.sleep(1000 + Math.random() * 1500);
            if (!room.roundState?.awaiting_position_choice) return; // resolved while we waited

            const choice = ai.choosePosition(aiInstance, room.room.table_total || 0);
            const activePlayers = room.players.filter(p => p.status === 'active');
            game.applyPositionChoice(room.room, activePlayers, room.roundState, choice);
            room.touch();
            this._broadcast(room);
        } finally {
            room.positionChoiceBusy = false;
        }
    }

    // ==========================================
    // CLEANUP
    // ==========================================

    _reapIdleRooms() {
        const now = Date.now();
        for (const [code, room] of this.rooms) {
            if (room.sockets.size === 0 && now - room.lastActivity > IDLE_ROOM_REAP_MS) {
                for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
                this.rooms.delete(code);
            }
        }
    }

    // ==========================================
    // HELPERS
    // ==========================================

    _requirePlayer(ws) {
        const meta = this.socketMeta.get(ws);
        if (!meta) {
            this._sendError(ws, 'Not connected to a room');
            return {};
        }
        const room = this.rooms.get(meta.code);
        if (!room) {
            this._sendError(ws, 'Room no longer exists');
            return {};
        }
        const player = room.players.find(p => p.id === meta.playerId);
        if (!player) {
            this._sendError(ws, 'You are not in this room');
            return {};
        }
        return { room, player };
    }

    _sendError(ws, message, extra = {}) {
        this._send(ws, { type: 'error', message, ...extra });
    }

    _send(ws, payload) {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(payload));
        }
    }

    /**
     * Broadcast personalized state to every connected client in a room -
     * each player's payload includes only their own hand, never anyone
     * else's (bots' hands are never sent to any client).
     */
    _broadcast(room, extra = {}) {
        for (const [playerId, ws] of room.sockets) {
            this._send(ws, {
                type: 'state',
                room: room.room,
                players: room.players,
                roundState: room.roundState,
                yourHand: room.hands.get(playerId) || [],
                isHost: room.room.host_id === playerId,
                ...extra
            });
        }
    }
}
