"""
developer company_id optional + globally unique emails

Revision ID: 033_developer_company_optional
Revises: 032_add_new_employee_roles
Create Date: 2026-07-29

DEPLOYMENT NOTES:
1. Back up the database BEFORE running.
2. Run during a maintenance window.
3. If the DB has duplicate emails across companies, this migration will HALT with a
   clear error listing the conflicts. Resolve manually before re-running.
4. After migration, verify:
   SELECT id, email, role, company_id FROM users WHERE role = 'DEVELOPER';
   All rows should have company_id IS NULL.
5. Issue new JWTs — all developer sessions must re-login since old tokens carry
   the old company_id.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = "033_developer_company_optional"
down_revision = "032_add_new_employee_roles"
branch_labels = None
depends_on = None

SYSTEM_DEFAULT_COMPANY_ID = "00000000-0000-0000-0000-000000000000"


def upgrade() -> None:
    # 1. Drop per-company email uniqueness (constraint and/or index from prior migrations)
    op.execute(text("ALTER TABLE users DROP CONSTRAINT IF EXISTS uq_user_company_email"))
    op.execute(text("DROP INDEX IF EXISTS ix_users_company_email_lower"))
    op.execute(text("DROP INDEX IF EXISTS uq_user_company_email"))

    # Sessions also reference company_id; developers will have NULL company_id
    op.execute(text("ALTER TABLE sessions ALTER COLUMN company_id DROP NOT NULL"))

    # 2. Allow NULL company_id on users
    op.execute(text("ALTER TABLE users ALTER COLUMN company_id DROP NOT NULL"))

    # 3. Detach all DEVELOPER accounts from companies
    op.execute(text("UPDATE users SET company_id = NULL WHERE role = 'DEVELOPER'"))

    # 4. Enforce role ↔ company_id invariant
    op.execute(
        text(
            """
            ALTER TABLE users
            ADD CONSTRAINT ck_user_company_by_role
            CHECK (
                (role::text = 'DEVELOPER' AND company_id IS NULL)
                OR (role::text <> 'DEVELOPER' AND company_id IS NOT NULL)
            )
            """
        )
    )

    # 5. Halt on duplicate emails before creating global unique index
    connection = op.get_bind()
    result = connection.execute(
        text(
            """
            SELECT LOWER(email) AS lemail, COUNT(*) AS cnt, array_agg(id) AS ids
            FROM users
            GROUP BY LOWER(email)
            HAVING COUNT(*) > 1
            """
        )
    ).fetchall()
    if result:
        raise Exception(
            f"Cannot enforce globally unique emails. Duplicate emails found: {result}. "
            f"Resolve manually before running this migration: either delete/rename the duplicates "
            f"or merge the accounts."
        )

    # 6. Global case-insensitive unique email
    op.execute(text("CREATE UNIQUE INDEX uq_user_email ON users (LOWER(email))"))


def downgrade() -> None:
    op.execute(text("DROP INDEX IF EXISTS uq_user_email"))
    op.execute(text("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_user_company_by_role"))

    # Re-attach developers to the system default company (must exist)
    op.execute(
        text(
            f"""
            UPDATE users
            SET company_id = '{SYSTEM_DEFAULT_COMPANY_ID}'::uuid
            WHERE role = 'DEVELOPER' AND company_id IS NULL
            """
        )
    )

    op.execute(text("ALTER TABLE users ALTER COLUMN company_id SET NOT NULL"))
    op.execute(text("ALTER TABLE sessions ALTER COLUMN company_id SET NOT NULL"))

    op.create_index(
        "ix_users_company_email_lower",
        "users",
        [sa.text("company_id"), sa.text("LOWER(email)")],
        unique=True,
    )
