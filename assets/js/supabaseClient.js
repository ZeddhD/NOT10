/**
 * Supabase client for NOT10
 * Handles database connections and real-time subscriptions
 */

let supabase = null;
let isInitialized = false;

/**
 * Initialize Supabase client
 * @param {string} url - Supabase project URL
 * @param {string} anonKey - Supabase anon key
 * @returns {Object} Supabase client instance
 */
export async function initSupabase(url, anonKey) {
    try {
        // Import Supabase from CDN
        const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        
        supabase = createClient(url, anonKey, {
            realtime: {
                params: {
                    eventsPerSecond: 10
                }
            }
        });
        
        isInitialized = true;
        console.log('Supabase initialized successfully');
        return supabase;
    } catch (error) {
        console.error('Failed to initialize Supabase:', error);
        throw error;
    }
}

/**
 * Get Supabase client instance
 * @returns {Object|null} Supabase client or null
 */
export function getSupabase() {
    if (!isInitialized) {
        console.warn('Supabase not initialized');
        return null;
    }
    return supabase;
}

/**
 * Check if Supabase is initialized
 * @returns {boolean} Is initialized
 */
export function isSupabaseReady() {
    return isInitialized && supabase !== null;
}

// ==========================================
// ROOM OPERATIONS
// ==========================================

/**
 * Create a new room
 * @param {string} code - Room code
 * @param {string} hostId - Host player ID
 * @returns {Object} Created room
 */
export async function createRoom(code, hostId) {
    const { data, error } = await supabase
        .from('rooms')
        .insert({
            code: code.toUpperCase(),
            host_id: hostId,
            status: 'lobby',
            current_round: 0,
            starting_player_index: 0,
            pot_cents: 0,
            table_total: 0,
            phase: 'lobby'
        })
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Get room by code
 * @param {string} code - Room code
 * @returns {Object|null} Room data or null
 */
export async function getRoom(code) {
    const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', code.toUpperCase())
        .single();
    
    if (error) {
        console.error('Error fetching room:', error);
        return null;
    }
    return data;
}

/**
 * Update room data
 * @param {string} code - Room code
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated room
 */
export async function updateRoom(code, updates) {
    const { data, error } = await supabase
        .from('rooms')
        .update(updates)
        .eq('code', code.toUpperCase())
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Subscribe to room changes
 * @param {string} code - Room code
 * @param {Function} callback - Callback function for updates
 * @returns {Object} Subscription object
 */
export function subscribeToRoom(code, callback) {
    return supabase
        .channel(`room:${code}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'rooms',
            filter: `code=eq.${code.toUpperCase()}`
        }, callback)
        .subscribe();
}

// ==========================================
// PLAYER OPERATIONS
// ==========================================

/**
 * Create a new player in a room
 * @param {Object} playerData - Player data (id, room_code, name, seat_index)
 * @returns {Object} Created player
 */
export async function createPlayer(playerData) {
    const { data, error } = await supabase
        .from('players')
        .insert({
            id: playerData.id,
            room_code: playerData.room_code.toUpperCase(),
            name: playerData.name,
            seat_index: playerData.seat_index,
            money_cents: playerData.money_cents || 100000, // Default $1000
            status: 'active',
            is_ready: false,
            is_bot: playerData.is_bot || false,
            last_seen: new Date().toISOString()
        })
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Create or update a bot player (idempotent)
 * @param {string} roomCode - Room code
 * @param {number} seatIndex - Seat index
 * @param {string} personality - Bot personality
 * @returns {Object} Bot player
 */
export async function upsertBotPlayer(roomCode, seatIndex, personality) {
    const botId = `bot_${roomCode}_${seatIndex}`;
    const botName = `BOT ${personality}`;
    
    // Check if bot exists
    const { data: existing } = await supabase
        .from('players')
        .select('*')
        .eq('id', botId)
        .eq('room_code', roomCode.toUpperCase())
        .single();
    
    if (existing) {
        // Update last_seen
        const { data, error } = await supabase
            .from('players')
            .update({ last_seen: new Date().toISOString() })
            .eq('id', botId)
            .select()
            .single();
        if (error) throw error;
        return data;
    }
    
    // Create new bot
    const { data, error } = await supabase
        .from('players')
        .insert({
            id: botId,
            room_code: roomCode.toUpperCase(),
            name: botName,
            seat_index: seatIndex,
            money_cents: 100000,
            status: 'active',
            is_ready: true,
            is_bot: true,
            last_seen: new Date().toISOString()
        })
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Get all players in a room
 * @param {string} roomCode - Room code
 * @returns {Array} Array of players
 */
export async function getPlayers(roomCode) {
    const { data, error } = await supabase
        .from('players')
        .select('*')
        .eq('room_code', roomCode.toUpperCase())
        .order('seat_index', { ascending: true });
    
    if (error) {
        console.error('Error fetching players:', error);
        return [];
    }
    return data || [];
}

/**
 * Update player data
 * @param {string} playerId - Player ID
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated player
 */
export async function updatePlayer(playerId, updates) {
    const { data, error } = await supabase
        .from('players')
        .update({ ...updates, last_seen: new Date().toISOString() })
        .eq('id', playerId)
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Find available seat in room
 * @param {string} roomCode - Room code
 * @returns {number} Available seat index (0-3) or -1 if full
 */
export async function findAvailableSeat(roomCode) {
    const players = await getPlayers(roomCode);
    const takenSeats = players.map(p => p.seat_index);
    
    for (let i = 0; i < 4; i++) {
        if (!takenSeats.includes(i)) {
            return i;
        }
    }
    
    return -1; // Room is full
}

/**
 * Subscribe to players changes in a room
 * @param {string} roomCode - Room code
 * @param {Function} callback - Callback function for updates
 * @returns {Object} Subscription object
 */
export function subscribeToPlayers(roomCode, callback) {
    return supabase
        .channel(`players:${roomCode}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'players',
            filter: `room_code=eq.${roomCode.toUpperCase()}`
        }, callback)
        .subscribe();
}

// ==========================================
// ROUND STATE OPERATIONS
// ==========================================

/**
 * Initialize round state
 * @param {string} roomCode - Room code
 * @param {number} roundNo - Round number
 * @param {Object} initialState - Initial round state
 * @returns {Object} Created round state
 */
export async function initRoundState(roomCode, roundNo, initialState) {
    // Delete existing round state
    await supabase
        .from('round_state')
        .delete()
        .eq('room_code', roomCode.toUpperCase());
    
    // Insert new round state
    const { data, error } = await supabase
        .from('round_state')
        .insert({
            room_code: roomCode.toUpperCase(),
            round_no: roundNo,
            deck_json: initialState.deck_json || [],
            eliminated_player_id: null,
            bets_json: initialState.bets_json || {},
            has_raised_json: initialState.has_raised_json || {},
            played_count: 0,
            log_json: initialState.log_json || []
        })
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Get round state
 * @param {string} roomCode - Room code
 * @returns {Object|null} Round state or null
 */
export async function getRoundState(roomCode) {
    const { data, error } = await supabase
        .from('round_state')
        .select('*')
        .eq('room_code', roomCode.toUpperCase())
        .single();
    
    if (error) {
        console.error('Error fetching round state:', error);
        return null;
    }
    return data;
}

/**
 * Update round state
 * @param {string} roomCode - Room code
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated round state
 */
export async function updateRoundState(roomCode, updates) {
    const { data, error } = await supabase
        .from('round_state')
        .update(updates)
        .eq('room_code', roomCode.toUpperCase())
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Subscribe to round state changes
 * @param {string} roomCode - Room code
 * @param {Function} callback - Callback function for updates
 * @returns {Object} Subscription object
 */
export function subscribeToRoundState(roomCode, callback) {
    return supabase
        .channel(`round_state:${roomCode}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'round_state',
            filter: `room_code=eq.${roomCode.toUpperCase()}`
        }, callback)
        .subscribe();
}

// ==========================================
// HAND CARDS OPERATIONS
// ==========================================

/**
 * Save player hand cards
 * @param {string} roomCode - Room code
 * @param {number} roundNo - Round number
 * @param {string} playerId - Player ID
 * @param {Array<number>} cards - Array of card values
 * @returns {Array} Inserted cards
 */
export async function saveHandCards(roomCode, roundNo, playerId, cards) {
    // Delete existing hand cards for this player
    await supabase
        .from('hand_cards')
        .delete()
        .eq('room_code', roomCode.toUpperCase())
        .eq('round_no', roundNo)
        .eq('player_id', playerId);
    
    // Insert new cards
    const cardsToInsert = cards.map((value, index) => ({
        room_code: roomCode.toUpperCase(),
        round_no: roundNo,
        player_id: playerId,
        card_index: index,
        value: value
    }));
    
    const { data, error } = await supabase
        .from('hand_cards')
        .insert(cardsToInsert)
        .select();
    
    if (error) throw error;
    return data;
}

/**
 * Get player hand cards
 * @param {string} roomCode - Room code
 * @param {number} roundNo - Round number
 * @param {string} playerId - Player ID
 * @returns {Array<number>} Array of card values
 */
export async function getHandCards(roomCode, roundNo, playerId) {
    const { data, error } = await supabase
        .from('hand_cards')
        .select('*')
        .eq('room_code', roomCode.toUpperCase())
        .eq('round_no', roundNo)
        .eq('player_id', playerId)
        .order('card_index', { ascending: true });
    
    if (error) {
        console.error('Error fetching hand cards:', error);
        return [];
    }
    
    return data ? data.map(card => card.value) : [];
}

/**
 * Get bot hand cards (host can read all bot hands in their room)
 * @param {string} roomCode - Room code
 * @param {number} roundNo - Round number
 * @param {string} botId - Bot player ID
 * @returns {Array<number>} Array of card values
 */
export async function getBotHandCards(roomCode, roundNo, botId) {
    // Same as getHandCards but semantically clear it's for bots
    return getHandCards(roomCode, roundNo, botId);
}

/**
 * Remove a card from player's hand
 * @param {string} roomCode - Room code
 * @param {number} roundNo - Round number
 * @param {string} playerId - Player ID
 * @param {number} cardValue - Card value to remove
 * @returns {boolean} Success
 */
export async function removeCardFromHand(roomCode, roundNo, playerId, cardValue) {
    // Get all cards
    const { data: cards } = await supabase
        .from('hand_cards')
        .select('*')
        .eq('room_code', roomCode.toUpperCase())
        .eq('round_no', roundNo)
        .eq('player_id', playerId)
        .order('card_index', { ascending: true });
    
    if (!cards || cards.length === 0) return false;
    
    // Find first card with matching value
    const cardToRemove = cards.find(c => c.value === cardValue);
    if (!cardToRemove) return false;
    
    // Delete the card
    const { error } = await supabase
        .from('hand_cards')
        .delete()
        .eq('room_code', roomCode.toUpperCase())
        .eq('round_no', roundNo)
        .eq('player_id', playerId)
        .eq('card_index', cardToRemove.card_index);
    
    if (error) {
        console.error('Error removing card:', error);
        return false;
    }
    
    return true;
}

/**
 * Subscribe to hand cards changes for a player
 * @param {string} roomCode - Room code
 * @param {string} playerId - Player ID
 * @param {Function} callback - Callback function
 * @returns {Object} Subscription object
 */
export function subscribeToHandCards(roomCode, playerId, callback) {
    return supabase
        .channel(`hand_cards:${roomCode}:${playerId}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'hand_cards',
            filter: `room_code=eq.${roomCode.toUpperCase()}`
        }, callback)
        .subscribe();
}

// ==========================================
// ACTIONS LOG
// ==========================================

/**
 * Log an action
 * @param {string} roomCode - Room code
 * @param {string} actorPlayerId - Player performing action
 * @param {string} type - Action type
 * @param {Object} payload - Action payload
 * @returns {Object} Created action
 */
export async function logAction(roomCode, actorPlayerId, type, payload) {
    const { data, error } = await supabase
        .from('actions')
        .insert({
            room_code: roomCode.toUpperCase(),
            actor_player_id: actorPlayerId,
            type: type,
            payload: payload,
            created_at: new Date().toISOString()
        })
        .select()
        .single();
    
    if (error) {
        console.error('Error logging action:', error);
        return null;
    }
    return data;
}

/**
 * Subscribe to actions in a room
 * @param {string} roomCode - Room code
 * @param {Function} callback - Callback function
 * @returns {Object} Subscription object
 */
export function subscribeToActions(roomCode, callback) {
    return supabase
        .channel(`actions:${roomCode}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'actions',
            filter: `room_code=eq.${roomCode.toUpperCase()}`
        }, callback)
        .subscribe();
}

// ==========================================
// CLEANUP
// ==========================================

/**
 * Unsubscribe from a channel
 * @param {Object} subscription - Subscription object
 */
export async function unsubscribe(subscription) {
    if (subscription) {
        await supabase.removeChannel(subscription);
    }
}

/**
 * Unsubscribe from all channels
 */
export async function unsubscribeAll() {
    if (supabase) {
        await supabase.removeAllChannels();
    }
}
