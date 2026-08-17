/**
 * Main app controller for NOT10
 * Handles routing, state management, and coordination between modules
 */

import * as ui from './ui.js';
import * as utils from './utils.js';
import * as storage from './storage.js';
import * as wsClient from './wsClient.js';
import * as game from '../../engine/game.js';
import * as ai from '../../engine/ai.js';

// Global app state
const appState = {
    mode: null, // 'multiplayer' or 'ai'
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
    aiPlayers: [],
    aiLoopInterval: null
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

    wsClient.connect(handleServerMessage, handleSocketOpen);

    // Setup event listeners
    setupEventListeners();

    // Setup modals
    ui.setupModal('help-modal', 'close-help-btn');

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
    if (savedRoomCode && appState.mode !== 'ai') {
        wsClient.send({ type: 'rejoin', playerId: appState.currentUser.playerId, roomCode: savedRoomCode });
    }
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
        });
    }
    document.getElementById('create-lobby-btn')?.addEventListener('click', handleCreateLobby);
    document.getElementById('join-lobby-btn')?.addEventListener('click', () => {
        window.location.hash = '#/join';
    });
    document.getElementById('play-ai-btn')?.addEventListener('click', handlePlayAI);
    document.getElementById('help-btn')?.addEventListener('click', ui.showHelpModal);

    // Join screen
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
            handleRaise(amount);
        });
    });
    document.getElementById('call-btn')?.addEventListener('click', handleCall);
    
    // Finalize button
    document.getElementById('finalize-btn')?.addEventListener('click', handleFinalize);
    
    // All-in button
    document.getElementById('all-in-btn')?.addEventListener('click', () => {
        const myPlayer = appState.players.find(p => p.id === appState.currentUser.playerId);
        if (myPlayer && myPlayer.money_cents > 0) {
            handleAllIn();
        }
    });
    
    // Position choice buttons
    document.getElementById('choose-first-btn')?.addEventListener('click', () => handlePositionChoice('first'));
    document.getElementById('choose-last-btn')?.addEventListener('click', () => handlePositionChoice('last'));
    
    // Game over screen
    document.getElementById('play-again-btn')?.addEventListener('click', () => {
        if (appState.mode === 'multiplayer') {
            // Rematch in the same room/lobby (host-only server-side; a
            // non-host tap just gets a toast telling them to wait for the host).
            handlePlayAgain();
        } else {
            window.location.hash = '#/menu';
            window.location.reload();
        }
    });
    document.getElementById('back-to-menu-btn')?.addEventListener('click', () => {
        if (appState.mode === 'multiplayer') {
            handleLeaveRoom();
        } else {
            window.location.hash = '#/menu';
            window.location.reload();
        }
    });
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
    appState.mode = 'multiplayer';
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

    appState.mode = 'multiplayer';
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

    window.location.hash = '#/menu';
    ui.showScreen('menu-screen');
}

// ==========================================
// AI MODE HANDLERS
// ==========================================

async function handlePlayAI() {
    console.log('Play AI clicked');
    ui.showLoading('Setting up AI game...');
    console.log('Loading screen shown');
    appState.mode = 'ai';
    
    // Create human player
    const humanName = appState.currentUser.name || 'You';
    const humanPlayer = {
        id: appState.currentUser.playerId,
        name: humanName,
        seat_index: 0,
        money_cents: game.GAME_CONSTANTS.STARTING_MONEY,
        status: 'active',
        is_ready: true
    };
    
    // Create AI players
    appState.aiPlayers = ai.createAIPlayers(3);
    
    // Combine all players
    appState.players = [humanPlayer, ...appState.aiPlayers];
    
    // Create mock room with random starting player
    const randomStartingPlayer = Math.floor(Math.random() * 4); // Random player 0-3
    appState.room = {
        code: 'AI-GAME',
        status: 'in_game',
        current_round: 0,
        starting_player_index: randomStartingPlayer,
        pot_cents: 0,
        table_total: 0,
        phase: 'betting',
        turn_player_id: humanPlayer.id
    };
    
    appState.roomCode = 'AI-GAME';
    
    console.log('Starting AI round');
    // Start AI game
    await startAIRound();
}

async function startAIRound() {
    console.log('Starting AI round - switching to game screen');
    ui.showScreen('game-screen');
    console.log('Game screen shown, initializing');
    ui.initGameScreen();
    console.log('Game screen initialized, sleeping');
    
    await utils.sleep(500);
    console.log('Sleep done, starting new round');
    
    // Start new round
    const result = game.startNewRound(appState.room, appState.players);

    if (result.gameOver) {
        ui.showGameOver(result.winner, appState.players);
        return;
    }

    // Clear played card displays
    ui.clearPlayedCards();
    
    // Set hands
    for (const player of appState.players) {
        if (result.hands[player.id]) {
            if (player.id === appState.currentUser.playerId) {
                appState.myHand = result.hands[player.id];
            } else {
                // AI player
                const aiPlayer = appState.aiPlayers.find(ai => ai.id === player.id);
                if (aiPlayer) {
                    aiPlayer.setHand(result.hands[player.id]);
                }
            }
        }
    }
    
    // Initialize round state
    appState.roundState = {
        round_no: result.round,
        bets_json: {},
        has_raised_json: {},
        bet_action_count_json: {},
        finalized_json: {},
        played_count: 0,
        log_json: []
    };
    
    // Update room state for AI mode
    appState.room.current_round = result.round;
    appState.room.phase = 'betting';
    appState.room.turn_player_id = result.startingPlayer.id;
    appState.room.table_total = 0;
    
    // Update UI
    updateGameUI();
    ui.addLogEntry(`Round ${result.round} started`, 'highlight');
    
    // Start AI game loop
    startAIGameLoop();
}

function startAIGameLoop() {
    // Clear any existing loop
    if (appState.aiLoopInterval) {
        clearInterval(appState.aiLoopInterval);
    }
    
    // Add a processing flag to prevent multiple simultaneous AI turns
    let isProcessing = false;
    
    // Check game state periodically
    appState.aiLoopInterval = setInterval(async () => {
        if (!isProcessing) {
            isProcessing = true;
            await processAITurn();
            isProcessing = false;
        }
    }, 500); // Increased from 100ms to 500ms for better pacing
}

async function processAITurn() {
    if (appState.room.phase === 'betting') {
        const currentPlayer = appState.players.find(p => p.id === appState.room.turn_player_id);
        if (!currentPlayer || currentPlayer.status !== 'active') return;
        
        // If it's AI's turn
        if (currentPlayer.id !== appState.currentUser.playerId) {
            const aiPlayer = appState.aiPlayers.find(ai => ai.id === currentPlayer.id);
            if (aiPlayer) {
                await executeAIBetTurn(aiPlayer);
            }
        }
        
    } else if (appState.room.phase === 'playing') {
        const currentPlayer = appState.players.find(p => p.id === appState.room.turn_player_id);
        if (!currentPlayer || currentPlayer.status !== 'active') return;
        
        // If it's AI's turn
        if (currentPlayer.id !== appState.currentUser.playerId) {
            const aiPlayer = appState.aiPlayers.find(ai => ai.id === currentPlayer.id);
            if (aiPlayer) {
                await executeAIPlayTurn(aiPlayer);
            }
        }
    }
}

async function executeAIBetTurn(aiPlayer) {
    // Add delay before AI acts to make it feel natural
    await utils.sleep(1000 + Math.random() * 1500);
    
    const gameState = game.getGameState(appState.room, appState.players, appState.roundState);
    const decision = await ai.executeAIBet(aiPlayer, gameState, appState.roundState);
    
    const result = game.processBet(
        appState.room,
        appState.players,
        appState.roundState,
        aiPlayer.id,
        decision.action === 'raise' ? 'bet' : decision.action,
        decision.amount
    );

    if (result.success) {
        if (result.action === 'raise') {
            ui.addLogEntry(`${aiPlayer.name} raised to ${utils.formatMoney(result.newTotal)}`);
        } else if (result.action === 'bet') {
            ui.addLogEntry(`${aiPlayer.name} bet ${utils.formatMoney(decision.amount)}`);
        } else if (result.action === 'all-in') {
            ui.addLogEntry(`${aiPlayer.name} went ALL-IN ${utils.formatMoney(decision.amount)}!`, 'highlight');
        } else if (result.action === 'finalize') {
            ui.addLogEntry(`${aiPlayer.name} finalized bet`);
        } else {
            ui.addLogEntry(`${aiPlayer.name} called ${utils.formatMoney(result.amount)}`);
        }
        
        updateGameUI();
        
        // AI decides whether to finalize based on strategy (only if not already finalized)
        if (decision.shouldFinalize && decision.action !== 'finalize') {
            await utils.sleep(300);
            const finalizeResult = game.processBet(
                appState.room,
                appState.players,
                appState.roundState,
                aiPlayer.id,
                'finalize',
                null
            );

            if (finalizeResult.success) {
                ui.addLogEntry(`${aiPlayer.name} finalized bet`);
                updateGameUI();
            }
        }
        
        // Check if betting is complete
        const activePlayers = appState.players.filter(p => p.status === 'active');
        if (game.isBettingComplete(activePlayers, appState.roundState.finalized_json)) {
            const transitionResult = game.transitionToPlaying(appState.room, activePlayers, appState.roundState);
            
            if (transitionResult.needsPositionChoice) {
                await handleAIPositionChoice(transitionResult);
            } else {
                updateGameUI();
                ui.addLogEntry('Playing phase started', 'highlight');
            }
        } else {
            // Next player's turn for betting
            const nextPlayer = game.getNextBettingPlayer(activePlayers, aiPlayer.seat_index, appState.roundState.finalized_json);
            if (nextPlayer) {
                appState.room.turn_player_id = nextPlayer.id;
                updateGameUI();
            }
        }
    }
}

async function executeAIPlayTurn(aiPlayer) {
    // Add delay before AI acts to make it feel natural
    await utils.sleep(800 + Math.random() * 1200);
    
    const cardToPlay = await ai.executeAICardPlay(aiPlayer, appState.room.table_total);
    
    // Show red border while AI is playing card
    ui.renderGameTable(
        appState.players, 
        appState.currentUser.playerId, 
        appState.room.turn_player_id,
        appState.roundState?.finalized_json || {},
        aiPlayer.id // Pass AI player ID to show playing-card indicator
    );
    
    const result = game.processCardPlay(
        appState.room,
        appState.players,
        appState.roundState,
        aiPlayer.id,
        cardToPlay
    );
    
    if (result.success) {
        aiPlayer.removeCard(cardToPlay);
        ui.showPlayedCard(aiPlayer.seat_index, cardToPlay, result.bust);
        ui.addLogEntry(`${aiPlayer.name} played ${cardToPlay} (total: ${result.total})`);
        updateGameUI();
        
        if (result.bust) {
            ui.addLogEntry(`${aiPlayer.name} busted at ${result.total}!`, 'danger');
            await handleAIRoundEnd(aiPlayer.id);
        }
    }
}

async function handleAIRoundEnd(eliminatedPlayerId) {
    await utils.sleep(1500);
    
    game.endRound(appState.room, appState.players, appState.roundState, eliminatedPlayerId);
    
    ui.addLogEntry('Round ended', 'highlight');
    updateGameUI();
    
    // Check game over
    const winner = game.checkGameOver(appState.players);
    if (winner) {
        clearInterval(appState.aiLoopInterval);
        await utils.sleep(2000);
        ui.showGameOver(winner, appState.players);
    } else {
        await utils.sleep(2000);
        await startAIRound();
    }
}

// Handle AI position choice
async function handleAIPositionChoice(transitionResult) {
    const aiPlayer = appState.aiPlayers.find(ai => ai.id === transitionResult.highestBettorId);
    
    if (aiPlayer) {
        // Show AI is thinking
        ui.addLogEntry(`${aiPlayer.name} is choosing position...`);
        await utils.sleep(1000 + Math.random() * 1500);
        
        // AI makes choice based on hand
        const choice = ai.choosePosition(aiPlayer, appState.room.table_total || 0);
        
        // Apply choice
        const activePlayers = appState.players.filter(p => p.status === 'active');
        game.applyPositionChoice(appState.room, activePlayers, appState.roundState, choice);

        updateGameUI();
        ui.addLogEntry('Playing phase started', 'highlight');
    }
}

// Handle human player position choice
async function handlePositionChoice(choice) {
    if (appState.mode === 'ai') {
        const activePlayers = appState.players.filter(p => p.status === 'active');
        game.applyPositionChoice(appState.room, activePlayers, appState.roundState, choice);
    } else {
        handleMultiplayerPositionChoice(choice);
        return; // the server's 'state' broadcast drives the UI update, not this client
    }

    updateGameUI();
    ui.addLogEntry('Playing phase started', 'highlight');
}

// ==========================================
// HUMAN PLAYER ACTIONS (AI MODE)
// ==========================================

async function handleRaise(amount) {
    if (appState.mode === 'ai') {
        await handleAIRaise(amount);
    } else {
        await handleMultiplayerRaise(amount);
    }
}

async function handleCall() {
    if (appState.mode === 'ai') {
        await handleAICall();
    } else {
        await handleMultiplayerCall();
    }
}

async function handleAIRaise(amount) {
    const result = game.processBet(
        appState.room,
        appState.players,
        appState.roundState,
        appState.currentUser.playerId,
        'bet',
        amount
    );
    
    if (!result.success) {
        ui.showToast(result.error);
        return;
    }
    
    ui.addLogEntry(result.action === 'raise' ? `You raised to ${utils.formatMoney(result.newTotal)}` : `You bet ${utils.formatMoney(amount)}`);
    updateGameUI();
    
    // Check if betting is complete
    const activePlayers = appState.players.filter(p => p.status === 'active');
    if (game.isBettingComplete(activePlayers, appState.roundState.finalized_json)) {
        const transitionResult = game.transitionToPlaying(appState.room, activePlayers, appState.roundState);
        
        if (transitionResult.needsPositionChoice) {
            if (transitionResult.highestBettorId === appState.currentUser.playerId) {
                // Human player gets to choose
                ui.showPositionChoice(true, transitionResult.highestBet);
                updateGameUI();
            } else {
                // AI player chooses
                await handleAIPositionChoice(transitionResult);
            }
        } else {
            updateGameUI();
            ui.addLogEntry('Playing phase started', 'highlight');
        }
    } else {
        // Next player's turn
        const humanPlayer = appState.players.find(p => p.id === appState.currentUser.playerId);
        const nextPlayer = game.getNextBettingPlayer(activePlayers, humanPlayer.seat_index, appState.roundState.finalized_json);
        if (nextPlayer) {
            appState.room.turn_player_id = nextPlayer.id;
            updateGameUI();
        }
    }
}

async function handleAllIn() {
    if (appState.mode === 'ai') {
        await handleAIAllIn();
    } else {
        await handleMultiplayerAllIn();
    }
}

async function handleAIAllIn() {
    const result = game.processBet(
        appState.room,
        appState.players,
        appState.roundState,
        appState.currentUser.playerId,
        'all-in',
        null
    );
    
    if (!result.success) {
        ui.showToast(result.error);
        return;
    }
    
    ui.addLogEntry(`You went ALL-IN ${utils.formatMoney(result.amount)}!`, 'highlight');
    updateGameUI();
    
    // Check if betting is complete
    const activePlayers = appState.players.filter(p => p.status === 'active');
    if (game.isBettingComplete(activePlayers, appState.roundState.finalized_json)) {
        const transitionResult = game.transitionToPlaying(appState.room, activePlayers, appState.roundState);
        
        if (transitionResult.needsPositionChoice) {
            if (transitionResult.highestBettorId === appState.currentUser.playerId) {
                // Human player gets to choose
                ui.showPositionChoice(true, transitionResult.highestBet);
                updateGameUI();
            } else {
                // AI player chooses
                await handleAIPositionChoice(transitionResult);
            }
        } else {
            updateGameUI();
            ui.addLogEntry('Playing phase started', 'highlight');
        }
    } else {
        // Next player's turn
        const humanPlayer = appState.players.find(p => p.id === appState.currentUser.playerId);
        const nextPlayer = game.getNextBettingPlayer(activePlayers, humanPlayer.seat_index, appState.roundState.finalized_json);
        if (nextPlayer) {
            appState.room.turn_player_id = nextPlayer.id;
            updateGameUI();
        }
    }
}

async function handleAICall() {
    const result = game.processBet(
        appState.room,
        appState.players,
        appState.roundState,
        appState.currentUser.playerId,
        'call',
        null
    );
    
    if (!result.success) {
        ui.showToast(result.error);
        return;
    }
    
    ui.addLogEntry('You called');
    updateGameUI();
    
    // Check if betting is complete
    const activePlayers = appState.players.filter(p => p.status === 'active');
    if (game.isBettingComplete(activePlayers, appState.roundState.finalized_json)) {
        const transitionResult = game.transitionToPlaying(appState.room, activePlayers, appState.roundState);
        
        if (transitionResult.needsPositionChoice) {
            if (transitionResult.highestBettorId === appState.currentUser.playerId) {
                // Human player gets to choose
                ui.showPositionChoice(true, transitionResult.highestBet);
                updateGameUI();
            } else {
                // AI player chooses
                await handleAIPositionChoice(transitionResult);
            }
        } else {
            updateGameUI();
            ui.addLogEntry('Playing phase started', 'highlight');
        }
    } else {
        // Next player's turn
        const humanPlayer = appState.players.find(p => p.id === appState.currentUser.playerId);
        const nextPlayer = game.getNextBettingPlayer(activePlayers, humanPlayer.seat_index, appState.roundState.finalized_json);
        if (nextPlayer) {
            appState.room.turn_player_id = nextPlayer.id;
            updateGameUI();
        }
    }
}

async function handleFinalize() {
    if (appState.mode === 'ai') {
        await handleAIFinalize();
    } else {
        await handleMultiplayerFinalize();
    }
}

async function handleAIFinalize() {
    const result = game.processBet(
        appState.room,
        appState.players,
        appState.roundState,
        appState.currentUser.playerId,
        'finalize',
        null
    );
    
    if (!result.success) {
        ui.showToast(result.error);
        return;
    }
    
    ui.addLogEntry(`You finalized bet at ${utils.formatMoney(result.amount)}`);
    updateGameUI();
    
    // Check if betting is complete
    const activePlayers = appState.players.filter(p => p.status === 'active');
    if (game.isBettingComplete(activePlayers, appState.roundState.finalized_json)) {
        const transitionResult = game.transitionToPlaying(appState.room, activePlayers, appState.roundState);
        
        if (transitionResult.needsPositionChoice) {
            if (transitionResult.highestBettorId === appState.currentUser.playerId) {
                // Human player gets to choose
                ui.showPositionChoice(true, transitionResult.highestBet);
                updateGameUI();
            } else {
                // AI player chooses
                await handleAIPositionChoice(transitionResult);
            }
        } else {
            updateGameUI();
            ui.addLogEntry('Playing phase started', 'highlight');
        }
    } else {
        // Next player's turn
        const humanPlayer = appState.players.find(p => p.id === appState.currentUser.playerId);
        const nextPlayer = game.getNextBettingPlayer(activePlayers, humanPlayer.seat_index, appState.roundState.finalized_json);
        if (nextPlayer) {
            appState.room.turn_player_id = nextPlayer.id;
            updateGameUI();
        }
    }
}

async function handleCardClick(cardValue) {
    if (appState.mode === 'ai') {
        await handleAICardClick(cardValue);
    } else {
        await handleMultiplayerCardClick(cardValue);
    }
}

async function handleAICardClick(cardValue) {
    const myPlayer = appState.players.find(p => p.id === appState.currentUser.playerId);
    
    // Show red border while player is playing card
    ui.renderGameTable(
        appState.players, 
        appState.currentUser.playerId, 
        appState.room.turn_player_id,
        appState.roundState?.finalized_json || {},
        appState.currentUser.playerId // Show playing-card indicator for human player
    );
    
    const result = game.processCardPlay(
        appState.room,
        appState.players,
        appState.roundState,
        appState.currentUser.playerId,
        cardValue
    );
    
    if (!result.success) {
        ui.showToast(result.error);
        return;
    }
    
    // Remove card from hand
    const index = appState.myHand.indexOf(cardValue);
    if (index > -1) {
        appState.myHand.splice(index, 1);
    }
    
    if (myPlayer) {
        ui.showPlayedCard(myPlayer.seat_index, cardValue, result.bust);
    }
    ui.addLogEntry(`You played ${cardValue} (total: ${result.total})`);
    updateGameUI();
    
    if (result.bust) {
        ui.addLogEntry(`You busted at ${result.total}!`, 'danger');
        await handleAIRoundEnd(appState.currentUser.playerId);
    }
}


// ==========================================
// MULTIPLAYER (WebSocket-driven)
// ==========================================
//
// Unlike the AI-mode section above, there is almost no logic here: the
// server (server/rooms.js) is authoritative for turn advancement, bot
// control, and round-end handling. This client only sends intents and
// re-renders whenever a 'state' broadcast arrives (handleServerMessage).
// Design trade-off worth knowing: because every update is a full
// snapshot rather than a granular per-action event, the "still deciding"
// pulsing indicator AI mode shows while a bot is mid-turn doesn't have an
// equivalent here - you only see a bot's move once it's already resolved.
// Whose turn it is right now is still shown via the normal active-turn
// highlight on their player panel.

function handleMultiplayerRaise(amount) {
    wsClient.send({ type: 'bet', action: 'bet', amount });
}

function handleMultiplayerCall() {
    wsClient.send({ type: 'bet', action: 'call', amount: null });
}

function handleMultiplayerAllIn() {
    wsClient.send({ type: 'bet', action: 'all-in', amount: null });
}

function handleMultiplayerFinalize() {
    wsClient.send({ type: 'bet', action: 'finalize', amount: null });
}

function handleMultiplayerCardClick(cardValue) {
    wsClient.send({ type: 'play_card', value: cardValue });
}

function handleMultiplayerPositionChoice(choice) {
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

    if (data.room.status === 'lobby') {
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
            const isHighlight = entry.type === 'round_start' || entry.type === 'round_end' || entry.type === 'play_order';
            ui.addLogEntry(entry.message, isDanger ? 'danger' : (isHighlight ? 'highlight' : 'normal'));

            if (entry.type === 'play_card') {
                const p = appState.players.find(pl => pl.id === entry.playerId);
                if (p) ui.showPlayedCard(p.seat_index, entry.cardValue, isDanger);
            }
        }

        updateGameUI();
        return;
    }

    if (data.room.status === 'finished') {
        const winner = data.winner || game.checkGameOver(appState.players);
        if (winner) {
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
            
            if (tableHighestEl) tableHighestEl.textContent = `Table: ${utils.formatMoney(tableHighest)}`;
            if (yourBetEl) yourBetEl.textContent = `You: ${utils.formatMoney(yourBet)}`;
            if (callAmountEl) callAmountEl.textContent = `To Call: ${utils.formatMoney(callAmount)}`;
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
            ui.renderHand(appState.myHand, isMyTurn, handleCardClick);
            
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
