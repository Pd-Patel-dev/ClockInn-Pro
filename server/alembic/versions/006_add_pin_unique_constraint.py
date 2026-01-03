"""Add unique constraint on PIN per company

Revision ID: 006
Revises: 005
Create Date: 2025-01-03 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add unique constraint on (company_id, pin_hash) where pin_hash is not null
    # This ensures PINs are unique within each company, but the same PIN can be used in different companies
    # We use a partial unique index since we only want uniqueness when pin_hash is not null
    
    # First, clean up any duplicate PINs within the same company
    # Keep the oldest user record for each (company_id, pin_hash) pair
    op.execute("""
        DELETE FROM users
        WHERE id IN (
            SELECT id
            FROM (
                SELECT
                    id,
                    ROW_NUMBER() OVER (PARTITION BY company_id, pin_hash ORDER BY created_at, id) as rn
                FROM users
                WHERE pin_hash IS NOT NULL
            ) AS sub
            WHERE rn > 1
        )
    """)
    
    # Create unique index on (company_id, pin_hash) where pin_hash is not null
    # Using a partial unique index (PostgreSQL feature)
    op.execute("""
        CREATE UNIQUE INDEX ix_users_company_pin_hash_unique 
        ON users(company_id, pin_hash) 
        WHERE pin_hash IS NOT NULL
    """)


def downgrade() -> None:
    # Drop the unique index
    op.drop_index('ix_users_company_pin_hash_unique', table_name='users')

