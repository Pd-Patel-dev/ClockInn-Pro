"""051: housekeeping permissions for Roles & Permissions UI."""
from alembic import op


revision = "051_housekeeping_permissions"
down_revision = "050_housekeeping_rooms"
branch_labels = None
depends_on = None

DEFAULT_COMPANY_ID = "00000000-0000-0000-0000-000000000000"


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO permissions (id, name, display_name, description, category, created_at)
        VALUES
        (
          gen_random_uuid(),
          'housekeeping.view',
          'View Housekeeping Board',
          'View rooms and housekeeping board',
          'HOUSEKEEPING',
          now()
        ),
        (
          gen_random_uuid(),
          'housekeeping.status',
          'Update Room Status',
          'Update occupancy and cleaning status',
          'HOUSEKEEPING',
          now()
        ),
        (
          gen_random_uuid(),
          'housekeeping.assign',
          'Assign & Print Sheets',
          'Assign rooms to housekeepers and print assignment sheets',
          'HOUSEKEEPING',
          now()
        )
        ON CONFLICT (name) DO NOTHING
        """
    )

    # Default: HOUSEKEEPING role gets basic housekeeping permissions
    op.execute(
        f"""
        INSERT INTO role_permissions (role, permission_id, company_id)
        SELECT 'HOUSEKEEPING', id, '{DEFAULT_COMPANY_ID}'::uuid
        FROM permissions
        WHERE name IN (
          'housekeeping.view',
          'housekeeping.status',
          'housekeeping.assign'
        )
        ON CONFLICT DO NOTHING
        """
    )

    # Default: FRONTDESK can update status and assign/print
    op.execute(
        f"""
        INSERT INTO role_permissions (role, permission_id, company_id)
        SELECT 'FRONTDESK', id, '{DEFAULT_COMPANY_ID}'::uuid
        FROM permissions
        WHERE name IN (
          'housekeeping.view',
          'housekeeping.status',
          'housekeeping.assign'
        )
        ON CONFLICT DO NOTHING
        """
    )

    # ADMIN defaults: attach any missing (ADMIN UI also returns all permissions)
    op.execute(
        f"""
        INSERT INTO role_permissions (role, permission_id, company_id)
        SELECT 'ADMIN', id, '{DEFAULT_COMPANY_ID}'::uuid
        FROM permissions
        WHERE name IN (
          'housekeeping.view',
          'housekeeping.status',
          'housekeeping.assign'
        )
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM role_permissions
        WHERE permission_id IN (
          SELECT id FROM permissions WHERE name LIKE 'housekeeping.%'
        )
        """
    )
    op.execute("DELETE FROM permissions WHERE name LIKE 'housekeeping.%'")
