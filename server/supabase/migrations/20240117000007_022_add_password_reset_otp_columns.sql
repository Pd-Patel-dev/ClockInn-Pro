-- Migration: Add password reset OTP columns to users (forgot password flow)
-- Corresponds to Alembic 023_add_password_reset_otp_columns

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_otp_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_otp_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_password_reset_sent_at TIMESTAMPTZ;
