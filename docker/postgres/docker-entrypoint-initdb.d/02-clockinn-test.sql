-- Pytest database (server/tests/conftest.py). Same POSTGRES_USER as app DB; only the DB name differs.
-- Runs once on first volume init. Owner defaults to the connecting user (POSTGRES_USER).
-- Existing volume: docker compose exec db psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE clockinn_test;"

CREATE DATABASE clockinn_test;
