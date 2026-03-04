-- Add drop_amount_cents to cash_drawer_sessions (cash dropped from drawer during shift)
ALTER TABLE cash_drawer_sessions
ADD COLUMN IF NOT EXISTS drop_amount_cents BIGINT;

COMMENT ON COLUMN cash_drawer_sessions.drop_amount_cents IS 'Cash dropped/removed from drawer during shift (for punch-out)';
