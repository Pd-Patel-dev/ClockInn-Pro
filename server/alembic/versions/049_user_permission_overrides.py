"""Alembic: per-employee feature permission overrides.

Revision ID: 049_user_permission_overrides
Revises: 048_drop_schedule_swaps
Create Date: 2026-08-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "049_user_permission_overrides"
down_revision = "048_drop_schedule_swaps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_permission_overrides",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permission_key", sa.String(length=64), nullable=False),
        sa.Column("effect", sa.String(length=16), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint(
            "company_id",
            "user_id",
            "permission_key",
            name="uq_user_permission_overrides_company_user_key",
        ),
    )
    op.create_index(
        "ix_user_permission_overrides_user_id",
        "user_permission_overrides",
        ["user_id"],
    )
    op.create_index(
        "ix_user_permission_overrides_company_id",
        "user_permission_overrides",
        ["company_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_user_permission_overrides_company_id", table_name="user_permission_overrides")
    op.drop_index("ix_user_permission_overrides_user_id", table_name="user_permission_overrides")
    op.drop_table("user_permission_overrides")
