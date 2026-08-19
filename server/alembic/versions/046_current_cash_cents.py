"""Add current_cash_cents to cash_drawer_sessions (cash before drop).

Revision ID: 046_current_cash_cents
Revises: 045_drop_cash_transactions
Create Date: 2026-08-19
"""
from alembic import op
import sqlalchemy as sa


revision = "046_current_cash_cents"
down_revision = "045_drop_cash_transactions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cash_drawer_sessions",
        sa.Column("current_cash_cents", sa.BigInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cash_drawer_sessions", "current_cash_cents")
