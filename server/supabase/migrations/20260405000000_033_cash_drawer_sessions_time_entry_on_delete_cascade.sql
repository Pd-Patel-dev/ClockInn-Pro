-- Migration: Ensure cash_drawer_sessions.time_entry_id uses ON DELETE CASCADE
--
-- Some databases were created before migration 013 matched production, or were
-- migrated from Alembic without CASCADE. Without it, deleting time_entries (or
-- bulk tenant cleanup) fails with:
--   ForeignKeyViolationError on cash_drawer_sessions_time_entry_id_fkey
--
-- Idempotent: safe if the constraint already has ON DELETE CASCADE.

ALTER TABLE public.cash_drawer_sessions
    DROP CONSTRAINT IF EXISTS cash_drawer_sessions_time_entry_id_fkey;

ALTER TABLE public.cash_drawer_sessions
    ADD CONSTRAINT cash_drawer_sessions_time_entry_id_fkey
    FOREIGN KEY (time_entry_id)
    REFERENCES public.time_entries(id)
    ON DELETE CASCADE;
