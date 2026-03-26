-- Migration: Align Supabase with Alembic 031 + 032 (March 2026)
--
-- 031_drop_backup_settings: backup feature removed; column may exist if DB was
--   partially migrated with Alembic 030 first.
-- 032_add_new_employee_roles: userrole values used by app.models.user.UserRole
--
-- Idempotent: safe on fresh databases and on databases already at head.

-- ---------------------------------------------------------------------------
-- Alembic 031: companies.backup_settings (JSONB) removed from application
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies
    DROP COLUMN IF EXISTS backup_settings;

-- ---------------------------------------------------------------------------
-- Alembic 032: MANAGER, RESTAURANT, SECURITY (same pattern as 016 hotel roles)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'userrole' AND e.enumlabel = 'MANAGER'
    ) THEN
        ALTER TYPE userrole ADD VALUE 'MANAGER';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'userrole' AND e.enumlabel = 'RESTAURANT'
    ) THEN
        ALTER TYPE userrole ADD VALUE 'RESTAURANT';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'userrole' AND e.enumlabel = 'SECURITY'
    ) THEN
        ALTER TYPE userrole ADD VALUE 'SECURITY';
    END IF;
END $$;
