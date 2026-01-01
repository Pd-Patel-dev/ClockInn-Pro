"""Add job_role and pay_rate to users

Revision ID: 002
Revises: 001
Create Date: 2024-01-02 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add job_role and pay_rate columns to users table
    op.add_column('users', sa.Column('job_role', sa.String(255), nullable=True))
    op.add_column('users', sa.Column('pay_rate', sa.Numeric(10, 2), nullable=True))


def downgrade() -> None:
    # Remove job_role and pay_rate columns from users table
    op.drop_column('users', 'pay_rate')
    op.drop_column('users', 'job_role')

