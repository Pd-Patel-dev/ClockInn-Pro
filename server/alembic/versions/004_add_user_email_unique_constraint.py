"""Add unique constraint on user email per company

Revision ID: 004
Revises: 003
Create Date: 2025-01-02 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # First, clean up any duplicate emails within the same company
    # Keep the oldest user record for each (company_id, email) pair
    # Clean up duplicate emails using ROW_NUMBER (compatible with UUID)
    op.execute(text("""
        DELETE FROM users
        WHERE id IN (
            SELECT id
            FROM (
                SELECT
                    id,
                    ROW_NUMBER() OVER (PARTITION BY company_id, LOWER(email) ORDER BY created_at, id) as rn
                FROM users
            ) AS sub
            WHERE rn > 1
        )
    """))
    
    # Create unique constraint on (company_id, email)
    # Using LOWER(email) to ensure case-insensitive uniqueness
    op.create_index(
        'ix_users_company_email_lower',
        'users',
        [sa.text('company_id'), sa.text('LOWER(email)')],
        unique=True,
    )


def downgrade() -> None:
    # Drop the unique index
    op.drop_index('ix_users_company_email_lower', table_name='users')

