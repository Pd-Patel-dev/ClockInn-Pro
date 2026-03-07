"""add_shift_note_permissions

Revision ID: 027_shift_note_perms
Revises: 026_shift_notes
Create Date: 2026-02-19

"""
from alembic import op

revision = "027_shift_note_perms"
down_revision = "026_shift_notes"
branch_labels = None
depends_on = None

DEFAULT_COMPANY_ID = "00000000-0000-0000-0000-000000000000"


def upgrade() -> None:
    op.execute("""
        INSERT INTO permissions (id, name, display_name, description, category, created_at)
        VALUES 
        (gen_random_uuid(), 'shift_note:edit:self', 'Edit Own Shift Notes', 'Edit shift notepad for own shifts', 'TIME_ENTRIES', now()),
        (gen_random_uuid(), 'shift_note:view:self', 'View Own Shift Notes', 'View own shift notepad', 'TIME_ENTRIES', now()),
        (gen_random_uuid(), 'shift_note:view:all', 'View All Shift Notes', 'View all shift notes (Common Log)', 'ADMIN', now()),
        (gen_random_uuid(), 'shift_note:review', 'Review Shift Notes', 'Mark shift notes as reviewed', 'ADMIN', now()),
        (gen_random_uuid(), 'shift_note:comment', 'Comment on Shift Notes', 'Add manager comments to shift notes', 'ADMIN', now())
        ON CONFLICT (name) DO NOTHING
    """)
    # ADMIN gets all shift note permissions (via existing "ADMIN gets all" in 020)
    op.execute(f"""
        INSERT INTO role_permissions (role, permission_id, company_id)
        SELECT 'ADMIN', id, '{DEFAULT_COMPANY_ID}'::uuid
        FROM permissions
        WHERE name IN (
            'shift_note:edit:self',
            'shift_note:view:self',
            'shift_note:view:all',
            'shift_note:review',
            'shift_note:comment'
        )
        ON CONFLICT (role, permission_id, company_id) DO NOTHING
    """)
    # Employees get self view/edit
    for role in ('FRONTDESK', 'MAINTENANCE', 'HOUSEKEEPING'):
        op.execute(f"""
            INSERT INTO role_permissions (role, permission_id, company_id)
            SELECT '{role}', id, '{DEFAULT_COMPANY_ID}'::uuid
            FROM permissions
            WHERE name IN ('shift_note:edit:self', 'shift_note:view:self')
            ON CONFLICT (role, permission_id, company_id) DO NOTHING
        """)


def downgrade() -> None:
    op.execute(f"""
        DELETE FROM role_permissions
        WHERE company_id = '{DEFAULT_COMPANY_ID}'::uuid
        AND permission_id IN (SELECT id FROM permissions WHERE name LIKE 'shift_note:%')
    """)
    op.execute("DELETE FROM permissions WHERE name LIKE 'shift_note:%'")
