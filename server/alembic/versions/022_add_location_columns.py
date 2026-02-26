"""add_location_columns

Revision ID: 022_add_location
Revises: 021_add_clock_out_ip
Create Date: 2026-01-24 17:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '022_add_location'
down_revision = '021_add_clock_out_ip'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add clock-in location columns
    op.add_column('time_entries', sa.Column('clock_in_latitude', sa.String(20), nullable=True))
    op.add_column('time_entries', sa.Column('clock_in_longitude', sa.String(20), nullable=True))
    # Add clock-out location columns
    op.add_column('time_entries', sa.Column('clock_out_latitude', sa.String(20), nullable=True))
    op.add_column('time_entries', sa.Column('clock_out_longitude', sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column('time_entries', 'clock_out_longitude')
    op.drop_column('time_entries', 'clock_out_latitude')
    op.drop_column('time_entries', 'clock_in_longitude')
    op.drop_column('time_entries', 'clock_in_latitude')
