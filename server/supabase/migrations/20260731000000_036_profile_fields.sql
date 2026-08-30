-- Mirror of Alembic 035_profile_fields
-- Profile preferences + session device metadata + avatar fallback table

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
