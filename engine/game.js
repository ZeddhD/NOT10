/**
 * Game logic for NOT10
 * Pure rules engine: no network, no storage, no DOM. Every exported
 * function takes plain state objects, mutates them in place, and returns a
 * plain result object. server/rooms.js is the only thing that calls this
 * module and is responsible for broadcasting the resulting state - this
 * module has no idea a network exists, which is what makes
 * tests/game.test.js able to run headlessly.
 */

import * as utils from './utils.js';

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
 * @returns {Object} Round initialization data
 */
export function startNewRound(room, players) {
    // Money alone decides whether the game is already over - same
    // definition checkGameOver() uses. Requiring status === 'active' too
    // (as this used to) meant that if status ever lagged behind money for
    // any reason, this check would silently miss it and deal another
    // round to a table that should have already ended, instead of
    // declaring the lone player with money left the winner.
    const playersWithMoney = players.filter(p => p.money_cents > 0);
    if (playersWithMoney.length < 2) {
        return { gameOver: true, winner: playersWithMoney[0] || players[0] };
    }

    // Keep status in sync with money for anyone who wasn't already
    // marked - including a player eliminated last round (endRound
    // doesn't touch status; they're broke but still nominally 'active'
    // until this catches them here).
    for (const player of players) {
        if (player.money_cents <= 0 && player.status === 'active') {
            player.status = 'spectator';
        }
    }

    const activePlayers = players.filter(p => p.money_cents > 0 && p.status === 'active');

    const newRoundNo = room.current_round + 1;

    const cardsPerPlayer = activePlayers.length >= 3
        ? GAME_CONSTANTS.CARDS_PER_PLAYER_4
        : GAME_CONSTANTS.CARDS_PER_PLAYER_2;

    let deck = utils.createDeck();
    deck = utils.shuffleArray(deck);

    const hands = {};
    for (const player of activePlayers) {
        hands[player.id] = utils.dealCards(deck, cardsPerPlayer);
    }

    const roundState = {
        round_no: newRoundNo,
        eliminated_player_id: null,
        bets_json: {},
        has_raised_json: {},
        bet_action_count_json: {},
        finalized_json: {},
        // Sequence number of the action that last set each player's bet -
        // records the actual chronological order bets landed in, since
        // seat order alone doesn't: a player can raise again on a later
        // lap, landing well after someone else's single earlier action
        // even if that player's seat comes first. Used to break ties on
        // who "reached" the highest bet first (see transitionToPlaying).
        bet_sequence_json: {},
        action_counter: 0,
        highest_bettor_id: null,
        highest_bet: 0,
        awaiting_position_choice: false,
        played_count: 0,
        log_json: [{
            type: 'round_start',
            message: `Round ${newRoundNo} started`,
            timestamp: utils.getTimestamp()
        }]
    };

    const orderedPlayers = utils.getPlayersInTurnOrder(activePlayers, room.starting_player_index);
    const currentTurnPlayer = orderedPlayers[0];

    room.current_round = newRoundNo;
    room.table_total = 0;
    room.phase = 'betting';
    room.turn_player_id = currentTurnPlayer.id;

    return {
        gameOver: false,
        round: newRoundNo,
        hands,
        roundState,
        startingPlayer: currentTurnPlayer,
        activePlayers
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
    const player = players.find(p => p.id === playerId);
    if (!player || player.status !== 'active') {
        return { success: false, error: 'Player not active' };
    }
    // processCardPlay has always enforced this; betting never did, so any
    // active player could act out of turn during the betting phase.
    if (room.turn_player_id !== playerId) {
        return { success: false, error: 'Not your turn' };
    }

    const bets = roundState.bets_json || {};
    const betSequence = roundState.bet_sequence_json || {};
    // Records exactly when (in true action order, not seat order) each
    // player's current bet amount was set - see the field's definition in
    // startNewRound for why seat order alone can't be trusted for this.
    const bumpBetSequence = (id) => {
        roundState.action_counter = (roundState.action_counter || 0) + 1;
        betSequence[id] = roundState.action_counter;
        roundState.bet_sequence_json = betSequence;
    };
    const hasRaised = roundState.has_raised_json || {};
    const actionCount = roundState.bet_action_count_json || {};
    const finalized = roundState.finalized_json || {};
    const currentPlayerBet = bets[playerId] || 0;

    const tableHighestBet = Math.max(0, ...Object.values(bets));

    if (action === 'finalize') {
        const playerActions = actionCount[playerId] || 0;
        if (playerActions < 1) {
            return { success: false, error: 'You must bet or call before finalizing.' };
        }

        const activePlayers = players.filter(p => p.status === 'active');
        const allPlayersActed = activePlayers.every(p => (actionCount[p.id] || 0) >= 1);
        if (!allPlayersActed) {
            return { success: false, error: 'Cannot finalize until all players have bet at least once.' };
        }

        if (currentPlayerBet < 10000 && player.money_cents > 0) {
            return { success: false, error: 'Minimum bet is $100. Please bet or go all-in.' };
        }

        finalized[playerId] = true;
        roundState.finalized_json = finalized;
        roundState.log_json.push({
            type: 'finalize',
            playerId,
            playerName: player.name,
            amount: currentPlayerBet,
            message: `${player.name} finalized bet at ${utils.formatMoney(currentPlayerBet)}`,
            timestamp: utils.getTimestamp()
        });

        return { success: true, action: 'finalize', amount: currentPlayerBet };
    }

    if (action === 'bet') {
        if (!GAME_CONSTANTS.RAISE_AMOUNTS.includes(amount) && amount !== player.money_cents) {
            return { success: false, error: 'Invalid bet amount' };
        }
        if (player.money_cents < amount) {
            return { success: false, error: 'Insufficient funds' };
        }

        const newPlayerBet = currentPlayerBet + amount;
        bets[playerId] = newPlayerBet;
        bumpBetSequence(playerId);
        player.money_cents -= amount;
        room.pot_cents += amount;

        const isRaise = newPlayerBet > tableHighestBet;
        if (isRaise) hasRaised[playerId] = true;
        actionCount[playerId] = (actionCount[playerId] || 0) + 1;

        // A regular bet/raise (not just the ALL-IN button) can also empty a
        // player's stack, e.g. betting their exact last $100 - if so there
        // is no possible further action, so auto-finalize the same as
        // CALL/ALL-IN do, instead of stranding them on their own turn with
        // every button correctly disabled and nothing left to click.
        if (player.money_cents === 0) {
            finalized[playerId] = true;
            roundState.finalized_json = finalized;
        }

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

        return { success: true, action: isRaise ? 'raise' : 'bet', amount, newTotal: newPlayerBet };

    } else if (action === 'call') {
        // Nothing to call yet - every player must place a real bet each
        // round (no free check). tableHighestBet === 0 implies this
        // player's own bet is also 0 (it can never exceed the table high).
        if (tableHighestBet === 0) {
            return { success: false, error: 'You must bet before you can call. Minimum bet is $100 (or all-in).' };
        }

        const callAmount = Math.max(0, tableHighestBet - currentPlayerBet);

        if (callAmount > 0) {
            if (player.money_cents < callAmount) {
                return { success: false, error: 'Insufficient funds to call - use ALL-IN instead' };
            }
            player.money_cents -= callAmount;
            room.pot_cents += callAmount;
            bets[playerId] = tableHighestBet;
            bumpBetSequence(playerId);
            roundState.bets_json = bets;
        }

        actionCount[playerId] = (actionCount[playerId] || 0) + 1;
        roundState.bet_action_count_json = actionCount;
        // CALL auto-finalizes (documented in the help modal) - there's
        // nothing left to decide once you've matched the table, so
        // requiring a separate FINALIZE click would just strand the
        // player on a "your turn" screen with no valid action to take.
        finalized[playerId] = true;
        roundState.finalized_json = finalized;
        roundState.log_json.push({
            type: 'call',
            playerId,
            playerName: player.name,
            amount: callAmount,
            message: callAmount > 0 ? `${player.name} called $${callAmount / 100}` : `${player.name} matched the bet`,
            timestamp: utils.getTimestamp()
        });

        return { success: true, action: 'call', amount: callAmount };

    } else if (action === 'all-in') {
        const allInAmount = player.money_cents;
        if (allInAmount === 0) {
            return { success: false, error: 'No money to go all-in' };
        }

        const newPlayerBet = currentPlayerBet + allInAmount;
        bets[playerId] = newPlayerBet;
        bumpBetSequence(playerId);
        player.money_cents = 0;
        room.pot_cents += allInAmount;

        const isRaise = newPlayerBet > tableHighestBet;
        if (isRaise) hasRaised[playerId] = true;
        actionCount[playerId] = (actionCount[playerId] || 0) + 1;

        roundState.bets_json = bets;
        roundState.has_raised_json = hasRaised;
        roundState.bet_action_count_json = actionCount;
        // ALL-IN auto-finalizes (documented in the help modal) - a player
        // with $0 left has no further bet/call/all-in action available,
        // so without this they'd be stuck on "your turn" with every
        // button disabled and no way to proceed.
        finalized[playerId] = true;
        roundState.finalized_json = finalized;
        roundState.log_json.push({
            type: 'all-in',
            playerId,
            playerName: player.name,
            amount: allInAmount,
            newTotal: newPlayerBet,
            message: `${player.name} went ALL-IN $${allInAmount / 100}!`,
            timestamp: utils.getTimestamp()
        });

        return { success: true, action: 'all-in', amount: allInAmount, newTotal: newPlayerBet };
    }

    return { success: false, error: 'Invalid action' };
}

/**
 * Check if betting phase is complete
 * @param {Array} activePlayers - Active players
 * @param {Object} finalized - Finalized flags
 * @returns {boolean} Is betting complete
 */
export function isBettingComplete(activePlayers, finalized) {
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
    const bets = roundState.bets_json || {};
    const betSequence = roundState.bet_sequence_json || {};
    const orderedPlayers = utils.getPlayersInTurnOrder(activePlayers, room.starting_player_index);

    let highestBet = 0;
    let highestBettorId = null;
    let highestBettorSeq = Infinity;

    // Ties go to whoever actually reached this bet amount first - which is
    // NOT the same as raw seat order. A player can raise again on a later
    // lap (once betting has already gone all the way around once), landing
    // well after someone else's single earlier action even though their
    // seat comes first in the static rotation. bet_sequence_json records
    // the true action order, so use that instead of orderedPlayers here.
    for (const player of orderedPlayers) {
        const playerBet = bets[player.id] || 0;
        if (playerBet <= 0) continue;
        const seq = betSequence[player.id] ?? Infinity;
        if (playerBet > highestBet || (playerBet === highestBet && seq < highestBettorSeq)) {
            highestBet = playerBet;
            highestBettorId = player.id;
            highestBettorSeq = seq;
        }
    }

    const highestBettor = activePlayers.find(p => p.id === highestBettorId);

    if (highestBettorId && highestBet > 0) {
        const tiedPlayers = orderedPlayers.filter(p => (bets[p.id] || 0) === highestBet);
        if (tiedPlayers.length > 1) {
            const others = tiedPlayers.filter(p => p.id !== highestBettorId).map(p => p.name).join(', ');
            roundState.log_json.push({
                type: 'tie_break',
                playerId: highestBettorId,
                playerName: highestBettor.name,
                message: `${highestBettor.name} tied with ${others} at ${utils.formatMoney(highestBet)} - ${highestBettor.name} gets the choice for reaching it first`,
                timestamp: utils.getTimestamp()
            });
        }

        roundState.highest_bettor_id = highestBettorId;
        roundState.highest_bet = highestBet;
        roundState.awaiting_position_choice = true;
    }

    room.phase = 'playing';
    // The card-play turn order for the whole round - processCardPlay
    // advances through this list, not raw seat_index adjacency, so a
    // spectator sitting between two active seats (or a later position
    // choice) doesn't get silently re-derived and skip someone.
    roundState.play_order = orderedPlayers.map(p => p.id);
    // Was previously never set here - when no position choice was needed,
    // turn_player_id was left at whatever it was from betting (stale),
    // which could desync from play_order[0] and make the first card
    // play look like the same player going twice. applyPositionChoice
    // overwrites this right after, when a choice does happen.
    room.turn_player_id = orderedPlayers[0]?.id ?? room.turn_player_id;

    return {
        success: true,
        highestBettorId,
        highestBet,
        highestBettor,
        needsPositionChoice: !!(highestBettorId && highestBet > 0)
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
    const highestBettorId = roundState.highest_bettor_id;
    const highestBet = roundState.highest_bet;

    let orderedPlayers = utils.getPlayersInTurnOrder(activePlayers, room.starting_player_index);
    const highestBettor = orderedPlayers.find(p => p.id === highestBettorId);
    const highestBettorIndex = orderedPlayers.findIndex(p => p.id === highestBettorId);

    if (choice === 'last' && highestBettorIndex !== -1 && highestBettorIndex !== orderedPlayers.length - 1) {
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
        roundState.log_json.push({
            type: 'play_order',
            playerId: highestBettorId,
            playerName: highestBettor.name,
            message: `${highestBettor.name} bet the most (${utils.formatMoney(highestBet)}) and stays in current position`,
            timestamp: utils.getTimestamp()
        });
    }

    const firstPlayer = orderedPlayers[0];
    roundState.awaiting_position_choice = false;
    roundState.play_order = orderedPlayers.map(p => p.id);
    room.turn_player_id = firstPlayer.id;

    return { success: true, firstPlayer };
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
    const player = players.find(p => p.id === playerId);
    if (!player || player.status !== 'active') {
        return { success: false, error: 'Player not active' };
    }
    if (room.turn_player_id !== playerId) {
        return { success: false, error: 'Not your turn' };
    }

    const newTotal = room.table_total + cardValue;
    room.table_total = newTotal;

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

    if (newTotal >= GAME_CONSTANTS.BUST_THRESHOLD) {
        return { success: true, bust: true, eliminatedPlayer: player, total: newTotal };
    }

    // Advance through the round's established play order (set once by
    // transitionToPlaying/applyPositionChoice), not raw seat_index math -
    // that ignored a GO FIRST/GO LAST choice for every card after the
    // first one, and could skip an active player entirely.
    const order = roundState.play_order || [];
    const myOrderIndex = order.indexOf(playerId);
    let nextPlayer = myOrderIndex !== -1
        ? players.find(p => p.id === order[(myOrderIndex + 1) % order.length] && p.status === 'active')
        : null;
    // Hard invariant: the same player must never get two turns in a row.
    // If play_order didn't resolve a next player for any reason, fall
    // back to seat-order adjacency rather than silently leaving
    // turn_player_id unchanged (which is exactly what a repeat looks like).
    if (!nextPlayer) {
        const activePlayers = players.filter(p => p.status === 'active');
        const nextIdx = utils.getNextPlayerIndex(player.seat_index, activePlayers);
        nextPlayer = activePlayers.find(p => p.seat_index === nextIdx);
    }

    if (nextPlayer) {
        room.turn_player_id = nextPlayer.id;
    }

    return { success: true, bust: false, total: newTotal, nextPlayer };
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
    const activePlayers = players.filter(p => p.status === 'active');
    const survivors = activePlayers.filter(p => p.id !== eliminatedPlayerId);
    const bets = roundState.bets_json || {};

    const totalSurvivorBets = survivors.reduce((sum, s) => sum + (bets[s.id] || 0), 0);
    const potDistributions = {};
    let totalDistributed = 0;

    for (let i = 0; i < survivors.length; i++) {
        const survivor = survivors[i];
        const survivorBet = bets[survivor.id] || 0;

        let share;
        if (totalSurvivorBets === 0) {
            share = Math.floor(room.pot_cents / survivors.length);
        } else {
            share = Math.floor(room.pot_cents * (survivorBet / totalSurvivorBets));
        }
        if (i === survivors.length - 1) {
            share = room.pot_cents - totalDistributed;
        }

        survivor.money_cents += share;
        potDistributions[survivor.id] = share;
        totalDistributed += share;
    }

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

    // Sync status to money right now rather than waiting for the next
    // startNewRound - a player eliminated this round (or a survivor whose
    // floor-rounded share left them at exactly $0) should read as
    // "spectating" the moment the round ends, not sit in limbo showing
    // neither an active turn nor a spectator tag until the next deal.
    for (const player of players) {
        if (player.money_cents <= 0 && player.status === 'active') {
            player.status = 'spectator';
        }
    }

    const nextStartingIndex = (room.starting_player_index + 1) % GAME_CONSTANTS.MAX_PLAYERS;

    room.phase = 'round_end';
    room.pot_cents = 0;
    room.starting_player_index = nextStartingIndex;

    return { success: true, survivors, potDistributions, totalDistributed, nextStartingIndex };
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
 * Get next betting turn player
 * @param {Array} activePlayers - Active players
 * @param {number} currentSeatIndex - Current player seat index
 * @param {Object} finalizedJson - Finalized flags
 * @returns {Object|null} Next player or null
 */
export function getNextBettingPlayer(activePlayers, currentSeatIndex, finalizedJson = {}) {
    const totalPlayers = activePlayers.length;
    let attempts = 0;
    let nextIndex = currentSeatIndex;

    while (attempts < totalPlayers) {
        nextIndex = utils.getNextPlayerIndex(nextIndex, activePlayers);
        const nextPlayer = activePlayers.find(p => p.seat_index === nextIndex);
        if (nextPlayer && !finalizedJson[nextPlayer.id]) {
            return nextPlayer;
        }
        attempts++;
    }
    return null;
}

/**
 * Evaluate a hand's strength (0-1) for AI decisions - shared with engine/ai.js
 * @param {Array<number>} hand - Player's hand
 * @param {number} tableTotal - Current table total
 * @returns {number} Strength score (0-1)
 */
export function calculateWinProbability(hand, tableTotal) {
    if (hand.length === 0) return 0;
    const safeCards = hand.filter(card => tableTotal + card < GAME_CONSTANTS.BUST_THRESHOLD);
    return safeCards.length / hand.length;
}
