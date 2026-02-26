-- Migration: Add location columns to time_entries
-- Corresponds to Alembic 022_add_location

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_latitude VARCHAR(20);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_longitude VARCHAR(20);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_latitude VARCHAR(20);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_longitude VARCHAR(20);
