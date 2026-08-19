-- Add current_cash_cents (counted cash before drop) to cash_drawer_sessions
ALTER TABLE cash_drawer_sessions
  ADD COLUMN IF NOT EXISTS current_cash_cents BIGINT;
