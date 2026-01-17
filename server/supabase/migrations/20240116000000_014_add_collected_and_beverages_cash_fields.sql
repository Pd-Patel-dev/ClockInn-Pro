-- Add collected_cash_cents and beverages_cash_cents columns to cash_drawer_sessions table
-- This migration adds fields to track cash collected from customers and beverage sales

-- Add collected_cash_cents column (Total cash collected from customers)
ALTER TABLE cash_drawer_sessions 
ADD COLUMN IF NOT EXISTS collected_cash_cents BIGINT;

-- Add beverages_cash_cents column (Cash from beverage sales)
ALTER TABLE cash_drawer_sessions 
ADD COLUMN IF NOT EXISTS beverages_cash_cents BIGINT;

-- Add comments to document the columns
COMMENT ON COLUMN cash_drawer_sessions.collected_cash_cents IS 'Total cash collected from customers (for punch-out)';
COMMENT ON COLUMN cash_drawer_sessions.beverages_cash_cents IS 'Cash from beverage sales (for punch-out)';
