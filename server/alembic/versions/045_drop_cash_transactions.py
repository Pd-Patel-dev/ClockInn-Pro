"""Drop cash_transactions ledger (Cash Management income/expense/P&L removed).

Revision ID: 045_drop_cash_transactions
Revises: 044_marketplace_cart
Create Date: 2026-08-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ENUM


revision = "045_drop_cash_transactions"
down_revision = "044_marketplace_cart"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # Indexes/table may already be gone on fresh DBs that never ran 043
    for idx in (
        "idx_cash_transactions_cash_drawer_session_id",
        "idx_cash_transactions_company_category",
        "idx_cash_transactions_company_kind",
        "idx_cash_transactions_company_occurred",
        "idx_cash_transactions_occurred_on",
        "idx_cash_transactions_company_id",
    ):
        op.execute(sa.text(f"DROP INDEX IF EXISTS {idx}"))
    op.execute(sa.text("DROP TABLE IF EXISTS cash_transactions CASCADE"))
    op.execute(sa.text("DROP TYPE IF EXISTS cashtransactioncategory"))
    op.execute(sa.text("DROP TYPE IF EXISTS cashtransactionsource"))
    op.execute(sa.text("DROP TYPE IF EXISTS cashtransactionkind"))


def downgrade() -> None:
    bind = op.get_bind()

    cashtransactionkind = ENUM(
        "INCOME", "EXPENSE", name="cashtransactionkind", create_type=False
    )
    cashtransactionsource = ENUM(
        "DROP", "MARKETPLACE_SALE", "MANUAL", name="cashtransactionsource", create_type=False
    )
    cashtransactioncategory = ENUM(
        "operations",
        "marketplace",
        "utilities",
        "supplies",
        "other",
        "drop",
        "marketplace_sale",
        name="cashtransactioncategory",
        create_type=False,
    )

    for typ, values in (
        ("cashtransactionkind", ("INCOME", "EXPENSE")),
        ("cashtransactionsource", ("DROP", "MARKETPLACE_SALE", "MANUAL")),
        (
            "cashtransactioncategory",
            (
                "operations",
                "marketplace",
                "utilities",
                "supplies",
                "other",
                "drop",
                "marketplace_sale",
            ),
        ),
    ):
        bind.execute(
            sa.text(
                f"""
                DO $$ BEGIN
                    CREATE TYPE {typ} AS ENUM ({", ".join(repr(v) for v in values)});
                EXCEPTION
                    WHEN duplicate_object THEN null;
                END $$;
                """
            )
        )

    op.create_table(
        "cash_transactions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("kind", cashtransactionkind, nullable=False),
        sa.Column("source", cashtransactionsource, nullable=False),
        sa.Column("category", cashtransactioncategory, nullable=False),
        sa.Column("amount_cents", sa.BigInteger(), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "cash_drawer_session_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cash_drawer_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "company_id",
            "cash_drawer_session_id",
            "source",
            name="uq_cash_txn_company_session_source",
        ),
    )
    op.create_index("idx_cash_transactions_company_id", "cash_transactions", ["company_id"])
    op.create_index("idx_cash_transactions_occurred_on", "cash_transactions", ["occurred_on"])
    op.create_index(
        "idx_cash_transactions_company_occurred",
        "cash_transactions",
        ["company_id", "occurred_on"],
    )
    op.create_index(
        "idx_cash_transactions_company_kind",
        "cash_transactions",
        ["company_id", "kind"],
    )
    op.create_index(
        "idx_cash_transactions_company_category",
        "cash_transactions",
        ["company_id", "category"],
    )
    op.create_index(
        "idx_cash_transactions_cash_drawer_session_id",
        "cash_transactions",
        ["cash_drawer_session_id"],
    )
