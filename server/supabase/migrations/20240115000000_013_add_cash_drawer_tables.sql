-- Add cash drawer tables
-- This migration creates tables for cash drawer management and audit logging

-- Create enum types
DO $$ BEGIN
    CREATE TYPE cashcountsource AS ENUM ('kiosk', 'web');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE cashdrawerstatus AS ENUM ('OPEN', 'CLOSED', 'REVIEW_NEEDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE cashdrawerauditaction AS ENUM ('CREATE_START', 'SET_END', 'EDIT_START', 'EDIT_END', 'REVIEW', 'VOID');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create cash_drawer_sessions table
CREATE TABLE IF NOT EXISTS cash_drawer_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    time_entry_id UUID NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_cash_cents BIGINT NOT NULL,
    start_counted_at TIMESTAMPTZ NOT NULL,
    start_count_source cashcountsource NOT NULL DEFAULT 'kiosk',
    end_cash_cents BIGINT,
    end_counted_at TIMESTAMPTZ,
    end_count_source cashcountsource,
    delta_cents BIGINT,
    status cashdrawerstatus NOT NULL DEFAULT 'OPEN',
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT cash_drawer_sessions_time_entry_id_unique UNIQUE (time_entry_id)
);

-- Create indexes for cash_drawer_sessions
CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_company_employee_date 
    ON cash_drawer_sessions(company_id, employee_id, start_counted_at);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_company_status 
    ON cash_drawer_sessions(company_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_time_entry 
    ON cash_drawer_sessions(time_entry_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_employee_id 
    ON cash_drawer_sessions(employee_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_company_id 
    ON cash_drawer_sessions(company_id);

-- Create cash_drawer_audit table
CREATE TABLE IF NOT EXISTS cash_drawer_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    cash_drawer_session_id UUID NOT NULL REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action cashdrawerauditaction NOT NULL,
    old_values_json JSONB,
    new_values_json JSONB,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for cash_drawer_audit
CREATE INDEX IF NOT EXISTS idx_cash_drawer_audit_session 
    ON cash_drawer_audit(cash_drawer_session_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_audit_actor 
    ON cash_drawer_audit(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_audit_created 
    ON cash_drawer_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_audit_company_id 
    ON cash_drawer_audit(company_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_cash_drawer_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS trigger_update_cash_drawer_sessions_updated_at ON cash_drawer_sessions;
CREATE TRIGGER trigger_update_cash_drawer_sessions_updated_at
    BEFORE UPDATE ON cash_drawer_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_cash_drawer_sessions_updated_at();
