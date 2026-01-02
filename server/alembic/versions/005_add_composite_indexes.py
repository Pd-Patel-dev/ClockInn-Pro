"""Add composite indexes for common queries

Revision ID: 005
Revises: 004
Create Date: 2025-01-02 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add composite index on (company_id, status) for users table
    # This optimizes queries filtering users by company and status
    op.create_index(
        'idx_users_company_status',
        'users',
        ['company_id', 'status'],
    )
    
    # Add composite index on (company_id, employee_id, clock_in_at) for time_entries table
    # This optimizes queries filtering time entries by company, employee, and date range
    op.create_index(
        'idx_time_entries_company_employee_clock_in',
        'time_entries',
        ['company_id', 'employee_id', 'clock_in_at'],
    )
    
    # Add composite index on (company_id, status, created_at) for leave_requests table
    # This optimizes queries filtering leave requests by company, status, and date
    op.create_index(
        'idx_leave_requests_company_status_created',
        'leave_requests',
        ['company_id', 'status', 'created_at'],
    )


def downgrade() -> None:
    # Drop the composite indexes
    op.drop_index('idx_leave_requests_company_status_created', table_name='leave_requests')
    op.drop_index('idx_time_entries_company_employee_clock_in', table_name='time_entries')
    op.drop_index('idx_users_company_status', table_name='users')

