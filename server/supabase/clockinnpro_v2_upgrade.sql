-- ClockInn Pro v2 — one-shot upgrade for production Supabase
-- Brings a database that is at supabase 033 / alembic ~032 up to alembic 056.
--
-- HOW TO RUN
-- 1. Take a Supabase backup first.
-- 2. SQL Editor → New query → paste this whole file → Run.
-- 3. Duplicate emails will abort (see 033). Fix them, then run again.
--
-- Do not also run Alembic after this unless you stamp first.
-- This file sets alembic_version to 056_housekeeping_sheet_kind.
-- Intermediate tables that were later dropped (email_templates, cash_transactions)
-- are skipped; the net schema matches the current app.

-- ========== 033 developer company_id + global unique email ==========
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

-- ========== 034 password setup token ==========
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_setup_token_hash VARCHAR(255),
  ADD COLUMN IF NOT EXISTS password_setup_expires_at TIMESTAMPTZ;

-- ========== 035 profile fields ==========
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(1024),
  ADD COLUMN IF NOT EXISTS preferred_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(30),
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) DEFAULT 'America/Chicago',
  ADD COLUMN IF NOT EXISTS date_format VARCHAR(16) NOT NULL DEFAULT 'MM/DD/YYYY',
  ADD COLUMN IF NOT EXISTS time_format VARCHAR(8) NOT NULL DEFAULT '12h',
  ADD COLUMN IF NOT EXISTS first_day_of_week INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(16) NOT NULL DEFAULT 'system';

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT ck_users_date_format
    CHECK (date_format IN ('MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT ck_users_time_format
    CHECK (time_format IN ('12h', '24h'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT ck_users_first_day_of_week
    CHECK (first_day_of_week IN (0, 1));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT ck_users_theme_preference
    CHECK (theme_preference IN ('light', 'dark', 'system'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS device_label VARCHAR(255),
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_avatars (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data_url TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========== 038 + 041 email delivery logs ==========
CREATE TABLE IF NOT EXISTS email_delivery_logs (
  id UUID PRIMARY KEY,
  to_email VARCHAR(320) NOT NULL,
  from_email VARCHAR(320),
  subject VARCHAR(500),
  template_key VARCHAR(100),
  kind VARCHAR(40) NOT NULL DEFAULT 'transactional',
  status VARCHAR(20) NOT NULL,
  provider_message_id VARCHAR(255),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE email_delivery_logs
  ADD COLUMN IF NOT EXISTS from_email VARCHAR(320);

CREATE INDEX IF NOT EXISTS ix_email_delivery_logs_created_at ON email_delivery_logs (created_at);
CREATE INDEX IF NOT EXISTS ix_email_delivery_logs_to_email ON email_delivery_logs (to_email);
CREATE INDEX IF NOT EXISTS ix_email_delivery_logs_status ON email_delivery_logs (status);
CREATE INDEX IF NOT EXISTS ix_email_delivery_logs_template_key ON email_delivery_logs (template_key);

-- ========== 039 / 044 / 042 / 046 cash drawer ==========
ALTER TABLE cash_drawer_sessions
  ADD COLUMN IF NOT EXISTS marketplace_sales_json JSONB,
  ADD COLUMN IF NOT EXISTS marketplace_cart_json JSONB,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_cash_cents BIGINT;

CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_company_verified
  ON cash_drawer_sessions (company_id, verified_at);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'cashdrawerauditaction'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'cashdrawerauditaction' AND e.enumlabel = 'VERIFY'
  ) THEN
    ALTER TYPE cashdrawerauditaction ADD VALUE 'VERIFY';
  END IF;
END
$$;

-- ========== 047 drop shift notes ==========
DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id FROM permissions WHERE name LIKE 'shift_note:%'
);
DELETE FROM permissions WHERE name LIKE 'shift_note:%';
DROP TABLE IF EXISTS shift_note_comments CASCADE;
DROP TABLE IF EXISTS shift_notes CASCADE;
DROP TYPE IF EXISTS shiftnotestatus;

-- ========== 048 drop unused schedule swaps ==========
DROP TABLE IF EXISTS schedule_swaps CASCADE;

-- ========== 049 per-employee permission overrides ==========
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key VARCHAR(64) NOT NULL,
  effect VARCHAR(16) NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_permission_overrides_company_user_key UNIQUE (company_id, user_id, permission_key)
);
CREATE INDEX IF NOT EXISTS ix_user_permission_overrides_user_id ON user_permission_overrides (user_id);
CREATE INDEX IF NOT EXISTS ix_user_permission_overrides_company_id ON user_permission_overrides (company_id);

-- ========== 050–053 / 056 housekeeping ==========
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number VARCHAR(32) NOT NULL,
  room_type VARCHAR(64) NOT NULL DEFAULT 'Standard',
  occupancy_status VARCHAR(20) NOT NULL DEFAULT 'departing',
  cleaning_status VARCHAR(20) NOT NULL DEFAULT 'clean',
  assigned_housekeeper_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_rooms_company_number UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS ix_rooms_company_id ON rooms (company_id);

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS assigned_housekeeper_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_rooms_assigned_housekeeper_id ON rooms (assigned_housekeeper_id);

UPDATE rooms SET occupancy_status = 'departing' WHERE occupancy_status = 'vacant';
UPDATE rooms SET occupancy_status = 'stayover' WHERE occupancy_status = 'occupied';
UPDATE rooms SET occupancy_status = 'departing'
WHERE occupancy_status NOT IN ('departing', 'stayover');
ALTER TABLE rooms ALTER COLUMN occupancy_status SET DEFAULT 'departing';

CREATE TABLE IF NOT EXISTS housekeeping_sheets (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  housekeeper_id UUID REFERENCES users(id) ON DELETE SET NULL,
  housekeeper_name VARCHAR(255) NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(255),
  notes VARCHAR(1000),
  kind VARCHAR(20) NOT NULL DEFAULT 'assignment',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_housekeeping_sheets_company_id ON housekeeping_sheets (company_id);

ALTER TABLE housekeeping_sheets
  ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'assignment';

UPDATE housekeeping_sheets
SET kind = 'finalize'
WHERE notes ILIKE '%finalized board%'
   OR notes ILIKE '%cleaning done%';

CREATE TABLE IF NOT EXISTS housekeeping_sheet_items (
  id UUID PRIMARY KEY,
  sheet_id UUID NOT NULL REFERENCES housekeeping_sheets(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  room_number VARCHAR(32) NOT NULL,
  room_type VARCHAR(64) NOT NULL,
  occupancy_status VARCHAR(20) NOT NULL,
  cleaning_status VARCHAR(20) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_housekeeping_sheet_items_sheet_id ON housekeeping_sheet_items (sheet_id);

INSERT INTO permissions (id, name, display_name, description, category, created_at)
VALUES
  (gen_random_uuid(), 'housekeeping.view', 'View Housekeeping Board', 'View rooms and housekeeping board', 'HOUSEKEEPING', now()),
  (gen_random_uuid(), 'housekeeping.status', 'Update Room Status', 'Update occupancy and cleaning status', 'HOUSEKEEPING', now()),
  (gen_random_uuid(), 'housekeeping.assign', 'Assign & Print Sheets', 'Assign rooms to housekeepers and print assignment sheets', 'HOUSEKEEPING', now())
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role, permission_id, company_id)
SELECT 'HOUSEKEEPING', id, '00000000-0000-0000-0000-000000000000'::uuid
FROM permissions
WHERE name IN ('housekeeping.view', 'housekeeping.status', 'housekeeping.assign')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role, permission_id, company_id)
SELECT 'FRONTDESK', id, '00000000-0000-0000-0000-000000000000'::uuid
FROM permissions
WHERE name IN ('housekeeping.view', 'housekeeping.status', 'housekeeping.assign')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role, permission_id, company_id)
SELECT 'ADMIN', id, '00000000-0000-0000-0000-000000000000'::uuid
FROM permissions
WHERE name IN ('housekeeping.view', 'housekeeping.status', 'housekeeping.assign')
ON CONFLICT DO NOTHING;

-- ========== 054 per-room pay ==========
DO $$ BEGIN
    CREATE TYPE paymethod AS ENUM ('HOURLY', 'PER_ROOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS pay_method paymethod NOT NULL DEFAULT 'HOURLY';

-- ========== 055 support tickets ==========
CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    type VARCHAR(32) NOT NULL DEFAULT 'support',
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    message TEXT NOT NULL,
    user_name VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    user_role VARCHAR(64),
    company_name VARCHAR(255),
    page_path VARCHAR(500),
    user_agent VARCHAR(500),
    ip_address VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_by_id UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_support_tickets_user_id ON support_tickets (user_id);
CREATE INDEX IF NOT EXISTS ix_support_tickets_company_id ON support_tickets (company_id);
CREATE INDEX IF NOT EXISTS ix_support_tickets_type ON support_tickets (type);
CREATE INDEX IF NOT EXISTS ix_support_tickets_status ON support_tickets (status);
CREATE INDEX IF NOT EXISTS ix_support_tickets_user_email ON support_tickets (user_email);
CREATE INDEX IF NOT EXISTS ix_support_tickets_created_at ON support_tickets (created_at);
CREATE INDEX IF NOT EXISTS ix_support_tickets_status_created ON support_tickets (status, created_at);
CREATE INDEX IF NOT EXISTS ix_support_tickets_type_created ON support_tickets (type, created_at);

-- ========== stamp Alembic so Render does not re-run 033–056 ==========
CREATE TABLE IF NOT EXISTS alembic_version (
  version_num VARCHAR(32) NOT NULL
);

DELETE FROM alembic_version;
INSERT INTO alembic_version (version_num) VALUES ('056_housekeeping_sheet_kind');
