"""add_ip_address_and_user_agent_to_time_entries

Revision ID: 01647b5f2020
Revises: e42204a94bf5
Create Date: 2026-01-17 13:02:52.232270

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '01647b5f2020'
down_revision = 'e42204a94bf5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add IP address and user agent columns to time_entries table
    op.add_column('time_entries', sa.Column('ip_address', sa.String(length=45), nullable=True))
    op.add_column('time_entries', sa.Column('user_agent', sa.String(length=500), nullable=True))


def downgrade() -> None:
    # Remove columns
    op.drop_column('time_entries', 'user_agent')
    op.drop_column('time_entries', 'ip_address')

