-- Mirror of Alembic 038_email_delivery_logs

CREATE TABLE IF NOT EXISTS email_delivery_logs (
  id UUID PRIMARY KEY,
  to_email VARCHAR(320) NOT NULL,
  subject VARCHAR(500),
  template_key VARCHAR(100),
  kind VARCHAR(40) NOT NULL DEFAULT 'transactional',
  status VARCHAR(20) NOT NULL,
  provider_message_id VARCHAR(255),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_email_delivery_logs_created_at ON email_delivery_logs (created_at);
CREATE INDEX IF NOT EXISTS ix_email_delivery_logs_to_email ON email_delivery_logs (to_email);
CREATE INDEX IF NOT EXISTS ix_email_delivery_logs_status ON email_delivery_logs (status);
CREATE INDEX IF NOT EXISTS ix_email_delivery_logs_template_key ON email_delivery_logs (template_key);
