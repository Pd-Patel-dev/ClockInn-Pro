"""add_shift_note_beverage_sold

Revision ID: 028_beverage_sold
Revises: 027_shift_note_perms
Create Date: 2026-02-19

"""
from alembic import op
import sqlalchemy as sa

revision = "028_beverage_sold"
down_revision = "027_shift_note_perms"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shift_notes", sa.Column("beverage_sold", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("shift_notes", "beverage_sold")
