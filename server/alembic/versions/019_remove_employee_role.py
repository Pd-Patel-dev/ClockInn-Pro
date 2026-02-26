"""remove_employee_role

Revision ID: 019_remove_employee_role
Revises: 018_fix_role_permissions
Create Date: 2026-01-24 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '019_remove_employee_role'
down_revision = '018_fix_role_permissions'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Step 1: Migrate all users with EMPLOYEE role to FRONTDESK
    op.execute("""
        UPDATE users
        SET role = 'FRONTDESK'
        WHERE role = 'EMPLOYEE'
    """)
    
    # Step 2: Update any company settings that reference EMPLOYEE in cash_drawer_required_roles
    # The settings_json column is of type JSON (not JSONB), so we need to:
    # 1. Cast to text, replace EMPLOYEE with FRONTDESK, and cast back to json
    op.execute("""
        UPDATE companies
        SET settings_json = (
            REPLACE(settings_json::text, '"EMPLOYEE"', '"FRONTDESK"')
        )::json
        WHERE settings_json IS NOT NULL
          AND settings_json::text LIKE '%EMPLOYEE%'
    """)
    
    # Step 3: Update role_permissions table - migrate EMPLOYEE permissions to FRONTDESK
    # First, delete EMPLOYEE role permissions that already exist for FRONTDESK (avoid duplicates)
    op.execute("""
        DELETE FROM role_permissions
        WHERE role = 'EMPLOYEE'
        AND permission_id IN (
            SELECT permission_id FROM role_permissions WHERE role = 'FRONTDESK'
        )
    """)
    
    # Then, update remaining EMPLOYEE role permissions to FRONTDESK
    op.execute("""
        UPDATE role_permissions
        SET role = 'FRONTDESK'
        WHERE role = 'EMPLOYEE'
    """)
    
    # Step 4: Remove EMPLOYEE from the enum
    # PostgreSQL doesn't support removing values from enums directly
    # We need to create a new enum without EMPLOYEE, migrate data, and replace
    
    # Create new enum type without EMPLOYEE
    op.execute("""
        CREATE TYPE userrole_new AS ENUM ('ADMIN', 'DEVELOPER', 'MAINTENANCE', 'FRONTDESK', 'HOUSEKEEPING')
    """)
    
    # Change the column to use the new enum
    op.execute("""
        ALTER TABLE users 
        ALTER COLUMN role TYPE userrole_new 
        USING role::text::userrole_new
    """)
    
    # Change role_permissions table to use the new enum type (if it uses the enum)
    # Note: role_permissions.role is VARCHAR, so no change needed there
    
    # Drop the old enum type
    op.execute("""
        DROP TYPE userrole
    """)
    
    # Rename the new enum type to the original name
    op.execute("""
        ALTER TYPE userrole_new RENAME TO userrole
    """)


def downgrade() -> None:
    # Re-add EMPLOYEE to the enum
    op.execute("""
        CREATE TYPE userrole_new AS ENUM ('ADMIN', 'EMPLOYEE', 'DEVELOPER', 'MAINTENANCE', 'FRONTDESK', 'HOUSEKEEPING')
    """)
    
    op.execute("""
        ALTER TABLE users 
        ALTER COLUMN role TYPE userrole_new 
        USING role::text::userrole_new
    """)
    
    op.execute("""
        DROP TYPE userrole
    """)
    
    op.execute("""
        ALTER TYPE userrole_new RENAME TO userrole
    """)
    
    # Note: We cannot restore which users were originally EMPLOYEE
    # as that data is lost after the upgrade
