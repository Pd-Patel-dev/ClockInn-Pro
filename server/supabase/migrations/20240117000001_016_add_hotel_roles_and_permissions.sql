-- Migration: Add hotel roles and permissions tables
-- Corresponds to Alembic 017_add_hotel_roles

-- Add new hotel roles to userrole enum (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'userrole' AND e.enumlabel = 'MAINTENANCE') THEN
        ALTER TYPE userrole ADD VALUE 'MAINTENANCE';
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'userrole' AND e.enumlabel = 'FRONTDESK') THEN
        ALTER TYPE userrole ADD VALUE 'FRONTDESK';
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'userrole' AND e.enumlabel = 'HOUSEKEEPING') THEN
        ALTER TYPE userrole ADD VALUE 'HOUSEKEEPING';
    END IF;
END $$;

-- Create permissions table
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_permissions_name ON permissions(name);
CREATE INDEX IF NOT EXISTS ix_permissions_category ON permissions(category);

-- Create role_permissions junction table
CREATE TABLE IF NOT EXISTS role_permissions (
    role VARCHAR(50) NOT NULL,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    PRIMARY KEY (role, permission_id, company_id)
);
CREATE INDEX IF NOT EXISTS ix_role_permissions_role ON role_permissions(role);
CREATE INDEX IF NOT EXISTS ix_role_permissions_company ON role_permissions(company_id);

-- Insert default permissions (idempotent)
INSERT INTO permissions (id, name, display_name, description, category, created_at)
VALUES
    (gen_random_uuid(), 'time_entries.view', 'View Time Entries', 'View all time entries', 'TIME_ENTRIES', now()),
    (gen_random_uuid(), 'time_entries.create', 'Create Time Entries', 'Create new time entries', 'TIME_ENTRIES', now()),
    (gen_random_uuid(), 'time_entries.edit', 'Edit Time Entries', 'Edit existing time entries', 'TIME_ENTRIES', now()),
    (gen_random_uuid(), 'time_entries.delete', 'Delete Time Entries', 'Delete time entries', 'TIME_ENTRIES', now()),
    (gen_random_uuid(), 'time_entries.approve', 'Approve Time Entries', 'Approve time entries', 'TIME_ENTRIES', now()),
    (gen_random_uuid(), 'employees.view', 'View Employees', 'View employee list', 'EMPLOYEES', now()),
    (gen_random_uuid(), 'employees.create', 'Create Employees', 'Create new employees', 'EMPLOYEES', now()),
    (gen_random_uuid(), 'employees.edit', 'Edit Employees', 'Edit employee information', 'EMPLOYEES', now()),
    (gen_random_uuid(), 'employees.delete', 'Delete Employees', 'Delete employees', 'EMPLOYEES', now()),
    (gen_random_uuid(), 'schedules.view', 'View Schedules', 'View schedules', 'SCHEDULES', now()),
    (gen_random_uuid(), 'schedules.create', 'Create Schedules', 'Create new schedules', 'SCHEDULES', now()),
    (gen_random_uuid(), 'schedules.edit', 'Edit Schedules', 'Edit schedules', 'SCHEDULES', now()),
    (gen_random_uuid(), 'schedules.delete', 'Delete Schedules', 'Delete schedules', 'SCHEDULES', now()),
    (gen_random_uuid(), 'payroll.view', 'View Payroll', 'View payroll information', 'PAYROLL', now()),
    (gen_random_uuid(), 'payroll.create', 'Create Payroll', 'Create payroll runs', 'PAYROLL', now()),
    (gen_random_uuid(), 'payroll.approve', 'Approve Payroll', 'Approve payroll runs', 'PAYROLL', now()),
    (gen_random_uuid(), 'reports.view', 'View Reports', 'View all reports', 'REPORTS', now()),
    (gen_random_uuid(), 'reports.export', 'Export Reports', 'Export reports to PDF/Excel', 'REPORTS', now()),
    (gen_random_uuid(), 'settings.view', 'View Settings', 'View company settings', 'SETTINGS', now()),
    (gen_random_uuid(), 'settings.edit', 'Edit Settings', 'Edit company settings', 'SETTINGS', now()),
    (gen_random_uuid(), 'leave.view', 'View Leave Requests', 'View leave requests', 'LEAVE_REQUESTS', now()),
    (gen_random_uuid(), 'leave.create', 'Create Leave Requests', 'Create leave requests', 'LEAVE_REQUESTS', now()),
    (gen_random_uuid(), 'leave.approve', 'Approve Leave Requests', 'Approve/reject leave requests', 'LEAVE_REQUESTS', now()),
    (gen_random_uuid(), 'cash_drawer.view', 'View Cash Drawer', 'View cash drawer sessions', 'CASH_DRAWER', now()),
    (gen_random_uuid(), 'cash_drawer.edit', 'Edit Cash Drawer', 'Edit cash drawer sessions', 'CASH_DRAWER', now()),
    (gen_random_uuid(), 'cash_drawer.review', 'Review Cash Drawer', 'Review cash drawer variances', 'CASH_DRAWER', now()),
    (gen_random_uuid(), 'admin.all', 'Full Admin Access', 'Full administrative access', 'ADMIN', now())
ON CONFLICT (name) DO NOTHING;
