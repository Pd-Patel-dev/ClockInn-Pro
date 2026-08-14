"""Add marketplace_sales_json to cash_drawer_sessions.

Revision ID: 039_marketplace_sales
Revises: 038_email_delivery_logs
Create Date: 2026-08-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "039_marketplace_sales"
down_revision = "038_email_delivery_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cash_drawer_sessions",
        sa.Column("marketplace_sales_json", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cash_drawer_sessions", "marketplace_sales_json")
