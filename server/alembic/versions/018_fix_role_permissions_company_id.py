"""fix_role_permissions_company_id

Revision ID: 018_fix_role_permissions
Revises: 017_add_hotel_roles
Create Date: 2026-01-17 23:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '018_fix_role_permissions'
down_revision = '017_add_hotel_roles'
branch_labels = None
depends_on = None

# Default company ID for global permissions
DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000000'


def upgrade() -> None:
    # First, create a default company if it doesn't exist (for foreign key constraint)
    # Note: slug must be unique and max 50 chars, so we use a short unique slug
    # Use DO block to handle both id and slug conflicts
    op.execute(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM companies WHERE id = '{DEFAULT_COMPANY_ID}'::uuid) THEN
                BEGIN
                    INSERT INTO companies (id, name, slug, kiosk_enabled, created_at)
                    VALUES ('{DEFAULT_COMPANY_ID}'::uuid, 'Default (System)', 'default-system', false, now());
                EXCEPTION WHEN unique_violation THEN
                    -- Slug might already exist, try with a different slug
                    INSERT INTO companies (id, name, slug, kiosk_enabled, created_at)
                    VALUES ('{DEFAULT_COMPANY_ID}'::uuid, 'Default (System)', 'sys-default-00000000', false, now());
                END;
            END IF;
        END $$;
    """)
    
    # Update any NULL company_id values to DEFAULT_COMPANY_ID
    op.execute(f"""
        UPDATE role_permissions
        SET company_id = '{DEFAULT_COMPANY_ID}'::uuid
        WHERE company_id IS NULL
    """)
    
    # Now alter the column to be NOT NULL
    op.alter_column('role_permissions', 'company_id',
                    existing_type=postgresql.UUID(as_uuid=True),
                    nullable=False)


def downgrade() -> None:
    # Make company_id nullable again
    op.alter_column('role_permissions', 'company_id',
                    existing_type=postgresql.UUID(as_uuid=True),
                    nullable=True)
    
    # Set NULL for default company entries
    op.execute(f"""
        UPDATE role_permissions
        SET company_id = NULL
        WHERE company_id = '{DEFAULT_COMPANY_ID}'::uuid
    """)
