-- Add payroll tables and user payroll fields

-- Create enum types for payroll
DROP TYPE IF EXISTS payratetype CASCADE;
DROP TYPE IF EXISTS payrolltype CASCADE;
DROP TYPE IF EXISTS payrollstatus CASCADE;
DROP TYPE IF EXISTS adjustmenttype CASCADE;

CREATE TYPE payratetype AS ENUM ('HOURLY');
CREATE TYPE payrolltype AS ENUM ('WEEKLY', 'BIWEEKLY');
CREATE TYPE payrollstatus AS ENUM ('DRAFT', 'FINALIZED', 'VOID');
CREATE TYPE adjustmenttype AS ENUM ('BONUS', 'DEDUCTION', 'REIMBURSEMENT');

-- Add payroll fields to users table
ALTER TABLE users 
ADD COLUMN pay_rate_cents INTEGER NOT NULL DEFAULT 0,
ADD COLUMN pay_rate_type payratetype NOT NULL DEFAULT 'HOURLY',
ADD COLUMN overtime_multiplier NUMERIC(4, 2);

-- Create payroll_runs table
CREATE TABLE payroll_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    payroll_type payrolltype NOT NULL,
    period_start_date DATE NOT NULL,
    period_end_date DATE NOT NULL,
    timezone VARCHAR(50) NOT NULL DEFAULT 'America/Chicago',
    status payrollstatus NOT NULL DEFAULT 'DRAFT',
    generated_by UUID NOT NULL REFERENCES users(id),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_regular_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_overtime_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_gross_pay_cents BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_payroll_runs_company_id ON payroll_runs(company_id);
CREATE INDEX idx_payroll_runs_company_period ON payroll_runs(company_id, period_start_date, period_end_date);
CREATE UNIQUE INDEX uq_payroll_run_period ON payroll_runs(company_id, payroll_type, period_start_date, period_end_date);

-- Create trigger for updated_at on payroll_runs
CREATE TRIGGER update_payroll_runs_updated_at BEFORE UPDATE ON payroll_runs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create payroll_line_items table
CREATE TABLE payroll_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id),
    company_id UUID NOT NULL REFERENCES companies(id),
    employee_id UUID NOT NULL REFERENCES users(id),
    regular_minutes INTEGER NOT NULL DEFAULT 0,
    overtime_minutes INTEGER NOT NULL DEFAULT 0,
    total_minutes INTEGER NOT NULL DEFAULT 0,
    pay_rate_cents INTEGER NOT NULL,
    overtime_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 1.5,
    regular_pay_cents BIGINT NOT NULL DEFAULT 0,
    overtime_pay_cents BIGINT NOT NULL DEFAULT 0,
    total_pay_cents BIGINT NOT NULL DEFAULT 0,
    exceptions_count INTEGER NOT NULL DEFAULT 0,
    details_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_payroll_line_items_payroll_run_id ON payroll_line_items(payroll_run_id);
CREATE INDEX ix_payroll_line_items_company_id ON payroll_line_items(company_id);
CREATE INDEX ix_payroll_line_items_employee_id ON payroll_line_items(employee_id);
CREATE INDEX idx_payroll_line_items_payroll_run ON payroll_line_items(payroll_run_id);
CREATE INDEX idx_payroll_line_items_employee ON payroll_line_items(employee_id);
CREATE UNIQUE INDEX uq_payroll_line_item_employee ON payroll_line_items(payroll_run_id, employee_id);

-- Create trigger for updated_at on payroll_line_items
CREATE TRIGGER update_payroll_line_items_updated_at BEFORE UPDATE ON payroll_line_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create payroll_adjustments table
CREATE TABLE payroll_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id),
    employee_id UUID NOT NULL REFERENCES users(id),
    type adjustmenttype NOT NULL,
    amount_cents BIGINT NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_payroll_adjustments_payroll_run_id ON payroll_adjustments(payroll_run_id);
CREATE INDEX ix_payroll_adjustments_employee_id ON payroll_adjustments(employee_id);
CREATE INDEX idx_payroll_adjustments_payroll_run ON payroll_adjustments(payroll_run_id);
CREATE INDEX idx_payroll_adjustments_employee ON payroll_adjustments(employee_id);

-- Add index to time_entries for payroll queries
CREATE INDEX IF NOT EXISTS idx_time_entries_company_employee_clock_in ON time_entries(company_id, employee_id, clock_in_at);

