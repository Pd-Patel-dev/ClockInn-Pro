"""Add payroll tables and user payroll fields

Revision ID: 003
Revises: 002
Create Date: 2024-01-03 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create enum types using raw SQL (drop if they exist from previous failed migration)
    conn = op.get_bind()
    
    # Drop existing types if they exist
    conn.execute(sa.text("DROP TYPE IF EXISTS payratetype CASCADE"))
    conn.execute(sa.text("DROP TYPE IF EXISTS payrolltype CASCADE"))
    conn.execute(sa.text("DROP TYPE IF EXISTS payrollstatus CASCADE"))
    conn.execute(sa.text("DROP TYPE IF EXISTS adjustmenttype CASCADE"))
    
    # Create enum types using raw SQL
    conn.execute(sa.text("CREATE TYPE payratetype AS ENUM ('HOURLY')"))
    conn.execute(sa.text("CREATE TYPE payrolltype AS ENUM ('WEEKLY', 'BIWEEKLY')"))
    conn.execute(sa.text("CREATE TYPE payrollstatus AS ENUM ('DRAFT', 'FINALIZED', 'VOID')"))
    conn.execute(sa.text("CREATE TYPE adjustmenttype AS ENUM ('BONUS', 'DEDUCTION', 'REIMBURSEMENT')"))
    
    # Add payroll fields to users table
    op.add_column('users', sa.Column('pay_rate_cents', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('pay_rate_type', postgresql.ENUM('HOURLY', name='payratetype', create_type=False), nullable=False, server_default='HOURLY'))
    op.add_column('users', sa.Column('overtime_multiplier', sa.Numeric(4, 2), nullable=True))
    
    # Create payroll_runs table
    op.create_table(
        'payroll_runs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('companies.id'), nullable=False),
        sa.Column('payroll_type', postgresql.ENUM('WEEKLY', 'BIWEEKLY', name='payrolltype', create_type=False), nullable=False),
        sa.Column('period_start_date', sa.Date(), nullable=False),
        sa.Column('period_end_date', sa.Date(), nullable=False),
        sa.Column('timezone', sa.String(50), nullable=False, server_default='America/Chicago'),
        sa.Column('status', postgresql.ENUM('DRAFT', 'FINALIZED', 'VOID', name='payrollstatus', create_type=False), nullable=False, server_default='DRAFT'),
        sa.Column('generated_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('total_regular_hours', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('total_overtime_hours', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('total_gross_pay_cents', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index('ix_payroll_runs_company_id', 'payroll_runs', ['company_id'])
    op.create_index('idx_payroll_runs_company_period', 'payroll_runs', ['company_id', 'period_start_date', 'period_end_date'])
    op.create_unique_constraint('uq_payroll_run_period', 'payroll_runs', ['company_id', 'payroll_type', 'period_start_date', 'period_end_date'])
    
    # Create payroll_line_items table
    op.create_table(
        'payroll_line_items',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('payroll_run_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('payroll_runs.id'), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('companies.id'), nullable=False),
        sa.Column('employee_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('regular_minutes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('overtime_minutes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('total_minutes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('pay_rate_cents', sa.Integer(), nullable=False),
        sa.Column('overtime_multiplier', sa.Numeric(4, 2), nullable=False, server_default='1.5'),
        sa.Column('regular_pay_cents', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('overtime_pay_cents', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('total_pay_cents', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('exceptions_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('details_json', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index('ix_payroll_line_items_payroll_run_id', 'payroll_line_items', ['payroll_run_id'])
    op.create_index('ix_payroll_line_items_company_id', 'payroll_line_items', ['company_id'])
    op.create_index('ix_payroll_line_items_employee_id', 'payroll_line_items', ['employee_id'])
    op.create_index('idx_payroll_line_items_payroll_run', 'payroll_line_items', ['payroll_run_id'])
    op.create_index('idx_payroll_line_items_employee', 'payroll_line_items', ['employee_id'])
    op.create_unique_constraint('uq_payroll_line_item_employee', 'payroll_line_items', ['payroll_run_id', 'employee_id'])
    
    # Create payroll_adjustments table
    op.create_table(
        'payroll_adjustments',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('payroll_run_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('payroll_runs.id'), nullable=False),
        sa.Column('employee_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('type', postgresql.ENUM('BONUS', 'DEDUCTION', 'REIMBURSEMENT', name='adjustmenttype', create_type=False), nullable=False),
        sa.Column('amount_cents', sa.BigInteger(), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_payroll_adjustments_payroll_run_id', 'payroll_adjustments', ['payroll_run_id'])
    op.create_index('ix_payroll_adjustments_employee_id', 'payroll_adjustments', ['employee_id'])
    op.create_index('idx_payroll_adjustments_payroll_run', 'payroll_adjustments', ['payroll_run_id'])
    op.create_index('idx_payroll_adjustments_employee', 'payroll_adjustments', ['employee_id'])
    
    # Add index to time_entries for payroll queries
    op.create_index('idx_time_entries_company_employee_clock_in', 'time_entries', ['company_id', 'employee_id', 'clock_in_at'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('idx_time_entries_company_employee_clock_in', 'time_entries')
    
    # Drop payroll_adjustments table
    op.drop_table('payroll_adjustments')
    
    # Drop payroll_line_items table
    op.drop_table('payroll_line_items')
    
    # Drop payroll_runs table
    op.drop_table('payroll_runs')
    
    # Remove payroll fields from users table
    op.drop_column('users', 'overtime_multiplier')
    op.drop_column('users', 'pay_rate_type')
    op.drop_column('users', 'pay_rate_cents')
    
    # Drop enum types
    op.execute('DROP TYPE IF EXISTS adjustmenttype')
    op.execute('DROP TYPE IF EXISTS payrollstatus')
    op.execute('DROP TYPE IF EXISTS payrolltype')
    op.execute('DROP TYPE IF EXISTS payratetype')

