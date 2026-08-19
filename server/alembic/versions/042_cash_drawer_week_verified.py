"""Add weekly Drop/Sales verification columns to cash_drawer_sessions.

Revision ID: 042_cash_drawer_week_verified
Revises: 041_delivery_log_from_email
Create Date: 2026-08-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "042_cash_drawer_week_verified"
down_revision = "041_delivery_log_from_email"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cash_drawer_sessions",
        sa.Column("verified_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )
    op.add_column(
        "cash_drawer_sessions",
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "idx_cash_drawer_sessions_company_verified",
        "cash_drawer_sessions",
        ["company_id", "verified_at"],
    )

    # Add VERIFY to cash drawer audit action enum when present (PostgreSQL)
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_type WHERE typname = 'cashdrawerauditaction'
            ) AND NOT EXISTS (
                SELECT 1
                FROM pg_enum e
                JOIN pg_type t ON e.enumtypid = t.oid
                WHERE t.typname = 'cashdrawerauditaction' AND e.enumlabel = 'VERIFY'
            ) THEN
                ALTER TYPE cashdrawerauditaction ADD VALUE 'VERIFY';
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.drop_index("idx_cash_drawer_sessions_company_verified", table_name="cash_drawer_sessions")
    op.drop_column("cash_drawer_sessions", "verified_at")
    op.drop_column("cash_drawer_sessions", "verified_by")
