"""add_clock_out_ip_columns

Revision ID: 021_add_clock_out_ip
Revises: 020_seed_role_perms
Create Date: 2026-01-24 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '021_add_clock_out_ip'
down_revision = '020_seed_role_perms'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add clock_out_ip_address column
    op.add_column('time_entries', sa.Column('clock_out_ip_address', sa.String(45), nullable=True))
    # Add clock_out_user_agent column
    op.add_column('time_entries', sa.Column('clock_out_user_agent', sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column('time_entries', 'clock_out_user_agent')
    op.drop_column('time_entries', 'clock_out_ip_address')
