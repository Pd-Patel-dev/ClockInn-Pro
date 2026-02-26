-- Migration: Fix role_permissions company_id (default company for system permissions)
-- Corresponds to Alembic 018_fix_role_permissions

-- Default company ID for global permissions
DO $$
DECLARE
    default_company_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    -- Create default company if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM companies WHERE id = default_company_id) THEN
        INSERT INTO companies (id, name, slug, kiosk_enabled, created_at)
        VALUES (default_company_id, 'Default (System)', 'sys-default-00000000', false, now());
    END IF;
    -- Update any NULL company_id in role_permissions (if column was nullable before)
    UPDATE role_permissions SET company_id = default_company_id WHERE company_id IS NULL;
END $$;

-- Ensure company_id is NOT NULL (no-op if already NOT NULL)
ALTER TABLE role_permissions ALTER COLUMN company_id SET NOT NULL;
