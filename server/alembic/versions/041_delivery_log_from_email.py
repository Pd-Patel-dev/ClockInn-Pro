"""Add from_email to email_delivery_logs.

Revision ID: 041_delivery_log_from_email
Revises: 040_drop_email_templates
Create Date: 2026-08-14
"""

from alembic import op
import sqlalchemy as sa

revision = "041_delivery_log_from_email"
down_revision = "040_drop_email_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "email_delivery_logs",
        sa.Column("from_email", sa.String(length=320), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("email_delivery_logs", "from_email")
