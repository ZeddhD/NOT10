-- NOT10 Database Schema
-- Run this in Supabase SQL Editor to create all required tables

-- ==========================================
-- ROOMS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'lobby', -- 'lobby', 'in_game', 'finished'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    current_round INTEGER DEFAULT 0,
    starting_player_index INTEGER DEFAULT 0,
    pot_cents INTEGER DEFAULT 0,
    table_total INTEGER DEFAULT 0,
    phase TEXT DEFAULT 'lobby', -- 'lobby', 'dealing', 'betting', 'playing', 'round_end'
    turn_player_id TEXT
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);

-- ==========================================
-- PLAYERS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
    name TEXT NOT NULL,
    seat_index INTEGER NOT NULL CHECK (seat_index >= 0 AND seat_index < 4),
    money_cents INTEGER DEFAULT 100000, -- Starting money: $1000
    status TEXT DEFAULT 'active', -- 'active', 'spectator'
    is_ready BOOLEAN DEFAULT FALSE,
    is_bot BOOLEAN DEFAULT FALSE, -- TRUE if AI-controlled player
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_players_room_code ON players(room_code);
CREATE INDEX IF NOT EXISTS idx_players_seat ON players(room_code, seat_index);

-- Ensure unique seat per room
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_unique_seat ON players(room_code, seat_index);

-- ==========================================
-- ROUND STATE TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS round_state (
    room_code TEXT PRIMARY KEY REFERENCES rooms(code) ON DELETE CASCADE,
    round_no INTEGER NOT NULL,
    deck_json JSONB DEFAULT '[]', -- Remaining deck
    eliminated_player_id TEXT,
    bets_json JSONB DEFAULT '{}', -- {player_id: bet_amount}
    has_raised_json JSONB DEFAULT '{}', -- {player_id: boolean}
    played_count INTEGER DEFAULT 0,
    log_json JSONB DEFAULT '[]' -- Array of log entries
);

-- Index
CREATE INDEX IF NOT EXISTS idx_round_state_room ON round_state(room_code);

-- ==========================================
-- HAND CARDS TABLE (Secure per-player storage)
-- ==========================================
CREATE TABLE IF NOT EXISTS hand_cards (
    id SERIAL PRIMARY KEY,
    room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
    round_no INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    card_index INTEGER NOT NULL,
    value INTEGER NOT NULL CHECK (value >= 0 AND value <= 3)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hand_cards_room ON hand_cards(room_code);
CREATE INDEX IF NOT EXISTS idx_hand_cards_player ON hand_cards(room_code, round_no, player_id);

-- Unique constraint for card positions
CREATE UNIQUE INDEX IF NOT EXISTS idx_hand_cards_unique 
    ON hand_cards(room_code, round_no, player_id, card_index);

-- ==========================================
-- ACTIONS TABLE (Event log for debugging and audit)
-- ==========================================
CREATE TABLE IF NOT EXISTS actions (
    id SERIAL PRIMARY KEY,
    room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actor_player_id TEXT NOT NULL,
    type TEXT NOT NULL, -- 'raise', 'call', 'play_card', 'ready', 'start_game', etc.
    payload JSONB DEFAULT '{}'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_actions_room ON actions(room_code);
CREATE INDEX IF NOT EXISTS idx_actions_created ON actions(created_at);
CREATE INDEX IF NOT EXISTS idx_actions_room_created ON actions(room_code, created_at);

-- ==========================================
-- FUNCTIONS & TRIGGERS (Optional cleanup)
-- ==========================================

-- Function to clean up old finished games (optional)
CREATE OR REPLACE FUNCTION cleanup_old_games()
RETURNS void AS $$
BEGIN
    DELETE FROM rooms 
    WHERE status = 'finished' 
    AND created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- You can schedule this function to run periodically via pg_cron or external service

-- ==========================================
-- COMMENTS
-- ==========================================

COMMENT ON TABLE rooms IS 'Game rooms/lobbies';
COMMENT ON TABLE players IS 'Players in rooms';
COMMENT ON TABLE round_state IS 'Current round state for each active game';
COMMENT ON TABLE hand_cards IS 'Individual player hand cards (secure storage)';
COMMENT ON TABLE actions IS 'Game action log for debugging and audit';

-- Done! All tables created successfully.
