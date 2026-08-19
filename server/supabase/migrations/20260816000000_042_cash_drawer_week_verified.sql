-- Weekly Drop & Sales verification columns on cash_drawer_sessions
ALTER TABLE cash_drawer_sessions
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

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
