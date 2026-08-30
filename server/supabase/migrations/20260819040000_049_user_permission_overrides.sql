-- 049_user_permission_overrides: per-employee grant/deny feature keys
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
