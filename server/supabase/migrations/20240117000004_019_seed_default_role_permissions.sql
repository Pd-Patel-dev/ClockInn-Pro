-- Migration: Seed default role permissions for default company
-- Corresponds to Alembic 020_seed_default_role_permissions

DO $$
DECLARE
    default_company_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    -- Clear existing role permissions for default company
    DELETE FROM role_permissions WHERE company_id = default_company_id;

    -- ADMIN: all permissions
    INSERT INTO role_permissions (role, permission_id, company_id)
    SELECT 'ADMIN', id, default_company_id FROM permissions;

    -- FRONTDESK
    INSERT INTO role_permissions (role, permission_id, company_id)
    SELECT 'FRONTDESK', id, default_company_id FROM permissions
    WHERE name IN (
        'time_entries.view', 'time_entries.create', 'schedules.view',
        'leave.view', 'leave.create', 'cash_drawer.view', 'cash_drawer.edit'
    );

    -- MAINTENANCE
    INSERT INTO role_permissions (role, permission_id, company_id)
    SELECT 'MAINTENANCE', id, default_company_id FROM permissions
    WHERE name IN (
        'time_entries.view', 'time_entries.create', 'schedules.view',
        'leave.view', 'leave.create'
    );

    -- HOUSEKEEPING
    INSERT INTO role_permissions (role, permission_id, company_id)
    SELECT 'HOUSEKEEPING', id, default_company_id FROM permissions
    WHERE name IN (
        'time_entries.view', 'time_entries.create', 'schedules.view',
        'leave.view', 'leave.create'
    );
END $$;
