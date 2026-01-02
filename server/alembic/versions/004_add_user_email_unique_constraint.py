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
    op.execute(text("""
        DELETE FROM users u1
        WHERE u1.id NOT IN (
            SELECT MIN(u2.id)
            FROM users u2
            GROUP BY u2.company_id, LOWER(u2.email)
        )
        AND EXISTS (
            SELECT 1
            FROM users u3
            WHERE u3.company_id = u1.company_id
            AND LOWER(u3.email) = LOWER(u1.email)
            AND u3.id < u1.id
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

