"""seed_default_role_permissions

Revision ID: 020_seed_role_perms
Revises: 019_remove_employee_role
Create Date: 2026-01-24 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '020_seed_role_perms'
down_revision = '019_remove_employee_role'
branch_labels = None
depends_on = None

# Default company ID for global permissions
DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000000'


def upgrade() -> None:
    # First, clear any existing role permissions to start fresh
    op.execute(f"""
        DELETE FROM role_permissions 
        WHERE company_id = '{DEFAULT_COMPANY_ID}'::uuid
    """)
    
    # ADMIN gets all permissions
    op.execute(f"""
        INSERT INTO role_permissions (role, permission_id, company_id)
        SELECT 'ADMIN', id, '{DEFAULT_COMPANY_ID}'::uuid
        FROM permissions
    """)
    
    # FRONTDESK: Time entries (view, create), schedules (view), leave (view, create), cash drawer (view, edit)
    op.execute(f"""
        INSERT INTO role_permissions (role, permission_id, company_id)
        SELECT 'FRONTDESK', id, '{DEFAULT_COMPANY_ID}'::uuid
        FROM permissions
        WHERE name IN (
            'time_entries.view',
            'time_entries.create',
            'schedules.view',
            'leave.view',
            'leave.create',
            'cash_drawer.view',
            'cash_drawer.edit'
        )
    """)
    
    # MAINTENANCE: Time entries (view, create), schedules (view), leave (view, create)
    op.execute(f"""
        INSERT INTO role_permissions (role, permission_id, company_id)
        SELECT 'MAINTENANCE', id, '{DEFAULT_COMPANY_ID}'::uuid
        FROM permissions
        WHERE name IN (
            'time_entries.view',
            'time_entries.create',
            'schedules.view',
            'leave.view',
            'leave.create'
        )
    """)
    
    # HOUSEKEEPING: Time entries (view, create), schedules (view), leave (view, create)
    op.execute(f"""
        INSERT INTO role_permissions (role, permission_id, company_id)
        SELECT 'HOUSEKEEPING', id, '{DEFAULT_COMPANY_ID}'::uuid
        FROM permissions
        WHERE name IN (
            'time_entries.view',
            'time_entries.create',
            'schedules.view',
            'leave.view',
            'leave.create'
        )
    """)


def downgrade() -> None:
    # Remove seeded permissions
    op.execute(f"""
        DELETE FROM role_permissions 
        WHERE company_id = '{DEFAULT_COMPANY_ID}'::uuid
    """)
