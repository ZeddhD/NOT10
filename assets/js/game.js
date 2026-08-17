/**
 * Game logic for NOT10
 * Pure rules engine: no network, no storage, no DOM. Every exported function
 * takes plain state objects and returns a plain result, including an
 * `effects` array describing what a caller *may* want to persist.
 *
 * This module must never import supabaseClient (or anything else that
 * touches the network/DOM) - see assets/js/persistence.js for the adapter
 * that applies `effects` against Supabase, and tests/game.test.js for the
 * headless unit tests this separation makes possible.
 */

import * as utils from './utils.js';

// Game constants
export const GAME_CONSTANTS = {
    STARTING_MONEY: 100000, // $1000 in cents
    MAX_PLAYERS: 4,
    MIN_PLAYERS: 2,
    CARDS_PER_PLAYER_4: 4,
    CARDS_PER_PLAYER_2: 6,
    BUST_THRESHOLD: 10,
    RAISE_AMOUNTS: [10000, 20000, 50000] // $100, $200, $500 in cents
};

/**
 * Start a new round
 * @param {Object} room - Room object
 * @param {Array} players - Array of player objects
 * @returns {Object} Round initialization data (mutates player/room objects in place, like the rest of this module)
 */
export function startNewRound(room, players) {
    const effects = [];
    const activePlayers = players.filter(p => p.money_cents > 0 && p.status === 'active');

    if (activePlayers.length < 2) {
        // Game over - only one player left with money
        return { gameOver: true, winner: activePlayers[0] || players[0], effects };
    }

    // Update spectators (players with no money)
    for (const player of players) {
        if (player.money_cents <= 0 && player.status === 'active') {
            effects.push({ type: 'updatePlayer', playerId: player.id, updates: { status: 'spectator' } });
            player.status = 'spectator';
        }
    }

    const newRoundNo = room.current_round + 1;

    // Determine cards per player based on active player count
    const cardsPerPlayer = activePlayers.length >= 3
        ? GAME_CONSTANTS.CARDS_PER_PLAYER_4
        : GAME_CONSTANTS.CARDS_PER_PLAYER_2;

    // Create and shuffle deck
    let deck = utils.createDeck();
    deck = utils.shuffleArray(deck);

    // Deal cards to active players
    const hands = {};
    for (const player of activePlayers) {
        hands[player.id] = utils.dealCards(deck, cardsPerPlayer);
    }

    // Reset round state
    const roundState = {
        round_no: newRoundNo,
        deck_json: deck,
        eliminated_player_id: null,
        bets_json: {},
        has_raised_json: {},
        bet_action_count_json: {}, // Track number of bet actions per player (need 2+ to finalize)
        finalized_json: {},
        played_count: 0,
        log_json: [{
            type: 'round_start',
            message: `Round ${newRoundNo} started`,
            timestamp: utils.getTimestamp()
        }]
    };

    // Determine starting player (rotate clockwise)
    const startingPlayerIndex = room.starting_player_index;
    const orderedPlayers = utils.getPlayersInTurnOrder(activePlayers, startingPlayerIndex);
    const currentTurnPlayer = orderedPlayers[0];

    effects.push({ type: 'initRoundState', roomCode: room.code, roundNo: newRoundNo, roundState });
    for (const player of activePlayers) {
        effects.push({ type: 'saveHandCards', roomCode: room.code, roundNo: newRoundNo, playerId: player.id, cards: hands[player.id] });
    }
    effects.push({
        type: 'updateRoom', roomCode: room.code, updates: {
            current_round: newRoundNo,
            table_total: 0,
            phase: 'betting',
            turn_player_id: currentTurnPlayer.id
        }
    });
    effects.push({ type: 'logAction', roomCode: room.code, actorPlayerId: 'system', actionType: 'round_start', payload: { round: newRoundNo } });

    return {
        gameOver: false,
        round: newRoundNo,
        hands,
        startingPlayer: currentTurnPlayer,
        activePlayers,
        effects
    };
}

/**
 * Process a bet action
 * @param {Object} room - Room object
 * @param {Array} players - Array of player objects
 * @param {Object} roundState - Round state object
 * @param {string} playerId - Player making bet
 * @param {string} action - 'bet' | 'call' | 'all-in' | 'finalize'
 * @param {number} amount - Amount to bet (in cents) if action is 'bet'
 * @returns {Object} Bet result
 */
export function processBet(room, players, roundState, playerId, action, amount) {
    const effects = [];
    const player = players.find(p => p.id === playerId);
    if (!player || player.status !== 'active') {
        return { success: false, error: 'Player not active', effects };
    }

    const bets = roundState.bets_json || {};
    const hasRaised = roundState.has_raised_json || {};
    const actionCount = roundState.bet_action_count_json || {};
    const finalized = roundState.finalized_json || {};
    const currentPlayerBet = bets[playerId] || 0;

    // Get highest bet on table
    const tableHighestBet = Math.max(0, ...Object.values(bets));

    if (action === 'finalize') {
        // FINALIZE: Lock in current bet and pass turn
        // Player must have acted at least once AND everyone else must have acted (one full round)
        const playerActions = actionCount[playerId] || 0;
        if (playerActions < 1) {
            return { success: false, error: 'You must bet or call before finalizing.', effects };
        }

        // Check if all active players have acted at least once (one full betting round completed)
        const activePlayers = players.filter(p => p.status === 'active');
        const allPlayersActed = activePlayers.every(p => (actionCount[p.id] || 0) >= 1);
        if (!allPlayersActed) {
            return { success: false, error: 'Cannot finalize until all players have bet at least once.', effects };
        }

        // Minimum bet is $100 unless player has less money (all-in)
        if (currentPlayerBet < 10000 && player.money_cents > 0) {
            return { success: false, error: 'Minimum bet is $100. Please bet or go all-in.', effects };
        }

        finalized[playerId] = true;

        effects.push({ type: 'updateRoundState', roomCode: room.code, updates: { finalized_json: finalized } });

        roundState.finalized_json = finalized;
        roundState.log_json.push({
            type: 'finalize',
            playerId,
            playerName: player.name,
            amount: currentPlayerBet,
            message: `${player.name} finalized bet at ${utils.formatMoney(currentPlayerBet)}`,
            timestamp: utils.getTimestamp()
        });

        return { success: true, action: 'finalize', amount: currentPlayerBet, effects };
    }

    if (action === 'bet') {
        // INCREMENTAL BETTING: Add amount to current committed bet
        // Validate amount is allowed
        if (!GAME_CONSTANTS.RAISE_AMOUNTS.includes(amount) && amount !== player.money_cents) {
            return { success: false, error: 'Invalid bet amount', effects };
        }

        // Check if player can afford this additional amount
        if (player.money_cents < amount) {
            return { success: false, error: 'Insufficient funds', effects };
        }

        // Add to player's committed bet
        const newPlayerBet = currentPlayerBet + amount;
        bets[playerId] = newPlayerBet;

        // Deduct from player money and add to pot
        player.money_cents -= amount;
        room.pot_cents += amount;

        // Check if this is a RAISE (new bet > table highest)
        const isRaise = newPlayerBet > tableHighestBet;
        if (isRaise) {
            hasRaised[playerId] = true;
        }

        // Increment bet action count
        actionCount[playerId] = (actionCount[playerId] || 0) + 1;

        effects.push({ type: 'updatePlayer', playerId, updates: { money_cents: player.money_cents } });
        effects.push({ type: 'updateRoom', roomCode: room.code, updates: { pot_cents: room.pot_cents } });
        effects.push({ type: 'updateRoundState', roomCode: room.code, updates: { bets_json: bets, has_raised_json: hasRaised, bet_action_count_json: actionCount } });
        effects.push({ type: 'logAction', roomCode: room.code, actorPlayerId: playerId, actionType: isRaise ? 'raise' : 'bet', payload: { amount, newTotal: newPlayerBet } });

        roundState.bets_json = bets;
        roundState.has_raised_json = hasRaised;
        roundState.bet_action_count_json = actionCount;
        roundState.log_json.push({
            type: isRaise ? 'raise' : 'bet',
            playerId,
            playerName: player.name,
            amount,
            newTotal: newPlayerBet,
            message: isRaise ? `${player.name} raised to $${newPlayerBet / 100}` : `${player.name} bet $${amount / 100}`,
            timestamp: utils.getTimestamp()
        });

        return { success: true, action: isRaise ? 'raise' : 'bet', amount, newTotal: newPlayerBet, effects };

    } else if (action === 'call') {
        // CALL: Match highest bet by adding only the difference
        const callAmount = Math.max(0, tableHighestBet - currentPlayerBet);

        if (callAmount > 0) {
            // If player can't afford full call, they can choose to go all-in or fold
            // For now, we'll allow partial call (all-in) only if explicitly chosen
            if (player.money_cents < callAmount) {
                return { success: false, error: 'Insufficient funds to call - use ALL-IN instead', effects };
            }

            player.money_cents -= callAmount;
            room.pot_cents += callAmount;
            bets[playerId] = tableHighestBet;

            effects.push({ type: 'updatePlayer', playerId, updates: { money_cents: player.money_cents } });
            effects.push({ type: 'updateRoom', roomCode: room.code, updates: { pot_cents: room.pot_cents } });
            effects.push({ type: 'updateRoundState', roomCode: room.code, updates: { bets_json: bets } });

            roundState.bets_json = bets;
        }

        // Increment bet action count
        actionCount[playerId] = (actionCount[playerId] || 0) + 1;

        roundState.log_json.push({
            type: 'call',
            playerId,
            playerName: player.name,
            amount: callAmount,
            message: callAmount > 0 ? `${player.name} called $${callAmount / 100}` : `${player.name} checked`,
            timestamp: utils.getTimestamp()
        });

        effects.push({ type: 'logAction', roomCode: room.code, actorPlayerId: playerId, actionType: 'call', payload: { amount: callAmount } });
        effects.push({ type: 'updateRoundState', roomCode: room.code, updates: { bet_action_count_json: actionCount } });

        roundState.bet_action_count_json = actionCount;

        return { success: true, action: 'call', amount: callAmount, effects };
    } else if (action === 'all-in') {
        // ALL-IN: Bet entire remaining balance
        const allInAmount = player.money_cents;

        if (allInAmount === 0) {
            return { success: false, error: 'No money to go all-in', effects };
        }

        const newPlayerBet = currentPlayerBet + allInAmount;
        bets[playerId] = newPlayerBet;

        player.money_cents = 0;
        room.pot_cents += allInAmount;

        // Determine if this is a raise
        const isRaise = newPlayerBet > tableHighestBet;
        if (isRaise) {
            hasRaised[playerId] = true;
        }

        // Increment bet action count
        actionCount[playerId] = (actionCount[playerId] || 0) + 1;

        effects.push({ type: 'updatePlayer', playerId, updates: { money_cents: 0 } });
        effects.push({ type: 'updateRoom', roomCode: room.code, updates: { pot_cents: room.pot_cents } });
        effects.push({ type: 'updateRoundState', roomCode: room.code, updates: { bets_json: bets, has_raised_json: hasRaised, bet_action_count_json: actionCount } });
        effects.push({ type: 'logAction', roomCode: room.code, actorPlayerId: playerId, actionType: 'all-in', payload: { amount: allInAmount, newTotal: newPlayerBet } });

        roundState.bets_json = bets;
        roundState.has_raised_json = hasRaised;
        roundState.bet_action_count_json = actionCount;
        roundState.log_json.push({
            type: 'all-in',
            playerId,
            playerName: player.name,
            amount: allInAmount,
            newTotal: newPlayerBet,
            message: `${player.name} went ALL-IN $${allInAmount / 100}!`,
            timestamp: utils.getTimestamp()
        });

        return { success: true, action: 'all-in', amount: allInAmount, newTotal: newPlayerBet, effects };
    }

    return { success: false, error: 'Invalid action', effects };
}

/**
 * Check if betting phase is complete
 * @param {Array} activePlayers - Active players
 * @param {Object} bets - Bets object
 * @param {Object} finalized - Finalized flags
 * @returns {boolean} Is betting complete
 */
export function isBettingComplete(activePlayers, bets, finalized) {
    // All active players must have finalized their bet
    for (const player of activePlayers) {
        if (!finalized || !finalized[player.id]) {
            return false;
        }
    }
    return true;
}

/**
 * Transition from betting to playing phase
 * @param {Object} room - Room object
 * @param {Array} activePlayers - Active players
 * @param {Object} roundState - Round state with bets
 * @returns {Object} Transition result with highest bettor info
 */
export function transitionToPlaying(room, activePlayers, roundState) {
    const effects = [];
    const bets = roundState.bets_json || {};

    // Find player with highest bet (they get to choose position)
    // Use turn order to break ties - first player in turn order with highest bet wins
    const orderedPlayers = utils.getPlayersInTurnOrder(activePlayers, room.starting_player_index);

    let highestBet = 0;
    let highestBettorId = null;

    for (const player of orderedPlayers) {
        const playerBet = bets[player.id] || 0;
        if (playerBet > highestBet) {
            highestBet = playerBet;
            highestBettorId = player.id;
        }
    }

    const highestBettor = activePlayers.find(p => p.id === highestBettorId);

    // Store highest bettor info in round state for later choice
    if (highestBettorId && highestBet > 0) {
        roundState.highest_bettor_id = highestBettorId;
        roundState.highest_bet = highestBet;
        roundState.awaiting_position_choice = true;
    }

    effects.push({ type: 'updateRoom', roomCode: room.code, updates: { phase: 'playing' } });
    effects.push({
        type: 'updateRoundState', roomCode: room.code, updates: {
            highest_bettor_id: highestBettorId,
            highest_bet: highestBet,
            awaiting_position_choice: true
        }
    });

    room.phase = 'playing';

    return {
        success: true,
        highestBettorId,
        highestBet,
        highestBettor,
        needsPositionChoice: highestBettorId && highestBet > 0,
        effects
    };
}

/**
 * Apply position choice and set turn order
 * @param {Object} room - Room object
 * @param {Array} activePlayers - Active players
 * @param {Object} roundState - Round state
 * @param {string} choice - 'first' or 'last'
 * @returns {Object} Result with new first player
 */
export function applyPositionChoice(room, activePlayers, roundState, choice) {
    const effects = [];
    const highestBettorId = roundState.highest_bettor_id;
    const highestBet = roundState.highest_bet;

    // Get ordered players starting from starting_player_index
    let orderedPlayers = utils.getPlayersInTurnOrder(activePlayers, room.starting_player_index);

    const highestBettor = orderedPlayers.find(p => p.id === highestBettorId);
    const highestBettorIndex = orderedPlayers.findIndex(p => p.id === highestBettorId);

    if (choice === 'last' && highestBettorIndex !== -1 && highestBettorIndex !== orderedPlayers.length - 1) {
        // Move highest bettor to last position
        orderedPlayers.splice(highestBettorIndex, 1);
        orderedPlayers.push(highestBettor);

        roundState.log_json.push({
            type: 'play_order',
            playerId: highestBettorId,
            playerName: highestBettor.name,
            message: `${highestBettor.name} bet the most (${utils.formatMoney(highestBet)}) and chose to play LAST`,
            timestamp: utils.getTimestamp()
        });
    } else if (choice === 'first' && highestBettorIndex !== -1 && highestBettorIndex !== 0) {
        // Move highest bettor to first position
        orderedPlayers.splice(highestBettorIndex, 1);
        orderedPlayers.unshift(highestBettor);

        roundState.log_json.push({
            type: 'play_order',
            playerId: highestBettorId,
            playerName: highestBettor.name,
            message: `${highestBettor.name} bet the most (${utils.formatMoney(highestBet)}) and chose to play FIRST`,
            timestamp: utils.getTimestamp()
        });
    } else {
        // Already in desired position or choice is 'stay'
        roundState.log_json.push({
            type: 'play_order',
            playerId: highestBettorId,
            playerName: highestBettor.name,
            message: `${highestBettor.name} bet the most (${utils.formatMoney(highestBet)}) and stays in current position`,
            timestamp: utils.getTimestamp()
        });
    }

    const firstPlayer = orderedPlayers[0];

    // Clear awaiting choice flag
    roundState.awaiting_position_choice = false;

    effects.push({ type: 'updateRoom', roomCode: room.code, updates: { turn_player_id: firstPlayer.id } });
    effects.push({
        type: 'updateRoundState', roomCode: room.code, updates: {
            log_json: roundState.log_json,
            awaiting_position_choice: false
        }
    });

    room.turn_player_id = firstPlayer.id;

    return {
        success: true,
        firstPlayer,
        effects
    };
}

/**
 * Process a card play
 * @param {Object} room - Room object
 * @param {Array} players - Array of player objects
 * @param {Object} roundState - Round state object
 * @param {string} playerId - Player playing card
 * @param {number} cardValue - Card value to play
 * @returns {Object} Play result
 */
export function processCardPlay(room, players, roundState, playerId, cardValue) {
    const effects = [];
    const player = players.find(p => p.id === playerId);
    if (!player || player.status !== 'active') {
        return { success: false, error: 'Player not active', effects };
    }

    // Verify it's player's turn
    if (room.turn_player_id !== playerId) {
        return { success: false, error: 'Not your turn', effects };
    }

    // Update table total
    const newTotal = room.table_total + cardValue;
    room.table_total = newTotal;

    // Remove card from hand
    effects.push({ type: 'removeCardFromHand', roomCode: room.code, roundNo: room.current_round, playerId, cardValue });

    // Log the play
    roundState.log_json.push({
        type: 'play_card',
        playerId,
        playerName: player.name,
        cardValue,
        newTotal,
        message: `${player.name} played ${cardValue} (total: ${newTotal})`,
        timestamp: utils.getTimestamp()
    });

    roundState.played_count++;

    effects.push({ type: 'updateRoom', roomCode: room.code, updates: { table_total: newTotal } });
    effects.push({ type: 'updateRoundState', roomCode: room.code, updates: { played_count: roundState.played_count, log_json: roundState.log_json } });
    effects.push({ type: 'logAction', roomCode: room.code, actorPlayerId: playerId, actionType: 'play_card', payload: { cardValue, newTotal } });

    // Check for bust
    if (newTotal >= GAME_CONSTANTS.BUST_THRESHOLD) {
        return {
            success: true,
            bust: true,
            eliminatedPlayer: player,
            total: newTotal,
            effects
        };
    }

    // Not bust - advance turn
    const activePlayers = players.filter(p => p.status === 'active');
    const nextPlayerIndex = utils.getNextPlayerIndex(player.seat_index, activePlayers);
    const nextPlayer = activePlayers.find(p => p.seat_index === nextPlayerIndex);

    if (nextPlayer) {
        effects.push({ type: 'updateRoom', roomCode: room.code, updates: { turn_player_id: nextPlayer.id } });
        room.turn_player_id = nextPlayer.id;
    }

    return {
        success: true,
        bust: false,
        total: newTotal,
        nextPlayer,
        effects
    };
}

/**
 * Handle round end and pot distribution
 * @param {Object} room - Room object
 * @param {Array} players - Array of player objects
 * @param {Object} roundState - Round state object
 * @param {string} eliminatedPlayerId - ID of eliminated player
 * @returns {Object} Round end result
 */
export function endRound(room, players, roundState, eliminatedPlayerId) {
    const effects = [];
    const activePlayers = players.filter(p => p.status === 'active');
    const survivors = activePlayers.filter(p => p.id !== eliminatedPlayerId);
    const bets = roundState.bets_json || {};

    // WEIGHTED POT DISTRIBUTION: Proportional to bet amount
    // Calculate total bets from survivors only
    const totalSurvivorBets = survivors.reduce((sum, survivor) => {
        return sum + (bets[survivor.id] || 0);
    }, 0);

    const potDistributions = {};
    let totalDistributed = 0;

    // Distribute pot proportionally to each survivor's bet
    for (let i = 0; i < survivors.length; i++) {
        const survivor = survivors[i];
        const survivorBet = bets[survivor.id] || 0;

        // Calculate proportional share
        let share;
        if (totalSurvivorBets === 0) {
            // If no one bet (edge case), split equally
            share = Math.floor(room.pot_cents / survivors.length);
        } else {
            // Weighted distribution: (your_bet / total_survivor_bets) × pot
            const proportion = survivorBet / totalSurvivorBets;
            share = Math.floor(room.pot_cents * proportion);
        }

        // Last survivor gets remainder to ensure full pot distribution
        if (i === survivors.length - 1) {
            share = room.pot_cents - totalDistributed;
        }

        survivor.money_cents += share;
        potDistributions[survivor.id] = share;
        totalDistributed += share;

        effects.push({ type: 'updatePlayer', playerId: survivor.id, updates: { money_cents: survivor.money_cents } });
    }

    // Reset pot to 0 for next round
    const newPot = 0;

    // Log round end with detailed distribution
    const distributionDetails = survivors.map(s =>
        `${s.name}: bet ${utils.formatMoney(bets[s.id] || 0)} → won ${utils.formatMoney(potDistributions[s.id])}`
    ).join(', ');

    roundState.log_json.push({
        type: 'round_end',
        eliminatedPlayerId,
        survivors: survivors.map(s => s.id),
        potDistributions,
        message: `Round ended. ${distributionDetails}`,
        timestamp: utils.getTimestamp()
    });

    // Rotate starting player clockwise
    const nextStartingIndex = (room.starting_player_index + 1) % GAME_CONSTANTS.MAX_PLAYERS;

    effects.push({ type: 'updateRoundState', roomCode: room.code, updates: { eliminated_player_id: eliminatedPlayerId, log_json: roundState.log_json } });
    effects.push({
        type: 'updateRoom', roomCode: room.code, updates: {
            phase: 'round_end',
            pot_cents: newPot,
            starting_player_index: nextStartingIndex
        }
    });

    room.phase = 'round_end';
    room.pot_cents = newPot;
    room.starting_player_index = nextStartingIndex;

    return {
        success: true,
        survivors,
        potDistributions,
        totalDistributed,
        nextStartingIndex,
        effects
    };
}

/**
 * Check if game is over (only one player with money)
 * @param {Array} players - Array of player objects
 * @returns {Object|null} Winner or null
 */
export function checkGameOver(players) {
    const playersWithMoney = players.filter(p => p.money_cents > 0);

    if (playersWithMoney.length === 1) {
        return playersWithMoney[0];
    }

    return null;
}

/**
 * Get current game state summary
 * @param {Object} room - Room object
 * @param {Array} players - Array of players
 * @param {Object} roundState - Round state object
 * @returns {Object} Game state summary
 */
export function getGameState(room, players, roundState) {
    const activePlayers = players.filter(p => p.status === 'active');
    const spectators = players.filter(p => p.status === 'spectator');

    return {
        roomCode: room.code,
        round: room.current_round,
        phase: room.phase,
        pot: room.pot_cents,
        tableTotal: room.table_total,
        turnPlayerId: room.turn_player_id,
        startingPlayerIndex: room.starting_player_index,
        activePlayers: activePlayers.length,
        spectators: spectators.length,
        bets: roundState?.bets_json || {},
        hasRaised: roundState?.has_raised_json || {}
    };
}

/**
 * Validate game action
 * @param {Object} room - Room object
 * @param {string} playerId - Player attempting action
 * @param {string} actionType - Type of action
 * @returns {{valid: boolean, error: string|null}} Validation result
 */
export function validateAction(room, playerId, actionType) {
    if (room.phase === 'lobby') {
        return { valid: false, error: 'Game not started' };
    }

    if (room.phase === 'round_end') {
        return { valid: false, error: 'Round is ending' };
    }

    if (actionType === 'play_card' && room.phase !== 'playing') {
        return { valid: false, error: 'Not in playing phase' };
    }

    if (actionType === 'bet' && room.phase !== 'betting') {
        return { valid: false, error: 'Not in betting phase' };
    }

    if ((actionType === 'play_card' || actionType === 'bet') && room.turn_player_id !== playerId) {
        return { valid: false, error: 'Not your turn' };
    }

    return { valid: true, error: null };
}

/**
 * Get next betting turn player
 * @param {Array} activePlayers - Active players
 * @param {number} currentSeatIndex - Current player seat index
 * @param {Object} finalized_json - Finalized flags
 * @returns {Object|null} Next player or null
 */
export function getNextBettingPlayer(activePlayers, currentSeatIndex, finalized_json = {}) {
    // Find next player who hasn't finalized yet
    const totalPlayers = activePlayers.length;
    let attempts = 0;
    let nextIndex = currentSeatIndex;

    while (attempts < totalPlayers) {
        nextIndex = utils.getNextPlayerIndex(nextIndex, activePlayers);
        const nextPlayer = activePlayers.find(p => p.seat_index === nextIndex);

        // Return player if they haven't finalized
        if (nextPlayer && !finalized_json[nextPlayer.id]) {
            return nextPlayer;
        }

        attempts++;
    }

    // All players have finalized
    return null;
}

/**
 * Reset betting phase (for new betting cycle in same round)
 * @param {Object} roundState - Round state object
 */
export function resetBettingPhase(roundState) {
    roundState.bets_json = {};
    roundState.has_raised_json = {};
}

/**
 * Calculate win probability for a hand
 * @param {Array<number>} hand - Player's hand
 * @param {number} tableTotal - Current table total
 * @returns {number} Win probability (0-1)
 */
export function calculateWinProbability(hand, tableTotal) {
    // Simple heuristic: count safe cards vs risky cards
    const safeCards = hand.filter(card => tableTotal + card < GAME_CONSTANTS.BUST_THRESHOLD);

    if (hand.length === 0) return 0;

    return safeCards.length / hand.length;
}

/**
 * Get recommended card to play
 * @param {Array<number>} hand - Player's hand
 * @param {number} tableTotal - Current table total
 * @returns {number|null} Recommended card value or null
 */
export function getRecommendedCard(hand, tableTotal) {
    if (hand.length === 0) return null;

    // Find safest card (highest value that doesn't bust)
    const safeCards = hand.filter(card => tableTotal + card < GAME_CONSTANTS.BUST_THRESHOLD);

    if (safeCards.length > 0) {
        // Play highest safe card
        return Math.max(...safeCards);
    }

    // All cards bust - play lowest value to minimize total
    return Math.min(...hand);
}
