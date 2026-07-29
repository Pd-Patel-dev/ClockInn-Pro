-- Migration: Developer accounts are platform-level (company_id NULL) + globally unique emails
-- Mirrors Alembic 033_developer_company_optional_and_global_email
--
-- DEPLOYMENT NOTES:
-- 1. Back up the database BEFORE running.
-- 2. If duplicate emails exist across companies, resolve them first:
--    SELECT LOWER(email), COUNT(*), array_agg(id) FROM users GROUP BY LOWER(email) HAVING COUNT(*) > 1;
-- 3. After migration, all DEVELOPER rows must have company_id IS NULL.
-- 4. Developers must re-login (old JWTs carry a company_id).

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS uq_user_company_email;
DROP INDEX IF EXISTS ix_users_company_email_lower;
DROP INDEX IF EXISTS uq_user_company_email;

ALTER TABLE public.sessions ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE public.users ALTER COLUMN company_id DROP NOT NULL;

UPDATE public.users SET company_id = NULL WHERE role = 'DEVELOPER';

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS ck_user_company_by_role;
ALTER TABLE public.users
  ADD CONSTRAINT ck_user_company_by_role
  CHECK (
    (role::text = 'DEVELOPER' AND company_id IS NULL)
    OR (role::text <> 'DEVELOPER' AND company_id IS NOT NULL)
  );

DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT 1 FROM users GROUP BY LOWER(email) HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot enforce globally unique emails: duplicate emails found. Resolve before re-running.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_email ON public.users (LOWER(email));
