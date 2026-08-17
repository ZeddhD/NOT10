-- NOT10 Scheduled Cleanup
-- Run this after schema.sql and rls.sql to schedule automatic cleanup of
-- abandoned/finished rooms. Without this, cleanup_old_games() (defined in
-- schema.sql) exists but nothing ever calls it, so rooms accumulate
-- forever - this is the background sweep that actually runs it.

-- Requires the pg_cron extension, available on all Supabase plans
-- (including Free tier) via Database > Extensions in the dashboard,
-- or by running the line below.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Run cleanup_old_games() every hour. It only deletes rooms with
-- status = 'finished' older than 24 hours (see schema.sql), so this is
-- safe to run frequently - it never touches active games.
SELECT cron.schedule(
    'not10-cleanup-old-games',
    '0 * * * *', -- every hour, on the hour
    $$SELECT cleanup_old_games()$$
);

-- To inspect scheduled jobs:
--   SELECT * FROM cron.job;
-- To inspect run history:
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- To remove the schedule:
--   SELECT cron.unschedule('not10-cleanup-old-games');

-- Note: cleanup_old_games() only catches rooms that reached
-- status = 'finished' (i.e. someone won). Rooms abandoned mid-lobby or
-- mid-game (players just closed the tab) never reach that status and
-- will not be swept by this job. If that turns out to matter in
-- practice, extend cleanup_old_games() in schema.sql to also delete
-- rooms with no player last_seen update in, say, the last 24 hours,
-- regardless of status.
