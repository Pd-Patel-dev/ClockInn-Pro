"""Drop unused schedule_swaps table (feature never shipped).

Revision ID: 048_drop_schedule_swaps
Revises: 047_drop_shift_notes
Create Date: 2026-08-19
"""
from alembic import op
import sqlalchemy as sa


revision = "048_drop_schedule_swaps"
down_revision = "047_drop_shift_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS schedule_swaps CASCADE"))


def downgrade() -> None:
    # Intentionally empty: swap feature was never shipped; recreate via 007 if needed.
    pass
