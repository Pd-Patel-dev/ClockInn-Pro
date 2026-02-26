-- Migration: Add clock-out IP and user agent to time_entries
-- Corresponds to Alembic 021_add_clock_out_ip

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_ip_address VARCHAR(45);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_user_agent VARCHAR(500);
