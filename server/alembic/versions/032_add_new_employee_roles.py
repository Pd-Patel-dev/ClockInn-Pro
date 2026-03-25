"""add manager restaurant security user roles

Revision ID: 032_add_new_employee_roles
Revises: 031_drop_backup_settings
Create Date: 2026-03-25
"""

from alembic import op

revision = "032_add_new_employee_roles"
down_revision = "031_drop_backup_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL 9.1+ ADD VALUE; IF NOT EXISTS requires PostgreSQL 15+ (matches postgres:15 image).
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'MANAGER'")
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'RESTAURANT'")
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'SECURITY'")


def downgrade() -> None:
    # PostgreSQL enum value removal is intentionally omitted.
    pass

