"""
Add one-time password setup token columns for secure invite links.

Revision ID: 034_password_setup_token
Revises: 033_developer_company_optional
Create Date: 2026-07-30
"""

from alembic import op
import sqlalchemy as sa

revision = "034_password_setup_token"
down_revision = "033_developer_company_optional"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("password_setup_token_hash", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("password_setup_expires_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "password_setup_expires_at")
    op.drop_column("users", "password_setup_token_hash")
