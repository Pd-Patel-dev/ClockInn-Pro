-- Initial migration: Create all base tables

-- Create enum types
CREATE TYPE userrole AS ENUM ('ADMIN', 'EMPLOYEE');
CREATE TYPE userstatus AS ENUM ('active', 'inactive');
CREATE TYPE timeentrysource AS ENUM ('kiosk', 'web');
CREATE TYPE timeentrystatus AS ENUM ('open', 'closed', 'edited', 'approved');
CREATE TYPE leavetype AS ENUM ('vacation', 'sick', 'personal', 'other');
CREATE TYPE leavestatus AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- Create companies table
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    settings_json JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    role userrole NOT NULL DEFAULT 'EMPLOYEE',
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    pin_hash VARCHAR(255),
    status userstatus NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

CREATE INDEX ix_users_company_id ON users(company_id);
CREATE INDEX ix_users_email ON users(email);

-- Create sessions table
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    company_id UUID NOT NULL REFERENCES companies(id),
    refresh_token_hash VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    user_agent VARCHAR(500),
    ip VARCHAR(45)
);

CREATE INDEX ix_sessions_user_id ON sessions(user_id);
CREATE INDEX ix_sessions_company_id ON sessions(company_id);
CREATE INDEX ix_sessions_refresh_token_hash ON sessions(refresh_token_hash);
CREATE INDEX idx_sessions_user_company ON sessions(user_id, company_id);

-- Create time_entries table
CREATE TABLE time_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    employee_id UUID NOT NULL REFERENCES users(id),
    clock_in_at TIMESTAMPTZ NOT NULL,
    clock_out_at TIMESTAMPTZ,
    break_minutes INTEGER NOT NULL DEFAULT 0,
    source timeentrysource NOT NULL DEFAULT 'kiosk',
    note VARCHAR(500),
    status timeentrystatus NOT NULL DEFAULT 'open',
    edited_by UUID REFERENCES users(id),
    edit_reason VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_time_entries_company_id ON time_entries(company_id);
CREATE INDEX ix_time_entries_employee_id ON time_entries(employee_id);
CREATE INDEX ix_time_entries_clock_in_at ON time_entries(clock_in_at);
CREATE INDEX idx_time_entries_employee_company ON time_entries(employee_id, company_id);

-- Create leave_requests table
CREATE TABLE leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    employee_id UUID NOT NULL REFERENCES users(id),
    type leavetype NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    partial_day_hours INTEGER,
    reason VARCHAR(1000),
    status leavestatus NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES users(id),
    review_comment VARCHAR(1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_leave_requests_company_id ON leave_requests(company_id);
CREATE INDEX ix_leave_requests_employee_id ON leave_requests(employee_id);
CREATE INDEX ix_leave_requests_status ON leave_requests(status);
CREATE INDEX idx_leave_requests_employee_company ON leave_requests(employee_id, company_id);

-- Create audit_logs table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    actor_user_id UUID NOT NULL REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    metadata_json JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_audit_logs_company_id ON audit_logs(company_id);
CREATE INDEX ix_audit_logs_actor_user_id ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_logs_company_created ON audit_logs(company_id, created_at);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_time_entries_updated_at BEFORE UPDATE ON time_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leave_requests_updated_at BEFORE UPDATE ON leave_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

