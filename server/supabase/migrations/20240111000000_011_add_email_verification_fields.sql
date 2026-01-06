-- Migration: Add email verification fields to users table
-- Description: Adds fields for email verification with 6-digit PIN system
-- Date: 2026-01-11

-- Add email verification fields
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS verification_pin_hash VARCHAR(255);

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS verification_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS last_verification_sent_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS verification_required BOOLEAN NOT NULL DEFAULT true;

-- Create index for faster lookups on verification status
CREATE INDEX IF NOT EXISTS idx_users_verification_status 
ON users(email_verified, verification_required) 
WHERE email_verified = false OR verification_required = true;

