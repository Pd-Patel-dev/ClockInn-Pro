"""Add series_id to shifts and shift_id to time_entries

Revision ID: 008
Revises: 007
Create Date: 2025-01-07 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '008'
down_revision = '007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add series_id to shifts table for grouping bulk-created shifts
    op.add_column('shifts', sa.Column('series_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index('ix_shifts_series_id', 'shifts', ['series_id'])
    
    # Add shift_id to time_entries table to link entries to shifts
    op.add_column('time_entries', sa.Column('shift_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_time_entries_shift_id', 'time_entries', 'shifts', ['shift_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_time_entries_shift_id', 'time_entries', ['shift_id'])


def downgrade() -> None:
    op.drop_index('ix_time_entries_shift_id', table_name='time_entries')
    op.drop_constraint('fk_time_entries_shift_id', 'time_entries', type_='foreignkey')
    op.drop_column('time_entries', 'shift_id')
    
    op.drop_index('ix_shifts_series_id', table_name='shifts')
    op.drop_column('shifts', 'series_id')

