"""add_hotel_roles_and_permissions

Revision ID: 017_add_hotel_roles
Revises: 01647b5f2020
Create Date: 2026-01-17 22:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '017_add_hotel_roles'
down_revision = '01647b5f2020'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new hotel roles to userrole enum
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'MAINTENANCE'")
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'FRONTDESK'")
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'HOUSEKEEPING'")
    
    # Create permissions table
    op.create_table(
        'permissions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False, unique=True),
        sa.Column('display_name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(50), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_permissions_name', 'permissions', ['name'], unique=True)
    op.create_index('ix_permissions_category', 'permissions', ['category'])
    
    # Create role_permissions junction table
    # Note: company_id is NOT NULL but uses a special UUID (all zeros) for default permissions
    # This allows it to be part of the primary key while still supporting default permissions
    op.create_table(
        'role_permissions',
        sa.Column('role', sa.String(50), nullable=False),
        sa.Column('permission_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(['permission_id'], ['permissions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('role', 'permission_id', 'company_id'),
    )
    op.create_index('ix_role_permissions_role', 'role_permissions', ['role'])
    op.create_index('ix_role_permissions_company', 'role_permissions', ['company_id'])
    
    # Insert default permissions using raw SQL
    # Note: We use gen_random_uuid() for IDs and now() for timestamps
    op.execute("""
        INSERT INTO permissions (id, name, display_name, description, category, created_at)
        VALUES 
        -- Time Entries
        (gen_random_uuid(), 'time_entries.view', 'View Time Entries', 'View all time entries', 'TIME_ENTRIES', now()),
        (gen_random_uuid(), 'time_entries.create', 'Create Time Entries', 'Create new time entries', 'TIME_ENTRIES', now()),
        (gen_random_uuid(), 'time_entries.edit', 'Edit Time Entries', 'Edit existing time entries', 'TIME_ENTRIES', now()),
        (gen_random_uuid(), 'time_entries.delete', 'Delete Time Entries', 'Delete time entries', 'TIME_ENTRIES', now()),
        (gen_random_uuid(), 'time_entries.approve', 'Approve Time Entries', 'Approve time entries', 'TIME_ENTRIES', now()),
        
        -- Employees
        (gen_random_uuid(), 'employees.view', 'View Employees', 'View employee list', 'EMPLOYEES', now()),
        (gen_random_uuid(), 'employees.create', 'Create Employees', 'Create new employees', 'EMPLOYEES', now()),
        (gen_random_uuid(), 'employees.edit', 'Edit Employees', 'Edit employee information', 'EMPLOYEES', now()),
        (gen_random_uuid(), 'employees.delete', 'Delete Employees', 'Delete employees', 'EMPLOYEES', now()),
        
        -- Schedules
        (gen_random_uuid(), 'schedules.view', 'View Schedules', 'View schedules', 'SCHEDULES', now()),
        (gen_random_uuid(), 'schedules.create', 'Create Schedules', 'Create new schedules', 'SCHEDULES', now()),
        (gen_random_uuid(), 'schedules.edit', 'Edit Schedules', 'Edit schedules', 'SCHEDULES', now()),
        (gen_random_uuid(), 'schedules.delete', 'Delete Schedules', 'Delete schedules', 'SCHEDULES', now()),
        
        -- Payroll
        (gen_random_uuid(), 'payroll.view', 'View Payroll', 'View payroll information', 'PAYROLL', now()),
        (gen_random_uuid(), 'payroll.create', 'Create Payroll', 'Create payroll runs', 'PAYROLL', now()),
        (gen_random_uuid(), 'payroll.approve', 'Approve Payroll', 'Approve payroll runs', 'PAYROLL', now()),
        
        -- Reports
        (gen_random_uuid(), 'reports.view', 'View Reports', 'View all reports', 'REPORTS', now()),
        (gen_random_uuid(), 'reports.export', 'Export Reports', 'Export reports to PDF/Excel', 'REPORTS', now()),
        
        -- Settings
        (gen_random_uuid(), 'settings.view', 'View Settings', 'View company settings', 'SETTINGS', now()),
        (gen_random_uuid(), 'settings.edit', 'Edit Settings', 'Edit company settings', 'SETTINGS', now()),
        
        -- Leave Requests
        (gen_random_uuid(), 'leave.view', 'View Leave Requests', 'View leave requests', 'LEAVE_REQUESTS', now()),
        (gen_random_uuid(), 'leave.create', 'Create Leave Requests', 'Create leave requests', 'LEAVE_REQUESTS', now()),
        (gen_random_uuid(), 'leave.approve', 'Approve Leave Requests', 'Approve/reject leave requests', 'LEAVE_REQUESTS', now()),
        
        -- Cash Drawer
        (gen_random_uuid(), 'cash_drawer.view', 'View Cash Drawer', 'View cash drawer sessions', 'CASH_DRAWER', now()),
        (gen_random_uuid(), 'cash_drawer.edit', 'Edit Cash Drawer', 'Edit cash drawer sessions', 'CASH_DRAWER', now()),
        (gen_random_uuid(), 'cash_drawer.review', 'Review Cash Drawer', 'Review cash drawer variances', 'CASH_DRAWER', now()),
        
        -- Admin
        (gen_random_uuid(), 'admin.all', 'Full Admin Access', 'Full administrative access', 'ADMIN', now())
        ON CONFLICT (name) DO NOTHING
    """)


def downgrade() -> None:
    # Drop tables
    op.drop_table('role_permissions')
    op.drop_table('permissions')
    
    # Note: PostgreSQL doesn't support removing enum values easily
    # The new roles will remain in the enum even after downgrade
    # This is a limitation of PostgreSQL enums
