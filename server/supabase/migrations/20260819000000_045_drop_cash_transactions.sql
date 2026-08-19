-- 045_drop_cash_transactions: remove Cash Management ledger (income/expense/P&L)
DROP INDEX IF EXISTS idx_cash_transactions_cash_drawer_session_id;
DROP INDEX IF EXISTS idx_cash_transactions_company_category;
DROP INDEX IF EXISTS idx_cash_transactions_company_kind;
DROP INDEX IF EXISTS idx_cash_transactions_company_occurred;
DROP INDEX IF EXISTS idx_cash_transactions_occurred_on;
DROP INDEX IF EXISTS idx_cash_transactions_company_id;
DROP TABLE IF EXISTS cash_transactions CASCADE;
DROP TYPE IF EXISTS cashtransactioncategory;
DROP TYPE IF EXISTS cashtransactionsource;
DROP TYPE IF EXISTS cashtransactionkind;
