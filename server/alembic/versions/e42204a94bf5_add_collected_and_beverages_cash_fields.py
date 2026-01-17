"""add_collected_and_beverages_cash_fields

Revision ID: e42204a94bf5
Revises: d1e2f3g4h5i6
Create Date: 2026-01-15 16:36:50.840763

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e42204a94bf5'
down_revision = 'd1e2f3g4h5i6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new columns to cash_drawer_sessions table
    op.add_column('cash_drawer_sessions', sa.Column('collected_cash_cents', sa.BigInteger(), nullable=True))
    op.add_column('cash_drawer_sessions', sa.Column('beverages_cash_cents', sa.BigInteger(), nullable=True))


def downgrade() -> None:
    # Remove columns
    op.drop_column('cash_drawer_sessions', 'beverages_cash_cents')
    op.drop_column('cash_drawer_sessions', 'collected_cash_cents')
