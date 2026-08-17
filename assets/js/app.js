/**
 * Main app controller for NOT10
 * Handles routing, state management, and coordination between modules
 */

import * as ui from './ui.js';
import * as utils from './utils.js';
import * as storage from './storage.js';
import * as wsClient from './wsClient.js';
import * as sound from './sound.js';
import * as game from '../../engine/game.js';

// Global app state. There is only one game mode now - the server is always
// authoritative. "Play vs AI" is just a shortcut that creates a room and
// auto-starts it solo (see autoStartSolo below); it is not a separate
// client-side game engine.
const appState = {
    currentUser: {
        playerId: null,
        name: null
    },
    roomCode: null,
    isHost: false,
    room: null,
    players: [],
    roundState: null,
    myHand: [],
    // When true, every time this client lands in a 'lobby' room it
    // immediately readies up and starts the game itself instead of
    // showing the lobby screen - this is what makes "Play vs AI" behave
    // exactly like a host who created a lobby alone and let it auto-fill
    // with bots, minus the lobby screen. Persists across "Play Again" so
    // a rematch also auto-starts; cleared on Leave.
    autoStartSolo: false,
    autoStartSent: false
};

// Initialize app
function init() {
    console.log('Initializing NOT10...');

    // Get or create player ID - the same id is reused for multiplayer, since
    // the server is what enforces "only you see your own hand" now, not an
    // external auth/RLS layer, so there's no separate authenticated identity
    // to fetch.
    appState.currentUser.playerId = storage.getOrCreatePlayerId();
    appState.currentUser.name = storage.getPlayerName() || '';

    wsClient.connect(handleServerMessage, handleSocketOpen, handleReplacedElsewhere);

    // Setup event listeners
    setupEventListeners();

    // Setup modals
    ui.setupModal('help-modal', 'close-help-btn');

    ui.setSoundToggleState(sound.isMuted());
    document.getElementById('sound-toggle-btn')?.addEventListener('click', () => {
        ui.setSoundToggleState(sound.toggleMuted());
    });

    // Handle routing
    handleRoute();
    window.addEventListener('hashchange', handleRoute);

    ui.showScreen('menu-screen');
}

/**
 * Runs every time the WebSocket (re)connects, including automatic
 * reconnects after a dropped connection. If we were already in a room
 * (page refresh, or a reconnect mid-session), ask the server to reattach
 * us rather than starting over.
 */
function handleSocketOpen() {
    const savedRoomCode = storage.getRoomCode();
    if (savedRoomCode) {
        const sessionToken = storage.getSession()?.sessionToken;
        wsClient.send({ type: 'rejoin', playerId: appState.currentUser.playerId, roomCode: savedRoomCode, sessionToken });
    }
}

/**
 * Same player ID connected from another tab/window, which just took over
 * the live connection - this tab intentionally will not auto-reconnect
 * (see wsClient.js), so make that visible instead of leaving the screen
 * looking frozen with no explanation.
 */
function handleReplacedElsewhere() {
    ui.showToast('This game is open in another tab/window - this tab has disconnected.', 8000);
}

// Setup all event listeners
function setupEventListeners() {
    // Menu screen
    const nameField = document.getElementById('player-name-field');
    if (nameField) {
        nameField.value = appState.currentUser.name;
        nameField.addEventListener('input', () => {
            appState.currentUser.name = nameField.value.trim();
            storage.savePlayerName(appState.currentUser.name);
            const joinField = document.getElementById('join-player-name');
            if (joinField) joinField.value = appState.currentUser.name;
        });
    }
    document.getElementById('create-lobby-btn')?.addEventListener('click', handleCreateLobby);
    document.getElementById('join-lobby-btn')?.addEventListener('click', () => {
        window.location.hash = '#/join';
    });
    document.getElementById('play-ai-btn')?.addEventListener('click', handlePlayAI);
    document.getElementById('help-btn')?.addEventListener('click', ui.showHelpModal);

    // Join screen - its own name field, kept in sync with the menu screen's
    // so either one can be the first place a player ever types their name.
    const joinNameField = document.getElementById('join-player-name');
    if (joinNameField) {
        joinNameField.value = appState.currentUser.name;
        joinNameField.addEventListener('input', () => {
            appState.currentUser.name = joinNameField.value.trim();
            storage.savePlayerName(appState.currentUser.name);
            if (nameField) nameField.value = appState.currentUser.name;
        });
    }
    document.getElementById('join-room-btn')?.addEventListener('click', handleJoinRoom);
    document.getElementById('back-from-join-btn')?.addEventListener('click', () => {
        window.location.hash = '#/menu';
    });

    // Lobby screen
    document.getElementById('lobby-ready-btn')?.addEventListener('click', handleToggleReady);
    document.getElementById('host-start-btn')?.addEventListener('click', handleStartGame);
    document.getElementById('leave-lobby-btn')?.addEventListener('click', handleLeaveRoom);

    // Copy code button
    document.getElementById('copy-lobby-code-btn')?.addEventListener('click', async () => {
        await ui.copyWithFeedback(appState.roomCode);
    });
    
    // Game screen
    document.getElementById('leave-game-btn')?.addEventListener('click', handleLeaveRoom);
    document.getElementById('clear-log-btn')?.addEventListener('click', ui.clearLog);
    
    // Betting buttons
    document.querySelectorAll('.btn-bet').forEach(btn => {
        btn.addEventListener('click', () => {
            const amount = parseInt(btn.dataset.amount) * 100; // Convert to cents
            handleMultiplayerRaise(amount);
        });
    });
    document.getElementById('call-btn')?.addEventListener('click', handleMultiplayerCall);

    // Finalize button
    document.getElementById('finalize-btn')?.addEventListener('click', handleMultiplayerFinalize);

    // All-in button
    document.getElementById('all-in-btn')?.addEventListener('click', () => {
        const myPlayer = appState.players.find(p => p.id === appState.currentUser.playerId);
        if (myPlayer && myPlayer.money_cents > 0) {
            handleMultiplayerAllIn();
        }
    });

    // Position choice buttons
    document.getElementById('choose-first-btn')?.addEventListener('click', () => handleMultiplayerPositionChoice('first'));
    document.getElementById('choose-last-btn')?.addEventListener('click', () => handleMultiplayerPositionChoice('last'));

    // Game over screen - always server-driven now, so both buttons just
    // send an intent and let the next 'state' broadcast update the UI.
    document.getElementById('play-again-btn')?.addEventListener('click', () => {
        // If this was a solo AI game, re-arm the auto-start so the rematch
        // also skips straight past the lobby screen instead of stopping
        // there with just one seat filled.
        if (appState.autoStartSolo) {
            appState.autoStartSent = false;
        }
        handlePlayAgain();
    });
    document.getElementById('back-to-menu-btn')?.addEventListener('click', handleLeaveRoom);
}

// Routing
function handleRoute() {
    const hash = window.location.hash || '#/menu';
    const path = hash.substring(2); // Remove '#/'
    
    if (path.startsWith('menu')) {
        ui.showScreen('menu-screen');
    } else if (path.startsWith('join')) {
        ui.showScreen('join-screen');
    } else if (path.startsWith('lobby')) {
        // Handled by joinRoom/createLobby
    } else if (path.startsWith('game')) {
        // Handled by startGame
    }
}

// ==========================================
// MULTIPLAYER HANDLERS
// ==========================================

function handleCreateLobby() {
    const playerName = appState.currentUser.name || 'Player';
    appState.autoStartSolo = false;
    storage.savePlayerName(playerName);

    ui.showLoading('Creating lobby...');
    wsClient.send({ type: 'create_room', playerId: appState.currentUser.playerId, name: playerName });

    // The 'state' handler (handleServerMessage) picks up the room code from
    // the server's response and finishes the screen transition, since the
    // server - not this client - decides the actual room code.
}

function handleJoinRoom() {
    const codeInput = document.getElementById('join-room-code');

    const code = codeInput?.value.trim().toUpperCase();
    const name = appState.currentUser.name;

    const nameValidation = utils.validatePlayerName(name);
    if (!nameValidation.valid) {
        ui.showError('join-error', nameValidation.error);
        return;
    }
    if (!code || code.length !== 6) {
        ui.showError('join-error', 'Please enter a valid 6-character room code');
        return;
    }

    ui.hideError('join-error');
    ui.showLoading('Joining room...');

    appState.autoStartSolo = false;
    appState.currentUser.name = name;
    storage.savePlayerName(name);

    wsClient.send({ type: 'join_room', playerId: appState.currentUser.playerId, name, roomCode: code });
}

function handleToggleReady() {
    const myPlayer = appState.players.find(p => p.id === appState.currentUser.playerId);
    if (!myPlayer) return;

    const newReadyState = !myPlayer.is_ready;
    wsClient.send({ type: 'set_ready', ready: newReadyState });

    // Optimistic local update - the authoritative 'state' broadcast follows
    // right behind and will correct this if anything went wrong.
    myPlayer.is_ready = newReadyState;
    const readyBtn = document.getElementById('lobby-ready-btn');
    if (readyBtn) {
        readyBtn.textContent = newReadyState ? 'Not Ready' : 'Ready';
    }
}

function handleStartGame() {
    if (!appState.isHost) return;
    wsClient.send({ type: 'start_game' });
}

function handleLeaveRoom() {
    wsClient.send({ type: 'leave_room' });

    storage.clearRoomCode();
    storage.clearSession();

    appState.roomCode = null;
    appState.room = null;
    appState.players = [];
    appState.roundState = null;
    appState.myHand = [];
    appState.autoStartSolo = false;
    appState.autoStartSent = false;

    window.location.hash = '#/menu';
    ui.showScreen('menu-screen');
}

/**
 * "Play vs AI" - identical to a host creating a lobby alone and letting it
 * auto-fill with 3 bots, minus ever showing the lobby screen: this just
 * creates a room and arms autoStartSolo, which makes handleStateUpdate
 * auto-ready-and-start the moment the (single-player) lobby state arrives.
 */
function handlePlayAI() {
    const playerName = appState.currentUser.name || 'Player';
    appState.autoStartSolo = true;
    appState.autoStartSent = false;
    storage.savePlayerName(playerName);

    ui.showLoading('Setting up your table...');
    wsClient.send({ type: 'create_room', playerId: appState.currentUser.playerId, name: playerName });
}

// ==========================================
// GAME ACTIONS (WebSocket-driven)
// ==========================================
//
// There is almost no logic here: the server (server/rooms.js) is
// authoritative for turn advancement, bot control, and round-end handling
// (including for "Play vs AI" - it's just a solo room like any other).
// This client only sends intents and re-renders whenever a 'state'
// broadcast arrives (handleServerMessage). Design trade-off worth knowing:
// because every update is a full snapshot rather than a granular
// per-action event, you only see a bot's move once it's already resolved -
// whose turn it is right now is shown via the active-turn highlight on
// their player panel.

function handleMultiplayerRaise(amount) {
    sound.playBet();
    wsClient.send({ type: 'bet', action: 'bet', amount });
}

function handleMultiplayerCall() {
    sound.playConfirm();
    wsClient.send({ type: 'bet', action: 'call', amount: null });
}

function handleMultiplayerAllIn() {
    sound.playAllIn();
    wsClient.send({ type: 'bet', action: 'all-in', amount: null });
}

function handleMultiplayerFinalize() {
    sound.playConfirm();
    wsClient.send({ type: 'bet', action: 'finalize', amount: null });
}

function handleMultiplayerCardClick(cardValue) {
    sound.playCard();
    wsClient.send({ type: 'play_card', value: cardValue });
}

function handleMultiplayerPositionChoice(choice) {
    sound.playConfirm();
    wsClient.send({ type: 'choose_position', choice });
}

function handlePlayAgain() {
    wsClient.send({ type: 'play_again' });
}

/**
 * Single entry point for every server push.
 */
function handleServerMessage(data) {
    switch (data.type) {
        case 'state':
            handleStateUpdate(data);
            break;
        case 'error':
            if (data.reason === 'rejoin_failed') {
                storage.clearRoomCode();
                storage.clearSession();
                ui.showScreen('menu-screen');
            } else {
                ui.showToast(data.message);
            }
            break;
        default:
            console.warn('Unhandled server message type:', data.type);
    }
}

function handleStateUpdate(data) {
    const previousRoundNo = appState.roundState?.round_no;
    const previousLogLength = appState.roundState?.log_json?.length || 0;

    appState.room = data.room;
    appState.players = data.players;
    appState.roundState = data.roundState;
    appState.myHand = data.yourHand || [];
    appState.isHost = data.isHost;
    appState.roomCode = data.room.code;

    storage.saveRoomCode(data.room.code);
    // The server's rejoin credential for this player - never sent to
    // anyone but the player it belongs to (see server/rooms.js::_broadcast).
    if (data.sessionToken) storage.saveSession({ sessionToken: data.sessionToken });

    if (data.room.status === 'lobby') {
        // "Play vs AI" shortcut: skip the lobby screen entirely and
        // auto-ready + auto-start, exactly as if a host had created a
        // lobby alone and started it with no one else joining (server
        // auto-fills the other 3 seats with bots either way). Guarded by
        // autoStartSent so the ready-ack's own 'lobby' broadcast doesn't
        // trigger a second start_game.
        if (appState.autoStartSolo && appState.isHost && !appState.autoStartSent) {
            appState.autoStartSent = true;
            wsClient.send({ type: 'set_ready', ready: true });
            wsClient.send({ type: 'start_game' });
            return;
        }

        window.location.hash = '#/lobby';
        ui.showScreen('lobby-screen');
        ui.updateRoomCode('lobby-room-code', data.room.code);
        ui.renderSeats('lobby-seats-list', appState.players, appState.currentUser.playerId);
        ui.renderLobbyScreen(appState.room, appState.players, appState.currentUser.playerId, appState.isHost);
        return;
    }

    if (data.room.status === 'in_game') {
        window.location.hash = '#/game';
        ui.showScreen('game-screen');

        const isNewRound = data.roundState?.round_no !== previousRoundNo;
        if (isNewRound) {
            ui.initGameScreen();
            ui.clearPlayedCards();
        }

        const newEntries = (data.roundState?.log_json || []).slice(isNewRound ? 0 : previousLogLength);
        for (const entry of newEntries) {
            const isDanger = entry.type === 'play_card' && entry.newTotal >= game.GAME_CONSTANTS.BUST_THRESHOLD;
            const isHighlight = entry.type === 'round_start' || entry.type === 'round_end' || entry.type === 'play_order' || entry.type === 'tie_break';
            ui.addLogEntry(entry.message, isDanger ? 'danger' : (isHighlight ? 'highlight' : 'normal'));

            if (entry.type === 'play_card') {
                const p = appState.players.find(pl => pl.id === entry.playerId);
                if (p) ui.showPlayedCard(p.seat_index, entry.cardValue, isDanger);
                if (isDanger) {
                    sound.playBust();
                } else if (entry.playerId !== appState.currentUser.playerId) {
                    // Our own plays already got a sound optimistically on click.
                    sound.playCard();
                }
            }
        }

        updateGameUI();
        return;
    }

    if (data.room.status === 'finished') {
        const winner = data.winner || game.checkGameOver(appState.players);
        if (winner) {
            if (winner.id === appState.currentUser.playerId) sound.playWin();
            ui.showGameOver(winner, appState.players);
        }
    }
}

// ==========================================
// UI UPDATES
// ==========================================

function updateGameUI() {
    if (!appState.room || !appState.players.length) return;
    
    // Update basic displays
    ui.updateTableTotal(appState.room.table_total);
    ui.updatePot(appState.room.pot_cents);
    ui.updateRoundNumber(appState.room.current_round);
    ui.updatePhaseIndicator(appState.room.phase);
    
    // Update player panels
    ui.renderGameTable(
        appState.players, 
        appState.currentUser.playerId, 
        appState.room.turn_player_id,
        appState.roundState?.finalized_json || {}
    );
    
    // Update bets
    if (appState.roundState) {
        ui.updatePlayerBets(appState.players, appState.roundState.bets_json || {});
    }
    
    // Update lobby seats if on lobby screen
    if (window.location.hash.includes('lobby')) {
        ui.renderSeats('lobby-seats-list', appState.players, appState.currentUser.playerId);
        ui.renderLobbyScreen(appState.room, appState.players, appState.currentUser.playerId, appState.isHost);
    }
    
    // Update controls based on game state
    const myPlayer = appState.players.find(p => p.id === appState.currentUser.playerId);
    if (!myPlayer) return;

    ui.updateYourMoney(myPlayer.money_cents);

    const isMyTurn = appState.room.turn_player_id === appState.currentUser.playerId;
    const isSpectator = myPlayer.status === 'spectator';
    
    if (isSpectator) {
        ui.hideAllControls();
        ui.showSpectatorNotice(true);
        // Hide hand for spectators
        const handContainer = document.getElementById('hand-cards');
        if (handContainer) {
            handContainer.innerHTML = '';
        }
    } else if (appState.room.phase === 'betting') {
        // Show hand cards during betting phase
        ui.renderHand(appState.myHand, false, null);
        
        // Hide earnings breakdown during betting
        ui.hideEarningsBreakdown();
        
        ui.hideAllControls();
        ui.showBettingControls(isMyTurn, appState.roundState?.has_raised_json?.[appState.currentUser.playerId] || false);
        
        // Update bet information display
        if (appState.roundState) {
            const bets = appState.roundState.bets_json || {};
            const tableHighest = Math.max(0, ...Object.values(bets));
            const yourBet = bets[appState.currentUser.playerId] || 0;
            const callAmount = Math.max(0, tableHighest - yourBet);
            
            const tableHighestEl = document.getElementById('table-highest');
            const yourBetEl = document.getElementById('your-bet');
            const callAmountEl = document.getElementById('call-amount');
            const callBtn = document.getElementById('call-btn');

            if (tableHighestEl) tableHighestEl.textContent = `Table: ${utils.formatMoney(tableHighest)}`;
            if (yourBetEl) yourBetEl.textContent = `You: ${utils.formatMoney(yourBet)}`;
            if (callAmountEl) callAmountEl.textContent = `To Call: ${utils.formatMoney(callAmount)}`;
            // There's no check option - every round needs a real bet, so
            // CALL only ever shows (and enables, see ui.updateBettingButtons)
            // once there's an actual amount to match.
            if (callBtn) callBtn.textContent = callAmount > 0 ? `CALL ${utils.formatMoney(callAmount)}` : 'CALL';
        }
        
        if (isMyTurn && appState.roundState) {
            const bets = appState.roundState.bets_json || {};
            const highestBet = Math.max(0, ...Object.values(bets));
            const betActionCount = appState.roundState.bet_action_count_json?.[appState.currentUser.playerId] || 0;
            
            // Check if all active players have acted at least once
            const activePlayers = appState.players.filter(p => p.status === 'active');
            const actionCounts = appState.roundState.bet_action_count_json || {};
            const allPlayersActed = activePlayers.every(p => (actionCounts[p.id] || 0) >= 1);
            
            ui.updateBettingButtons(
                true,
                myPlayer.money_cents,
                highestBet,
                appState.roundState.has_raised_json?.[appState.currentUser.playerId] || false,
                betActionCount,
                allPlayersActed
            );
        }
    } else if (appState.room.phase === 'playing') {
        // Check if awaiting position choice
        if (appState.roundState?.awaiting_position_choice && 
            appState.roundState?.highest_bettor_id === appState.currentUser.playerId) {
            // Human player needs to choose position
            ui.hideAllControls();
            ui.showPositionChoice(true, appState.roundState.highest_bet);
            ui.renderHand(appState.myHand, false, null);
        } else {
            ui.hideAllControls();
            ui.showPlayingControls(true);
            ui.renderHand(appState.myHand, isMyTurn, handleMultiplayerCardClick);
            
            // Show potential earnings breakdown
            if (appState.roundState && appState.roundState.bets_json) {
                ui.showEarningsBreakdown(
                    appState.players,
                    appState.currentUser.playerId,
                    appState.room.pot_cents,
                    appState.roundState.bets_json
                );
            }
        }
    } else {
        // Not betting or playing - hide earnings breakdown
        ui.hideEarningsBreakdown();
    }
}

// Start the app
init();
