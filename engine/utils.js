/**
 * Server-side deck/turn-order helpers for the NOT10 engine.
 * Pure functions only - no I/O, no DOM. Counterpart to the browser-only
 * helpers (clipboard, HTML sanitizing) that stay in assets/js/utils.js.
 */

/**
 * Fisher-Yates shuffle algorithm
 * @param {Array} array - Array to shuffle
 * @returns {Array} New shuffled array (input is not mutated)
 */
export function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Create a deck of 40 cards (10 of each value: 0, 1, 2, 3)
 * @returns {number[]} Array of card values
 */
export function createDeck() {
    const deck = [];
    for (let value = 0; value <= 3; value++) {
        for (let i = 0; i < 10; i++) {
            deck.push(value);
        }
    }
    return deck;
}

/**
 * Deal cards from a deck (mutates the deck, matching client-side behavior)
 * @param {number[]} deck - Deck of cards
 * @param {number} count - Number of cards to deal
 * @returns {number[]} Dealt cards
 */
export function dealCards(deck, count) {
    return deck.splice(0, count);
}

/**
 * Format cents to dollar string
 * @param {number} cents - Amount in cents
 * @returns {string} Formatted dollar amount (e.g., "$1,234")
 */
export function formatMoney(cents) {
    const dollars = cents / 100;
    return '$' + dollars.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
}

/**
 * Get next player index in clockwise order, skipping non-active players
 * @param {number} currentIndex - Current player seat index
 * @param {Array} players - Array of player objects
 * @param {number} maxSeats - Maximum number of seats (default 4)
 * @returns {number} Next active player index, or -1 if none
 */
export function getNextPlayerIndex(currentIndex, players, maxSeats = 4) {
    const activePlayers = players.filter(p => p.status === 'active');
    if (activePlayers.length === 0) return -1;

    let nextIndex = (currentIndex + 1) % maxSeats;
    let iterations = 0;

    while (iterations < maxSeats) {
        const player = players.find(p => p.seat_index === nextIndex);
        if (player && player.status === 'active') {
            return nextIndex;
        }
        nextIndex = (nextIndex + 1) % maxSeats;
        iterations++;
    }

    return -1;
}

/**
 * Get active players in turn order starting from a specific seat index
 * @param {Array} players - Array of player objects
 * @param {number} startIndex - Starting seat index
 * @returns {Array} Ordered array of active players
 */
export function getPlayersInTurnOrder(players, startIndex) {
    const activePlayers = players
        .filter(p => p.status === 'active')
        .sort((a, b) => a.seat_index - b.seat_index);

    if (activePlayers.length === 0) return [];

    const startPlayer = activePlayers.findIndex(p => p.seat_index === startIndex);
    if (startPlayer === -1) return activePlayers;

    return [
        ...activePlayers.slice(startPlayer),
        ...activePlayers.slice(0, startPlayer)
    ];
}

/**
 * Sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after sleep
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get timestamp in ISO format
 * @returns {string} ISO timestamp
 */
export function getTimestamp() {
    return new Date().toISOString();
}

/**
 * Generate a random 6-character room code
 * @returns {string} Room code (e.g., "ABC123")
 */
export function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars like I, O, 1, 0
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * Validate player name
 * @param {string} name - Player name
 * @returns {{valid: boolean, error: string|null}} Validation result
 */
export function validatePlayerName(name) {
    if (!name || name.trim().length === 0) {
        return { valid: false, error: 'Name cannot be empty' };
    }
    if (name.trim().length > 20) {
        return { valid: false, error: 'Name too long (max 20 characters)' };
    }
    if (!/^[a-zA-Z0-9\s_-]+$/.test(name)) {
        return { valid: false, error: 'Name contains invalid characters' };
    }
    return { valid: true, error: null };
}
