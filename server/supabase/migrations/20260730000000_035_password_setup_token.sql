-- Mirror of Alembic 034_password_setup_token
-- One-time password setup invite columns on users

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_setup_token_hash VARCHAR(255),
  ADD COLUMN IF NOT EXISTS password_setup_expires_at TIMESTAMPTZ;
