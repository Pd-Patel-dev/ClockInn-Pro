"""add_drop_amount_cents

Revision ID: 024_drop_amount
Revises: 023_password_reset_otp
Create Date: 2026-02-19

"""
from alembic import op
import sqlalchemy as sa

revision = '024_drop_amount'
down_revision = '023_password_reset_otp'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('cash_drawer_sessions', sa.Column('drop_amount_cents', sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column('cash_drawer_sessions', 'drop_amount_cents')
