"""Drop shift_notes tables, enum, and permissions.

Revision ID: 047_drop_shift_notes
Revises: 046_current_cash_cents
Create Date: 2026-08-19
"""
from alembic import op
import sqlalchemy as sa


revision = "047_drop_shift_notes"
down_revision = "046_current_cash_cents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Remove role_permissions rows that reference shift_note permissions first
    op.execute(
        sa.text(
            """
            DELETE FROM role_permissions
            WHERE permission_id IN (
                SELECT id FROM permissions WHERE name LIKE 'shift_note:%'
            )
            """
        )
    )
    op.execute(sa.text("DELETE FROM permissions WHERE name LIKE 'shift_note:%'"))

    op.execute(sa.text("DROP TABLE IF EXISTS shift_note_comments CASCADE"))
    op.execute(sa.text("DROP TABLE IF EXISTS shift_notes CASCADE"))
    op.execute(sa.text("DROP TYPE IF EXISTS shiftnotestatus"))


def downgrade() -> None:
    # Intentionally empty: shift notes feature is removed; recreate via 026/027 if needed.
    pass
