-- 054: employee pay_method (hourly / per room)

DO $$ BEGIN
    CREATE TYPE paymethod AS ENUM ('HOURLY', 'PER_ROOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS pay_method paymethod NOT NULL DEFAULT 'HOURLY';
