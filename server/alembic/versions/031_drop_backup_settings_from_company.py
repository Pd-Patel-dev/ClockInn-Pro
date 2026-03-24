"""drop backup_settings from companies (backup feature removed)

Revision ID: 031_drop_backup_settings
Revises: 030_backup_settings
Create Date: 2026-03-24

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "031_drop_backup_settings"
down_revision = "030_backup_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("companies", "backup_settings")


def downgrade() -> None:
    op.add_column(
        "companies",
        sa.Column(
            "backup_settings",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
