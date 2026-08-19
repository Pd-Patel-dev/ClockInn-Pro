"""Add marketplace_cart_json for in-progress guest cart before payment finalize.

Revision ID: 044_marketplace_cart
Revises: 043_cash_transactions
Create Date: 2026-08-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "044_marketplace_cart"
down_revision = "043_cash_transactions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cash_drawer_sessions",
        sa.Column("marketplace_cart_json", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cash_drawer_sessions", "marketplace_cart_json")
