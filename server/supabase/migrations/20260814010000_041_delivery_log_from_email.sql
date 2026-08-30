-- Mirror of Alembic 041_delivery_log_from_email

ALTER TABLE email_delivery_logs
  ADD COLUMN IF NOT EXISTS from_email VARCHAR(320);
