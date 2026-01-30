/**
 * Main app controller for NOT10
 * Handles routing, state management, and coordination between modules
 */

import * as ui from './ui.js';
import * as utils from './utils.js';
import * as storage from './storage.js';
import * as supabaseClient from './supabaseClient.js';
import * as game from './game.js';
import * as ai from './ai.js';

// Check if config exists, otherwise use example
let config;
try {
    const configModule = await import('./config.js');
    config = configModule.config;
} catch (err) {
    console.warn('config.js not found, using example config');
    const configModule = await import('./config.example.js');
    config = configModule.config;
}

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
    subscriptions: [],
    aiPlayers: [],
    aiLoopInterval: null,
    botRunnerLock: null, // Lock for bot turn execution in multiplayer
    multiplayerBotHands: {} // Cache bot hands for host: {botId: [cards]}
};

// Initialize app
async function init() {
    console.log('Initializing NOT10...');
    
    // Get or create player ID
    appState.currentUser.playerId = storage.getOrCreatePlayerId();
    appState.currentUser.name = storage.getPlayerName() || '';
    
    // Try to initialize Supabase if configured
    let supabaseReady = false;
    try {
        if (config.supabaseUrl && config.supabaseUrl !== 'https://your-project.supabase.co') {
            await supabaseClient.initSupabase(config.supabaseUrl, config.supabaseAnonKey);
            supabaseReady = true;
        }
    } catch (error) {
        console.error('Supabase initialization failed:', error);
    }
    
    // Setup event listeners
    setupEventListeners();
    
    // Setup modals
    ui.setupModal('help-modal', 'close-help-btn');
    
    // Handle routing
    handleRoute();
    window.addEventListener('hashchange', handleRoute);
    
    // Show appropriate screen
    if (!supabaseReady) {
        ui.showScreen('setup-screen');
    } else {
        // Check for existing session
        const savedRoomCode = storage.getRoomCode();
        if (savedRoomCode) {
            // Try to rejoin
            await rejoinRoom(savedRoomCode);
        } else {
            ui.showScreen('menu-screen');
        }
    }
}

// Setup all event listeners
function setupEventListeners() {
    // Menu screen
    document.getElementById('create-lobby-btn')?.addEventListener('click', handleCreateLobby);
    document.getElementById('join-lobby-btn')?.addEventListener('click', () => {
        window.location.hash = '#/join';
    });
    document.getElementById('play-ai-btn')?.addEventListener('click', handlePlayAI);
    document.getElementById('help-btn')?.addEventListener('click', ui.showHelpModal);
    document.getElementById('play-offline-btn')?.addEventListener('click', handlePlayAI);
    
    // Join screen
    document.getElementById('join-room-btn')?.addEventListener('click', handleJoinRoom);
    document.getElementById('back-from-join-btn')?.addEventListener('click', () => {
        window.location.hash = '#/menu';
    });
    
    // Create/Lobby screen
    document.getElementById('ready-btn')?.addEventListener('click', handleToggleReady);
    document.getElementById('lobby-ready-btn')?.addEventListener('click', handleToggleReady);
    document.getElementById('start-game-btn')?.addEventListener('click', handleStartGame);
    document.getElementById('host-start-btn')?.addEventListener('click', handleStartGame);
    document.getElementById('leave-create-btn')?.addEventListener('click', handleLeaveRoom);
    document.getElementById('leave-lobby-btn')?.addEventListener('click', handleLeaveRoom);
    
    // Copy code buttons
    document.getElementById('copy-code-btn')?.addEventListener('click', async () => {
        await ui.copyWithFeedback(appState.roomCode);
    });
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
        window.location.hash = '#/menu';
        window.location.reload();
    });
    document.getElementById('back-to-menu-btn')?.addEventListener('click', () => {
        window.location.hash = '#/menu';
        window.location.reload();
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
    } else if (path.startsWith('create')) {
        // Handled by handleCreateLobby
    } else if (path.startsWith('lobby')) {
        // Handled by joinRoom/createLobby
    } else if (path.startsWith('game')) {
        // Handled by startGame
    }
}

// ==========================================
// MULTIPLAYER HANDLERS
// ==========================================

async function handleCreateLobby() {
    ui.showLoading('Creating lobby...');
    
    try {
        // Generate room code
        const code = utils.generateRoomCode();
        
        // Create room in database
        await supabaseClient.createRoom(code, appState.currentUser.playerId);
        
        // Join as host
        appState.roomCode = code;
        appState.isHost = true;
        storage.saveRoomCode(code);
        
        // Create player entry
        const playerName = appState.currentUser.name || 'Player';
        await supabaseClient.createPlayer({
            id: appState.currentUser.playerId,
            room_code: code,
            name: playerName,
            seat_index: 0,
            money_cents: game.GAME_CONSTANTS.STARTING_MONEY
        });
        
        storage.savePlayerName(playerName);
        
        // Load room data and subscribe
        await loadRoomData();
        subscribeToRoom();
        
        // Show create screen
        ui.showScreen('create-screen');
        ui.updateRoomCode('room-code-text', code);
        
        // Set player name input
        const nameInput = document.getElementById('create-player-name');
        if (nameInput) {
            nameInput.value = playerName;
            nameInput.addEventListener('change', async (e) => {
                const newName = e.target.value.trim();
                if (newName) {
                    await supabaseClient.updatePlayer(appState.currentUser.playerId, { name: newName });
                    appState.currentUser.name = newName;
                    storage.savePlayerName(newName);
                }
            });
        }
        
        window.location.hash = '#/create';
        
    } catch (error) {
        console.error('Failed to create lobby:', error);
        ui.showToast('Failed to create lobby');
        ui.showScreen('menu-screen');
    }
}

async function handleJoinRoom() {
    const codeInput = document.getElementById('join-room-code');
    const nameInput = document.getElementById('join-player-name');
    
    const code = codeInput?.value.trim().toUpperCase();
    const name = nameInput?.value.trim();
    
    // Validate
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
    
    try {
        // Check if room exists
        const room = await supabaseClient.getRoom(code);
        if (!room) {
            ui.showScreen('join-screen');
            ui.showError('join-error', 'Room not found');
            return;
        }
        
        if (room.status !== 'lobby') {
            ui.showScreen('join-screen');
            ui.showError('join-error', 'Game already in progress');
            return;
        }
        
        // Find available seat
        const seatIndex = await supabaseClient.findAvailableSeat(code);
        if (seatIndex === -1) {
            ui.showScreen('join-screen');
            ui.showError('join-error', 'Room is full (4 players max)');
            return;
        }
        
        // Create player entry
        await supabaseClient.createPlayer({
            id: appState.currentUser.playerId,
            room_code: code,
            name: name,
            seat_index: seatIndex,
            money_cents: game.GAME_CONSTANTS.STARTING_MONEY
        });
        
        appState.roomCode = code;
        appState.isHost = false;
        appState.currentUser.name = name;
        storage.saveRoomCode(code);
        storage.savePlayerName(name);
        
        // Load room data and subscribe
        await loadRoomData();
        subscribeToRoom();
        
        // Show lobby screen
        ui.showScreen('lobby-screen');
        ui.updateRoomCode('lobby-room-code', code);
        
        window.location.hash = '#/lobby';
        
    } catch (error) {
        console.error('Failed to join room:', error);
        ui.showScreen('join-screen');
        ui.showError('join-error', 'Failed to join room');
    }
}

async function handleToggleReady() {
    try {
        const myPlayer = appState.players.find(p => p.id === appState.currentUser.playerId);
        if (!myPlayer) return;
        
        const newReadyState = !myPlayer.is_ready;
        await supabaseClient.updatePlayer(appState.currentUser.playerId, { is_ready: newReadyState });
        
        myPlayer.is_ready = newReadyState;
        
        // Update UI
        const readyBtn = document.getElementById('ready-btn') || document.getElementById('lobby-ready-btn');
        if (readyBtn) {
            readyBtn.textContent = newReadyState ? 'Not Ready' : 'Ready';
        }
        
    } catch (error) {
        console.error('Failed to toggle ready:', error);
        ui.showToast('Failed to update ready status');
    }
}

async function handleStartGame() {
    if (!appState.isHost) return;
    
    const allPlayers = appState.players;
    const humanPlayers = allPlayers.filter(p => !p.is_bot);
    const readyHumans = humanPlayers.filter(p => p.is_ready);
    
    if (readyHumans.length < 2) {
        ui.showToast('Need at least 2 ready human players to start');
        return;
    }
    
    try {
        ui.showLoading('Starting game...');
        
        // Auto-fill missing seats with bots (target 4 total players)
        const occupiedSeats = allPlayers.map(p => p.seat_index);
        const missingSeats = [];
        for (let i = 0; i < 4; i++) {
            if (!occupiedSeats.includes(i)) {
                missingSeats.push(i);
            }
        }
        
        // Create bots for missing seats
        const botPersonalities = ['Cautious', 'Balanced', 'Aggressive'];
        for (let idx = 0; idx < missingSeats.length; idx++) {
            const seatIndex = missingSeats[idx];
            const personality = botPersonalities[idx % botPersonalities.length];
            await supabaseClient.upsertBotPlayer(appState.roomCode, seatIndex, personality);
        }
        
        // Reload players to include bots
        if (missingSeats.length > 0) {
            await loadRoomData();
        }
        
        // Update room status
        await supabaseClient.updateRoom(appState.roomCode, {
            status: 'in_game',
            current_round: 0
        });
        
        // Start first round
        await startMultiplayerRound();
        
    } catch (error) {
        console.error('Failed to start game:', error);
        ui.showToast('Failed to start game');
        ui.showScreen('create-screen');
    }
}

async function handleLeaveRoom() {
    // Stop bot runner if active
    stopMultiplayerBotRunner();
    
    // Unsubscribe from all
    for (const sub of appState.subscriptions) {
        await supabaseClient.unsubscribe(sub);
    }
    appState.subscriptions = [];
    
    // Clear storage
    storage.clearRoomCode();
    storage.clearSession();
    
    // Reset state
    appState.roomCode = null;
    appState.room = null;
    appState.players = [];
    appState.roundState = null;
    appState.myHand = [];
    appState.multiplayerBotHands = {};
    
    // Go to menu
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
    const result = await game.startNewRound(appState.room, appState.players, true);
    
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
    
    const result = await game.processBet(
        appState.room,
        appState.players,
        appState.roundState,
        aiPlayer.id,
        decision.action === 'raise' ? 'bet' : decision.action,
        decision.amount,
        true
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
            const finalizeResult = await game.processBet(
                appState.room,
                appState.players,
                appState.roundState,
                aiPlayer.id,
                'finalize',
                null,
                true
            );
            
            if (finalizeResult.success) {
                ui.addLogEntry(`${aiPlayer.name} finalized bet`);
                updateGameUI();
            }
        }
        
        // Check if betting is complete
        const activePlayers = appState.players.filter(p => p.status === 'active');
        if (game.isBettingComplete(activePlayers, appState.roundState.bets_json, appState.roundState.finalized_json)) {
            const transitionResult = await game.transitionToPlaying(appState.room, activePlayers, appState.roundState, true);
            
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
    
    const result = await game.processCardPlay(
        appState.room,
        appState.players,
        appState.roundState,
        aiPlayer.id,
        cardToPlay,
        true
    );
    
    if (result.success) {
        aiPlayer.removeCard(cardToPlay);
        ui.showPlayedCard(aiPlayer.seat_index, cardToPlay);
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
    
    await game.endRound(appState.room, appState.players, appState.roundState, eliminatedPlayerId, true);
    
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
        await game.applyPositionChoice(appState.room, activePlayers, appState.roundState, choice, true);
        
        updateGameUI();
        ui.addLogEntry('Playing phase started', 'highlight');
    }
}

// Handle human player position choice
async function handlePositionChoice(choice) {
    const activePlayers = appState.players.filter(p => p.status === 'active');
    
    if (appState.mode === 'ai') {
        await game.applyPositionChoice(appState.room, activePlayers, appState.roundState, choice, true);
    } else {
        await game.applyPositionChoice(appState.room, activePlayers, appState.roundState, choice, false);
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
    const result = await game.processBet(
        appState.room,
        appState.players,
        appState.roundState,
        appState.currentUser.playerId,
        'bet',
        amount,
        true
    );
    
    if (!result.success) {
        ui.showToast(result.error);
        return;
    }
    
    ui.addLogEntry(result.action === 'raise' ? `You raised to ${utils.formatMoney(result.newTotal)}` : `You bet ${utils.formatMoney(amount)}`);
    updateGameUI();
    
    // Check if betting is complete
    const activePlayers = appState.players.filter(p => p.status === 'active');
    if (game.isBettingComplete(activePlayers, appState.roundState.bets_json, appState.roundState.finalized_json)) {
        const transitionResult = await game.transitionToPlaying(appState.room, activePlayers, appState.roundState, true);
        
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
    const result = await game.processBet(
        appState.room,
        appState.players,
        appState.roundState,
        appState.currentUser.playerId,
        'all-in',
        null,
        true
    );
    
    if (!result.success) {
        ui.showToast(result.error);
        return;
    }
    
    ui.addLogEntry(`You went ALL-IN ${utils.formatMoney(result.amount)}!`, 'highlight');
    updateGameUI();
    
    // Check if betting is complete
    const activePlayers = appState.players.filter(p => p.status === 'active');
    if (game.isBettingComplete(activePlayers, appState.roundState.bets_json, appState.roundState.finalized_json)) {
        const transitionResult = await game.transitionToPlaying(appState.room, activePlayers, appState.roundState, true);
        
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
    const result = await game.processBet(
        appState.room,
        appState.players,
        appState.roundState,
        appState.currentUser.playerId,
        'call',
        null,
        true
    );
    
    if (!result.success) {
        ui.showToast(result.error);
        return;
    }
    
    ui.addLogEntry('You called');
    updateGameUI();
    
    // Check if betting is complete
    const activePlayers = appState.players.filter(p => p.status === 'active');
    if (game.isBettingComplete(activePlayers, appState.roundState.bets_json, appState.roundState.finalized_json)) {
        const transitionResult = await game.transitionToPlaying(appState.room, activePlayers, appState.roundState, true);
        
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
    const result = await game.processBet(
        appState.room,
        appState.players,
        appState.roundState,
        appState.currentUser.playerId,
        'finalize',
        null,
        true
    );
    
    if (!result.success) {
        ui.showToast(result.error);
        return;
    }
    
    ui.addLogEntry(`You finalized bet at ${utils.formatMoney(result.amount)}`);
    updateGameUI();
    
    // Check if betting is complete
    const activePlayers = appState.players.filter(p => p.status === 'active');
    if (game.isBettingComplete(activePlayers, appState.roundState.bets_json, appState.roundState.finalized_json)) {
        const transitionResult = await game.transitionToPlaying(appState.room, activePlayers, appState.roundState, true);
        
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
    
    const result = await game.processCardPlay(
        appState.room,
        appState.players,
        appState.roundState,
        appState.currentUser.playerId,
        cardValue,
        true
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
        ui.showPlayedCard(myPlayer.seat_index, cardValue);
    }
    ui.addLogEntry(`You played ${cardValue} (total: ${result.total})`);
    updateGameUI();
    
    if (result.bust) {
        ui.addLogEntry(`You busted at ${result.total}!`, 'danger');
        await handleAIRoundEnd(appState.currentUser.playerId);
    }
}

// ==========================================
// MULTIPLAYER GAME LOGIC
// ==========================================

async function startMultiplayerRound() {
    ui.showScreen('game-screen');
    ui.initGameScreen();
    
    await utils.sleep(500);
    
    try {
        const result = await game.startNewRound(appState.room, appState.players, false);
        
        if (result.gameOver) {
            ui.showGameOver(result.winner, appState.players);
            return;
        }
        
        // Reload room and round state
        await loadRoomData();
        await loadRoundState();
        await loadMyHand();
        
        // If host, load bot hands for bot control
        if (appState.isHost) {
            await loadBotHands();
        }
        
        updateGameUI();
        ui.addLogEntry(`Round ${result.round} started`, 'highlight');
        
        // Start bot runner if host
        if (appState.isHost) {
            startMultiplayerBotRunner();
        }
        
    } catch (error) {
        console.error('Failed to start round:', error);
        ui.showToast('Failed to start round');
    }
}

async function handleMultiplayerRaise(amount) {
    try {
        const result = await game.processBet(
            appState.room,
            appState.players,
            appState.roundState,
            appState.currentUser.playerId,
            'raise',
            amount,
            false
        );
        
        if (!result.success) {
            ui.showToast(result.error);
            return;
        }
        
        // State will update via subscription
        
    } catch (error) {
        console.error('Failed to raise:', error);
        ui.showToast('Failed to raise');
    }
}

async function handleMultiplayerCall() {
    try {
        const result = await game.processBet(
            appState.room,
            appState.players,
            appState.roundState,
            appState.currentUser.playerId,
            'call',
            null,
            false
        );
        
        if (!result.success) {
            ui.showToast(result.error);
            return;
        }
        
        // State will update via subscription
        
    } catch (error) {
        console.error('Failed to call:', error);
        ui.showToast('Failed to call');
    }
}

async function handleMultiplayerAllIn() {
    try {
        const result = await game.processBet(
            appState.room,
            appState.players,
            appState.roundState,
            appState.currentUser.playerId,
            'all-in',
            null,
            false
        );
        
        if (!result.success) {
            ui.showToast(result.error);
            return;
        }
        
        // State will update via subscription
        
    } catch (error) {
        console.error('Failed to go all-in:', error);
        ui.showToast('Failed to go all-in');
    }
}

async function handleMultiplayerFinalize() {
    try {
        const result = await game.processBet(
            appState.room,
            appState.players,
            appState.roundState,
            appState.currentUser.playerId,
            'finalize',
            null,
            false
        );
        
        if (!result.success) {
            ui.showToast(result.error);
            return;
        }
        
        // State will update via subscription
        
    } catch (error) {
        console.error('Failed to finalize:', error);
        ui.showToast('Failed to finalize');
    }
}

async function handleMultiplayerCardClick(cardValue) {
    try {
        const result = await game.processCardPlay(
            appState.room,
            appState.players,
            appState.roundState,
            appState.currentUser.playerId,
            cardValue,
            false
        );
        
        if (!result.success) {
            ui.showToast(result.error);
            return;
        }
        
        // State will update via subscription
        
    } catch (error) {
        console.error('Failed to play card:', error);
        ui.showToast('Failed to play card');
    }
}

// ==========================================
// DATA LOADING & SUBSCRIPTIONS
// ==========================================

async function loadRoomData() {
    appState.room = await supabaseClient.getRoom(appState.roomCode);
    appState.players = await supabaseClient.getPlayers(appState.roomCode);
}

async function loadRoundState() {
    appState.roundState = await supabaseClient.getRoundState(appState.roomCode);
}

async function loadMyHand() {
    if (!appState.room || appState.room.current_round === 0) return;
    
    appState.myHand = await supabaseClient.getHandCards(
        appState.roomCode,
        appState.room.current_round,
        appState.currentUser.playerId
    );
}

/**
 * Load bot hands (host only, for controlling bots in multiplayer)
 */
async function loadBotHands() {
    if (!appState.isHost || !appState.room || appState.room.current_round === 0) return;
    
    const bots = appState.players.filter(p => p.is_bot);
    appState.multiplayerBotHands = {};
    
    for (const bot of bots) {
        const hand = await supabaseClient.getBotHandCards(
            appState.roomCode,
            appState.room.current_round,
            bot.id
        );
        appState.multiplayerBotHands[bot.id] = hand;
    }
}

// ===========================================
//  MULTIPLAYER BOT RUNNER (Host Only)
// ===========================================

function startMultiplayerBotRunner() {
    if (appState.botRunnerLock) return;
    appState.botRunnerLock = setInterval(() => {
        triggerBotTurn();
    }, 1000); // Check every second
}

function stopMultiplayerBotRunner() {
    if (appState.botRunnerLock) {
        clearInterval(appState.botRunnerLock);
        appState.botRunnerLock = null;
    }
}

async function triggerBotTurn() {
    if (!appState.isHost || !appState.roundState || !appState.room) return;
    
    const phase = appState.roundState.phase;
    const turnPlayerId = appState.roundState.turn_player_id;
    
    if (!turnPlayerId) return;
    
    const turnPlayer = appState.players.find(p => p.id === turnPlayerId);
    if (!turnPlayer || !turnPlayer.is_bot) return; // Not a bot's turn
    
    // Execute bot action based on phase
    if (phase === 'betting') {
        await executeBotBettingTurn(turnPlayer);
    } else if (phase === 'playing') {
        await executeBotPlayingTurn(turnPlayer);
    }
}

async function executeBotBettingTurn(botPlayer) {
    // Delay to simulate thinking
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
    
    // Create AI player instance for decision making
    const personality = extractBotPersonality(botPlayer.name);
    const aiInstance = new ai.AIPlayer(botPlayer.id, botPlayer.name, personality, botPlayer.seat_index);
    aiInstance.money_cents = botPlayer.money_cents;
    
    const gameState = game.getGameState(appState.room, appState.players, appState.roundState);
    const decision = await ai.executeAIBet(aiInstance, gameState, appState.roundState);
    
    // Submit action through game logic
    const result = await game.processBet(
        appState.room,
        appState.players,
        appState.roundState,
        botPlayer.id,
        decision.action,
        decision.amount,
        false // Not offline - this is multiplayer
    );
    
    if (!result.success) {
        console.error('Bot betting failed:', result.error);
    }
}

async function executeBotPlayingTurn(botPlayer) {
    // Delay to simulate thinking
    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 1200));
    
    const botHand = appState.multiplayerBotHands[botPlayer.id] || [];
    
    if (botHand.length === 0) {
        console.warn('Bot has no cards in hand');
        return;
    }
    
    // Create AI player instance with current hand
    const personality = extractBotPersonality(botPlayer.name);
    const aiInstance = new ai.AIPlayer(botPlayer.id, botPlayer.name, personality, botPlayer.seat_index);
    aiInstance.money_cents = botPlayer.money_cents;
    aiInstance.hand = botHand;
    
    const tableTotal = appState.room.table_total || 0;
    const chosenCard = await ai.executeAICardPlay(aiInstance, tableTotal);
    
    // Show red border while bot is playing
    ui.renderGameTable(
        appState.players, 
        appState.currentUser.playerId, 
        appState.room.turn_player_id,
        appState.roundState?.finalized_json || {},
        botPlayer.id // Pass bot ID to show playing-card indicator
    );
    
    // Submit card play through game logic
    const result = await game.processCardPlay(
        appState.room,
        appState.players,
        appState.roundState,
        botPlayer.id,
        chosenCard,
        false // Not offline - this is multiplayer
    );
    
    if (!result.success) {
        console.error('Bot card play failed:', result.error);
    } else {
        // Remove card from cached hand
        const cardIndex = botHand.indexOf(chosenCard);
        if (cardIndex > -1) {
            botHand.splice(cardIndex, 1);
        }
    }
}

function extractBotPersonality(botName) {
    if (botName.includes('Cautious')) return 'Cautious';
    if (botName.includes('Aggressive')) return 'Aggressive';
    return 'Balanced';
}

function subscribeToRoom() {
    // Subscribe to room changes
    const roomSub = supabaseClient.subscribeToRoom(appState.roomCode, async (payload) => {
        console.log('Room update:', payload);
        await loadRoomData();
        
        if (appState.room.status === 'in_game' && window.location.hash.includes('lobby')) {
            // Game started
            window.location.hash = '#/game';
            await loadRoundState();
            await loadMyHand();
            if (appState.isHost) {
                await loadBotHands();
            }
            ui.showScreen('game-screen');
            ui.initGameScreen();
            if (appState.isHost) {
                startMultiplayerBotRunner();
            }
        }
        
        // Trigger bot runner on room updates (phase/turn changes)
        if (appState.isHost && appState.mode === 'multiplayer') {
            triggerBotTurn();
        }
        
        updateGameUI();
    });
    
    // Subscribe to players
    const playersSub = supabaseClient.subscribeToPlayers(appState.roomCode, async (payload) => {
        console.log('Players update:', payload);
        await loadRoomData();
        updateGameUI();
    });
    
    // Subscribe to round state
    const roundSub = supabaseClient.subscribeToRoundState(appState.roomCode, async (payload) => {
        console.log('Round state update:', payload);
        await loadRoundState();
        if (appState.isHost) {
            await loadBotHands();
            triggerBotTurn();
        }
        updateGameUI();
    });
    
    // Subscribe to hand cards
    const handSub = supabaseClient.subscribeToHandCards(appState.roomCode, appState.currentUser.playerId, async (payload) => {
        console.log('Hand update:', payload);
        await loadMyHand();
        updateGameUI();
    });
    
    // Subscribe to actions (for log)
    const actionsSub = supabaseClient.subscribeToActions(appState.roomCode, (payload) => {
        if (payload.new) {
            const action = payload.new;
            const player = appState.players.find(p => p.id === action.actor_player_id);
            const playerName = player ? player.name : 'System';
            
            if (action.type === 'raise') {
                ui.addLogEntry(`${playerName} raised ${utils.formatMoney(action.payload.amount)}`);
            } else if (action.type === 'call') {
                ui.addLogEntry(`${playerName} called`);
            } else if (action.type === 'play_card') {
                ui.addLogEntry(`${playerName} played ${action.payload.cardValue} (total: ${action.payload.newTotal})`);
                
                if (action.payload.newTotal >= game.GAME_CONSTANTS.BUST_THRESHOLD) {
                    ui.addLogEntry(`${playerName} busted!`, 'danger');
                }
            }
        }
    });
    
    appState.subscriptions = [roomSub, playersSub, roundSub, handSub, actionsSub];
}

async function rejoinRoom(roomCode) {
    ui.showLoading('Rejoining room...');
    
    try {
        const room = await supabaseClient.getRoom(roomCode);
        if (!room) {
            storage.clearRoomCode();
            ui.showScreen('menu-screen');
            return;
        }
        
        appState.roomCode = roomCode;
        await loadRoomData();
        
        const myPlayer = appState.players.find(p => p.id === appState.currentUser.playerId);
        if (!myPlayer) {
            storage.clearRoomCode();
            ui.showScreen('menu-screen');
            return;
        }
        
        appState.isHost = room.host_id === appState.currentUser.playerId;
        
        subscribeToRoom();
        
        if (room.status === 'lobby') {
            ui.showScreen(appState.isHost ? 'create-screen' : 'lobby-screen');
            ui.updateRoomCode(appState.isHost ? 'room-code-text' : 'lobby-room-code', roomCode);
        } else if (room.status === 'in_game') {
            await loadRoundState();
            await loadMyHand();
            ui.showScreen('game-screen');
            ui.initGameScreen();
            updateGameUI();
        }
        
    } catch (error) {
        console.error('Failed to rejoin room:', error);
        storage.clearRoomCode();
        ui.showScreen('menu-screen');
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
    const currentScreen = window.location.hash;
    if (currentScreen.includes('create') || currentScreen.includes('lobby')) {
        const containerId = currentScreen.includes('create') ? 'create-seats-list' : 'lobby-seats-list';
        ui.renderSeats(containerId, appState.players, appState.currentUser.playerId);
        ui.renderLobbyScreen(appState.room, appState.players, appState.currentUser.playerId, appState.isHost);
    }
    
    // Update controls based on game state
    const myPlayer = appState.players.find(p => p.id === appState.currentUser.playerId);
    if (!myPlayer) return;
    
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
            ui.updateBettingButtons(
                true,
                myPlayer.money_cents,
                highestBet,
                appState.roundState.has_raised_json?.[appState.currentUser.playerId] || false,
                betActionCount
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

// ==========================================
// HEARTBEAT (for multiplayer)
// ==========================================

setInterval(async () => {
    if (appState.roomCode && appState.mode !== 'ai') {
        try {
            await supabaseClient.updatePlayer(appState.currentUser.playerId, {
                last_seen: new Date().toISOString()
            });
        } catch (error) {
            // Ignore heartbeat errors
        }
    }
}, 10000); // Every 10 seconds

// Start the app
init();
