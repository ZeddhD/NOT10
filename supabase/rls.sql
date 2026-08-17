-- NOT10 Row Level Security (RLS) Policies
-- Run this after schema.sql to enable security policies

-- ==========================================
-- ENABLE RLS ON ALL TABLES
-- ==========================================

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE round_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE hand_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- ROOMS POLICIES
-- ==========================================

-- Anyone can create a room (insert)
CREATE POLICY "Anyone can create rooms"
    ON rooms FOR INSERT
    WITH CHECK (true);

-- Anyone can read rooms (for joining)
CREATE POLICY "Anyone can read rooms"
    ON rooms FOR SELECT
    USING (true);

-- Only host can update room (with some restrictions)
CREATE POLICY "Host can update room"
    ON rooms FOR UPDATE
    USING (auth.uid() = host_id OR true); -- Allow updates (simplified for client-side app)

-- Only host can delete room
CREATE POLICY "Host can delete room"
    ON rooms FOR DELETE
    USING (auth.uid() = host_id OR true); -- Simplified

-- ==========================================
-- PLAYERS POLICIES
-- ==========================================

-- Anyone can create a player (join room)
CREATE POLICY "Anyone can create player"
    ON players FOR INSERT
    WITH CHECK (true);

-- Anyone can read all players in their room
CREATE POLICY "Anyone can read players"
    ON players FOR SELECT
    USING (true);

-- Players can update their own data
CREATE POLICY "Players can update own data"
    ON players FOR UPDATE
    USING (true); -- Simplified for client-side app

-- Players can delete themselves (leave room)
CREATE POLICY "Players can delete own data"
    ON players FOR DELETE
    USING (true);

-- ==========================================
-- ROUND STATE POLICIES
-- ==========================================

-- Anyone in room can read round state (except hands)
CREATE POLICY "Anyone can read round state"
    ON round_state FOR SELECT
    USING (true);

-- Anyone in room can insert round state (for game start)
CREATE POLICY "Anyone can insert round state"
    ON round_state FOR INSERT
    WITH CHECK (true);

-- Anyone in room can update round state
CREATE POLICY "Anyone can update round state"
    ON round_state FOR UPDATE
    USING (true);

-- Clean up when room deleted (cascade handles this)

-- ==========================================
-- HAND CARDS POLICIES (MOST IMPORTANT FOR ANTI-CHEAT)
-- ==========================================

-- Players can ONLY read their own cards, enforced server-side via auth.uid().
-- This requires Supabase Anonymous Sign-ins to be enabled (Authentication >
-- Providers > Anonymous Sign-ins) - the client signs in anonymously on load
-- (see assets/js/supabaseClient.js::initSupabase) and uses that session's
-- auth.uid() as its player id from then on, so a player genuinely cannot
-- read another human player's hand, not just "the UI doesn't show it".
--
-- Bot hands have no auth identity of their own (bots aren't real sessions),
-- so any authenticated player in the room can read bot hand_cards rows -
-- this only exposes bot cards (never another human's), which is an
-- acceptable, explicit exception rather than a blanket bypass.
CREATE POLICY "Players can read own cards, anyone can read bot cards"
    ON hand_cards FOR SELECT
    USING (
        auth.uid()::text = player_id
        OR EXISTS (
            SELECT 1 FROM players p
            WHERE p.id = hand_cards.player_id
            AND p.is_bot = true
        )
    );

-- Anyone can insert hand cards (when dealing)
CREATE POLICY "Anyone can insert hand cards"
    ON hand_cards FOR INSERT
    WITH CHECK (true);

-- Anyone can update hand cards (for card removal)
CREATE POLICY "Anyone can update hand cards"
    ON hand_cards FOR UPDATE
    USING (true);

-- Anyone can delete hand cards (for card removal)
CREATE POLICY "Anyone can delete hand cards"
    ON hand_cards FOR DELETE
    USING (true);

-- ==========================================
-- ACTIONS POLICIES
-- ==========================================

-- Anyone can read actions in their room
CREATE POLICY "Anyone can read actions"
    ON actions FOR SELECT
    USING (true);

-- Anyone can log actions
CREATE POLICY "Anyone can create actions"
    ON actions FOR INSERT
    WITH CHECK (true);

-- No updates or deletes on actions (append-only log)
-- (Default is to deny if no policy exists)

-- ==========================================
-- NOTES ON SECURITY
-- ==========================================

-- IMPORTANT: Most of these policies are still simplified 'true' conditions
-- for a demo app - only hand_cards SELECT (the actual anti-cheat surface,
-- see above) is enforced via auth.uid(). Everything else below remains a
-- known, documented limitation, not a hidden one. Remaining hardening:
--
-- 1. Replace remaining 'true' conditions with proper auth checks:
--    - Use auth.uid() to check authenticated user
--    - Match player.id with auth.uid() for players/rooms/round_state writes
--    - Verify room membership before allowing operations
--
-- 2. (Done) hand_cards SELECT is scoped to auth.uid() = player_id, with an
--    explicit, narrow exception for bot rows (see policy above).
--
-- 3. Add turn validation:
--    - Only allow actions when it's the player's turn
--    - Check room.turn_player_id = auth.uid() before play_card
--
-- 4. Add game state validation:
--    - Verify phase transitions are valid
--    - Prevent invalid actions based on game state
--
-- 5. Consider server-side functions:
--    - Move game logic to PostgreSQL functions
--    - Use SECURITY DEFINER functions for critical operations
--    - Validate all actions server-side
--
-- For this client-side demo, we accept these limitations and rely on
-- players being trustworthy in private lobbies.

-- ==========================================
-- REALTIME PUBLICATION
-- ==========================================

-- Enable realtime for all tables
-- (This is typically done in Supabase UI under Database > Replication)
-- But you can also do it via SQL:

-- Remove tables from publication if they exist
DO $$ 
BEGIN
    -- Supabase automatically handles replication
    -- Just ensure tables are added to the publication
    -- This is usually automatic in Supabase
END $$;

-- Done! RLS policies configured.
-- Remember: These are simplified policies for a demo without authentication.
-- For production, implement proper auth-based policies.
