"""Add shift scheduling tables

Revision ID: 007
Revises: 006
Create Date: 2025-01-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '007'
down_revision = '006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create shift_templates table
    op.create_table(
        'shift_templates',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('companies.id'), nullable=False),
        sa.Column('employee_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('start_time', sa.Time(), nullable=False),
        sa.Column('end_time', sa.Time(), nullable=False),
        sa.Column('break_minutes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('template_type', sa.Enum('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'NONE', name='shifttemplatetype'), nullable=False, server_default='NONE'),
        sa.Column('day_of_week', sa.Integer(), nullable=True),
        sa.Column('day_of_month', sa.Integer(), nullable=True),
        sa.Column('week_of_month', sa.Integer(), nullable=True),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('requires_approval', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('department', sa.String(255), nullable=True),
        sa.Column('job_role', sa.String(255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index('ix_shift_templates_company_id', 'shift_templates', ['company_id'])
    op.create_index('ix_shift_templates_employee_id', 'shift_templates', ['employee_id'])
    
    # Create shifts table
    op.create_table(
        'shifts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('companies.id'), nullable=False),
        sa.Column('employee_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('shift_date', sa.Date(), nullable=False),
        sa.Column('start_time', sa.Time(), nullable=False),
        sa.Column('end_time', sa.Time(), nullable=False),
        sa.Column('break_minutes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('status', sa.Enum('DRAFT', 'PUBLISHED', 'APPROVED', 'CANCELLED', name='shiftstatus'), nullable=False, server_default='DRAFT'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('job_role', sa.String(255), nullable=True),
        sa.Column('template_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('shift_templates.id'), nullable=True),
        sa.Column('requires_approval', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('approved_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index('ix_shifts_company_id', 'shifts', ['company_id'])
    op.create_index('ix_shifts_employee_id', 'shifts', ['employee_id'])
    op.create_index('ix_shifts_shift_date', 'shifts', ['shift_date'])
    op.create_index('ix_shifts_template_id', 'shifts', ['template_id'])
    op.create_index('idx_shifts_company_employee_date', 'shifts', ['company_id', 'employee_id', 'shift_date'])
    op.create_index('idx_shifts_company_date_status', 'shifts', ['company_id', 'shift_date', 'status'])
    
    # Create schedule_swaps table
    op.create_table(
        'schedule_swaps',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('companies.id'), nullable=False),
        sa.Column('original_shift_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('shifts.id'), nullable=False),
        sa.Column('requested_shift_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('shifts.id'), nullable=True),
        sa.Column('requester_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('offerer_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('status', sa.String(50), nullable=False, server_default='pending'),
        sa.Column('approved_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index('ix_schedule_swaps_company_id', 'schedule_swaps', ['company_id'])
    op.create_index('ix_schedule_swaps_original_shift_id', 'schedule_swaps', ['original_shift_id'])
    op.create_index('ix_schedule_swaps_requester_id', 'schedule_swaps', ['requester_id'])


def downgrade() -> None:
    op.drop_table('schedule_swaps')
    op.drop_table('shifts')
    op.drop_table('shift_templates')
    op.execute('DROP TYPE IF EXISTS shiftstatus')
    op.execute('DROP TYPE IF EXISTS shifttemplatetype')

