-- 043_cash_transactions: ledger for drops, marketplace sales, and expenses

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cashtransactionkind') THEN
        CREATE TYPE cashtransactionkind AS ENUM ('INCOME', 'EXPENSE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cashtransactionsource') THEN
        CREATE TYPE cashtransactionsource AS ENUM ('DROP', 'MARKETPLACE_SALE', 'MANUAL');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cashtransactioncategory') THEN
        CREATE TYPE cashtransactioncategory AS ENUM (
            'operations', 'marketplace', 'utilities', 'supplies', 'other', 'drop', 'marketplace_sale'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS cash_transactions (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    kind cashtransactionkind NOT NULL,
    source cashtransactionsource NOT NULL,
    category cashtransactioncategory NOT NULL,
    amount_cents BIGINT NOT NULL,
    occurred_on DATE NOT NULL,
    note TEXT,
    cash_drawer_session_id UUID REFERENCES cash_drawer_sessions(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_cash_txn_company_session_source UNIQUE (company_id, cash_drawer_session_id, source)
);

CREATE INDEX IF NOT EXISTS idx_cash_transactions_company_id ON cash_transactions (company_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_occurred_on ON cash_transactions (occurred_on);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_company_occurred ON cash_transactions (company_id, occurred_on);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_company_kind ON cash_transactions (company_id, kind);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_company_category ON cash_transactions (company_id, category);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_cash_drawer_session_id ON cash_transactions (cash_drawer_session_id);
