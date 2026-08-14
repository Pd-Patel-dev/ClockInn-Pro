"""Drop unused email_templates tables.

Revision ID: 040_drop_email_templates
Revises: 039_marketplace_sales
Create Date: 2026-08-14
"""

from alembic import op

revision = "040_drop_email_templates"
down_revision = "039_marketplace_sales"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS email_template_versions CASCADE")
    op.execute("DROP TABLE IF EXISTS email_templates CASCADE")
    op.execute("DROP TYPE IF EXISTS emailtemplatecategory")


def downgrade() -> None:
    # Tables are intentionally not recreated; emails use hardcoded templates.
    pass
