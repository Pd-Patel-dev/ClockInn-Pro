-- Add shift scheduling tables
-- This migration creates tables for shift scheduling, templates, and swap requests

-- Create enum types for shifts
CREATE TYPE shiftstatus AS ENUM ('DRAFT', 'PUBLISHED', 'APPROVED', 'CANCELLED');
CREATE TYPE shifttemplatetype AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'NONE');

-- Create shift_templates table
CREATE TABLE shift_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_minutes INTEGER NOT NULL DEFAULT 0,
    template_type shifttemplatetype NOT NULL DEFAULT 'NONE',
    day_of_week INTEGER CHECK (day_of_week >= 0 AND day_of_week <= 6),
    day_of_month INTEGER CHECK (day_of_month >= 1 AND day_of_month <= 31),
    week_of_month INTEGER CHECK (week_of_month >= 1 AND week_of_month <= 4),
    start_date DATE NOT NULL,
    end_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    requires_approval BOOLEAN NOT NULL DEFAULT false,
    department VARCHAR(255),
    job_role VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_shift_templates_company_id ON shift_templates(company_id);
CREATE INDEX ix_shift_templates_employee_id ON shift_templates(employee_id);

-- Create shifts table
CREATE TABLE shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shift_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_minutes INTEGER NOT NULL DEFAULT 0,
    status shiftstatus NOT NULL DEFAULT 'DRAFT',
    notes TEXT,
    job_role VARCHAR(255),
    template_id UUID REFERENCES shift_templates(id) ON DELETE SET NULL,
    requires_approval BOOLEAN NOT NULL DEFAULT false,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_shifts_company_id ON shifts(company_id);
CREATE INDEX ix_shifts_employee_id ON shifts(employee_id);
CREATE INDEX ix_shifts_shift_date ON shifts(shift_date);
CREATE INDEX ix_shifts_template_id ON shifts(template_id);
CREATE INDEX idx_shifts_company_employee_date ON shifts(company_id, employee_id, shift_date);
CREATE INDEX idx_shifts_company_date_status ON shifts(company_id, shift_date, status);

-- Create schedule_swaps table
CREATE TABLE schedule_swaps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    original_shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    requested_shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    offerer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_schedule_swaps_company_id ON schedule_swaps(company_id);
CREATE INDEX ix_schedule_swaps_original_shift_id ON schedule_swaps(original_shift_id);
CREATE INDEX ix_schedule_swaps_requester_id ON schedule_swaps(requester_id);

-- Add updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at
CREATE TRIGGER update_shift_templates_updated_at BEFORE UPDATE ON shift_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shifts_updated_at BEFORE UPDATE ON shifts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_schedule_swaps_updated_at BEFORE UPDATE ON schedule_swaps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

