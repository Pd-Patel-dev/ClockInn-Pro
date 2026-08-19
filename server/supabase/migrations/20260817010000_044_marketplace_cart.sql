-- 044_marketplace_cart: pending cart before cash/card finalize

ALTER TABLE cash_drawer_sessions
    ADD COLUMN IF NOT EXISTS marketplace_cart_json JSONB;
