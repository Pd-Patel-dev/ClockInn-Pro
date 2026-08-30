-- Mirror of Alembic 039_marketplace_sales

ALTER TABLE cash_drawer_sessions
  ADD COLUMN IF NOT EXISTS marketplace_sales_json JSONB;
