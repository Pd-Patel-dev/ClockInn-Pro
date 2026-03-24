"""add backup_settings JSONB to companies

Revision ID: 030_backup_settings
Revises: 029_rls_shift_notes
Create Date: 2026-03-22

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "030_backup_settings"
down_revision = "029_rls_shift_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column(
            "backup_settings",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("companies", "backup_settings")
