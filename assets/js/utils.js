/**
 * Utility functions for NOT10 game
 */

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
 * Generate a UUID v4
 * @returns {string} UUID
 */
export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
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
 * Convert dollars to cents
 * @param {number} dollars - Amount in dollars
 * @returns {number} Amount in cents
 */
export function dollarsToCents(dollars) {
    return Math.round(dollars * 100);
}

/**
 * Convert cents to dollars
 * @param {number} cents - Amount in cents
 * @returns {number} Amount in dollars
 */
export function centsToDollars(cents) {
    return cents / 100;
}

/**
 * Fisher-Yates shuffle algorithm
 * @param {Array} array - Array to shuffle (in-place)
 * @returns {Array} Shuffled array
 */
export function shuffleArray(array) {
    const arr = [...array]; // Create copy
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
 * Deal cards from a deck
 * @param {number[]} deck - Deck of cards
 * @param {number} count - Number of cards to deal
 * @returns {number[]} Dealt cards
 */
export function dealCards(deck, count) {
    return deck.splice(0, count);
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
 * Debounce function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} Success status
 */
export async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            document.body.removeChild(textArea);
            return true;
        } catch (err) {
            document.body.removeChild(textArea);
            return false;
        }
    }
}

/**
 * Get next player index in clockwise order, skipping spectators
 * @param {number} currentIndex - Current player seat index
 * @param {Array} players - Array of player objects
 * @param {number} maxSeats - Maximum number of seats (default 4)
 * @returns {number} Next active player index
 */
export function getNextPlayerIndex(currentIndex, players, maxSeats = 4) {
    const activePlayers = players.filter(p => p.status === 'active');
    if (activePlayers.length === 0) return -1;
    
    let nextIndex = (currentIndex + 1) % maxSeats;
    let iterations = 0;
    
    // Find next active player
    while (iterations < maxSeats) {
        const player = players.find(p => p.seat_index === nextIndex);
        if (player && player.status === 'active') {
            return nextIndex;
        }
        nextIndex = (nextIndex + 1) % maxSeats;
        iterations++;
    }
    
    return -1; // No active player found
}

/**
 * Get active players in turn order starting from a specific index
 * @param {Array} players - Array of player objects
 * @param {number} startIndex - Starting seat index
 * @returns {Array} Ordered array of active players
 */
export function getPlayersInTurnOrder(players, startIndex) {
    const activePlayers = players
        .filter(p => p.status === 'active')
        .sort((a, b) => a.seat_index - b.seat_index);
    
    if (activePlayers.length === 0) return [];
    
    // Rotate array to start from startIndex
    const startPlayer = activePlayers.findIndex(p => p.seat_index === startIndex);
    if (startPlayer === -1) return activePlayers;
    
    return [
        ...activePlayers.slice(startPlayer),
        ...activePlayers.slice(0, startPlayer)
    ];
}

/**
 * Calculate equal pot split and remainder
 * @param {number} potCents - Pot amount in cents
 * @param {number} numWinners - Number of winners
 * @returns {{perPlayer: number, remainder: number}} Split result
 */
export function calculatePotSplit(potCents, numWinners) {
    if (numWinners === 0) {
        return { perPlayer: 0, remainder: potCents };
    }
    
    const perPlayer = Math.floor(potCents / numWinners);
    const remainder = potCents % numWinners;
    
    return { perPlayer, remainder };
}

/**
 * Clamp a number between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * Get timestamp in ISO format
 * @returns {string} ISO timestamp
 */
export function getTimestamp() {
    return new Date().toISOString();
}

/**
 * Format a timestamp for display
 * @param {string} timestamp - ISO timestamp
 * @returns {string} Formatted time (e.g., "12:34 PM")
 */
export function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit' 
    });
}

/**
 * Check if a value is a valid bet increment
 * @param {number} amount - Bet amount in cents
 * @returns {boolean} Is valid increment
 */
export function isValidBetIncrement(amount) {
    const validIncrements = [10000, 20000, 50000]; // $100, $200, $500 in cents
    return validIncrements.includes(amount);
}

/**
 * Get player by ID from players array
 * @param {Array} players - Array of player objects
 * @param {string} playerId - Player ID to find
 * @returns {Object|null} Player object or null
 */
export function getPlayerById(players, playerId) {
    return players.find(p => p.id === playerId) || null;
}

/**
 * Get player by seat index
 * @param {Array} players - Array of player objects
 * @param {number} seatIndex - Seat index
 * @returns {Object|null} Player object or null
 */
export function getPlayerBySeat(players, seatIndex) {
    return players.find(p => p.seat_index === seatIndex) || null;
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
    
    // Check for invalid characters
    if (!/^[a-zA-Z0-9\s_-]+$/.test(name)) {
        return { valid: false, error: 'Name contains invalid characters' };
    }
    
    return { valid: true, error: null };
}

/**
 * Sanitize HTML to prevent XSS
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
export function sanitizeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Get card emoji/symbol for display
 * @param {number} value - Card value (0-3)
 * @returns {string} Card display string
 */
export function getCardDisplay(value) {
    // Simple numeric display
    return value.toString();
}

/**
 * Check if player can afford bet
 * @param {number} playerMoney - Player's money in cents
 * @param {number} betAmount - Bet amount in cents
 * @returns {boolean} Can afford
 */
export function canAffordBet(playerMoney, betAmount) {
    return playerMoney >= betAmount;
}
