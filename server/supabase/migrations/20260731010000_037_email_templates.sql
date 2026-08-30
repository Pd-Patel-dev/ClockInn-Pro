-- Mirror of Alembic 036_email_templates (tables dropped later in 040)

DO $$ BEGIN
  CREATE TYPE emailtemplatecategory AS ENUM ('TRANSACTIONAL', 'NOTIFICATION', 'SUMMARY', 'MARKETING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY,
  key VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category emailtemplatecategory NOT NULL,
  variables_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_email_templates_key ON email_templates (key);

CREATE TABLE IF NOT EXISTS email_template_versions (
  id UUID PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL DEFAULT 1,
  subject VARCHAR(500) NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  from_name VARCHAR(255),
  from_email VARCHAR(255),
  reply_to VARCHAR(255),
  is_published BOOLEAN NOT NULL DEFAULT false,
  is_draft BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS ix_email_template_versions_template_id ON email_template_versions (template_id);
CREATE INDEX IF NOT EXISTS idx_email_template_versions_template_num
  ON email_template_versions (template_id, version_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_template_published
  ON email_template_versions (template_id) WHERE is_published = true;
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_template_draft
  ON email_template_versions (template_id) WHERE is_draft = true;
