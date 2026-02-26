-- Migration: Add IP address and user agent to time_entries (clock-in)
-- Corresponds to Alembic 01647b5f2020

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS user_agent VARCHAR(500);
