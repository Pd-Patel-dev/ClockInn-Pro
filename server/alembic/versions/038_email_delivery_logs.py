"""email_delivery_logs table

Revision ID: 038_email_delivery_logs
Revises: 037_password_reset_templates
Create Date: 2026-07-31
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "038_email_delivery_logs"
down_revision = "037_password_reset_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "email_delivery_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("to_email", sa.String(320), nullable=False),
        sa.Column("subject", sa.String(500), nullable=True),
        sa.Column("template_key", sa.String(100), nullable=True),
        sa.Column("kind", sa.String(40), nullable=False, server_default="transactional"),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("provider_message_id", sa.String(255), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_email_delivery_logs_created_at", "email_delivery_logs", ["created_at"])
    op.create_index("ix_email_delivery_logs_to_email", "email_delivery_logs", ["to_email"])
    op.create_index("ix_email_delivery_logs_status", "email_delivery_logs", ["status"])
    op.create_index("ix_email_delivery_logs_template_key", "email_delivery_logs", ["template_key"])


def downgrade() -> None:
    op.drop_index("ix_email_delivery_logs_template_key", table_name="email_delivery_logs")
    op.drop_index("ix_email_delivery_logs_status", table_name="email_delivery_logs")
    op.drop_index("ix_email_delivery_logs_to_email", table_name="email_delivery_logs")
    op.drop_index("ix_email_delivery_logs_created_at", table_name="email_delivery_logs")
    op.drop_table("email_delivery_logs")
