"""add_developer_role

Revision ID: c1d2e3f4g5h6
Revises: b1c2d3e4f5g6
Create Date: 2026-01-11 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c1d2e3f4g5h6'
down_revision = 'b1c2d3e4f5g6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add DEVELOPER to the userrole enum
    # PostgreSQL enum alteration requires using ALTER TYPE ... ADD VALUE
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'DEVELOPER'")


def downgrade() -> None:
    # Note: PostgreSQL does not support removing enum values easily
    # This would require recreating the enum type and all columns using it
    # For now, we'll leave DEVELOPER in the enum even on downgrade
    # If needed, this can be done manually:
    # 1. Create new enum without DEVELOPER
    # 2. Alter all columns to use new enum
    # 3. Drop old enum
    # 4. Rename new enum to old name
    pass

