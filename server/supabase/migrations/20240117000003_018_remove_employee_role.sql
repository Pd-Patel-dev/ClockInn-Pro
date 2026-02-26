-- Migration: Remove EMPLOYEE role (migrate to FRONTDESK)
-- Corresponds to Alembic 019_remove_employee_role

-- Step 1: Migrate users with EMPLOYEE role to FRONTDESK
UPDATE users SET role = 'FRONTDESK'::userrole WHERE role::text = 'EMPLOYEE';

-- Step 2: Update company settings_json that reference EMPLOYEE
UPDATE companies
SET settings_json = (REPLACE(settings_json::text, '"EMPLOYEE"', '"FRONTDESK"'))::jsonb
WHERE settings_json IS NOT NULL AND settings_json::text LIKE '%EMPLOYEE%';

-- Step 3: Migrate role_permissions EMPLOYEE to FRONTDESK (delete duplicates first)
DELETE FROM role_permissions rp1
WHERE rp1.role = 'EMPLOYEE'
AND EXISTS (
    SELECT 1 FROM role_permissions rp2
    WHERE rp2.role = 'FRONTDESK' AND rp2.permission_id = rp1.permission_id AND rp2.company_id = rp1.company_id
);
UPDATE role_permissions SET role = 'FRONTDESK' WHERE role = 'EMPLOYEE';

-- Step 4: Create new enum without EMPLOYEE and swap
CREATE TYPE userrole_new AS ENUM ('ADMIN', 'DEVELOPER', 'MAINTENANCE', 'FRONTDESK', 'HOUSEKEEPING');

-- Drop default so the column type can be changed (default 'EMPLOYEE' is invalid for userrole_new)
ALTER TABLE users ALTER COLUMN role DROP DEFAULT;

ALTER TABLE users ALTER COLUMN role TYPE userrole_new USING role::text::userrole_new;

DROP TYPE userrole;
ALTER TYPE userrole_new RENAME TO userrole;

-- Restore default
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'FRONTDESK'::userrole;
