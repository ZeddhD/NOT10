/**
 * LocalStorage utility for NOT10 game
 * Manages persistent player data and session state
 */

const STORAGE_KEYS = {
    PLAYER_ID: 'not10_player_id',
    PLAYER_NAME: 'not10_player_name',
    ROOM_CODE: 'not10_room_code',
    SESSION: 'not10_session'
};

/**
 * Get player ID from storage or generate new one
 * @returns {string} Player ID
 */
export function getOrCreatePlayerId() {
    let playerId = localStorage.getItem(STORAGE_KEYS.PLAYER_ID);
    
    if (!playerId) {
        // Generate new UUID
        playerId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        
        localStorage.setItem(STORAGE_KEYS.PLAYER_ID, playerId);
    }
    
    return playerId;
}

/**
 * Get stored player name
 * @returns {string|null} Player name or null
 */
export function getPlayerName() {
    return localStorage.getItem(STORAGE_KEYS.PLAYER_NAME);
}

/**
 * Save player name to storage
 * @param {string} name - Player name
 */
export function savePlayerName(name) {
    if (name && name.trim()) {
        localStorage.setItem(STORAGE_KEYS.PLAYER_NAME, name.trim());
    }
}

/**
 * Get stored room code
 * @returns {string|null} Room code or null
 */
export function getRoomCode() {
    return localStorage.getItem(STORAGE_KEYS.ROOM_CODE);
}

/**
 * Save room code to storage
 * @param {string} code - Room code
 */
export function saveRoomCode(code) {
    if (code) {
        localStorage.setItem(STORAGE_KEYS.ROOM_CODE, code.toUpperCase());
    }
}

/**
 * Clear room code from storage
 */
export function clearRoomCode() {
    localStorage.removeItem(STORAGE_KEYS.ROOM_CODE);
}

/**
 * Save session data
 * @param {Object} session - Session object
 */
export function saveSession(session) {
    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
}

/**
 * Get saved session data
 * @returns {Object|null} Session object or null
 */
export function getSession() {
    const data = localStorage.getItem(STORAGE_KEYS.SESSION);
    if (data) {
        try {
            return JSON.parse(data);
        } catch (err) {
            console.error('Failed to parse session:', err);
            return null;
        }
    }
    return null;
}

/**
 * Clear session data
 */
export function clearSession() {
    localStorage.removeItem(STORAGE_KEYS.SESSION);
}

/**
 * Clear all NOT10 data from storage
 */
export function clearAllData() {
    Object.values(STORAGE_KEYS).forEach(key => {
        localStorage.removeItem(key);
    });
}

/**
 * Check if player has an active session
 * @returns {boolean} Has active session
 */
export function hasActiveSession() {
    return !!(getRoomCode() && getSession());
}

/**
 * Get user preferences (stub for future expansion)
 * @returns {Object} User preferences
 */
export function getPreferences() {
    return {
        soundEnabled: true,
        animationsEnabled: true
    };
}

/**
 * Save user preferences (stub for future expansion)
 * @param {Object} prefs - Preferences object
 */
export function savePreferences(prefs) {
    // Future implementation
    console.log('Preferences saved:', prefs);
}
