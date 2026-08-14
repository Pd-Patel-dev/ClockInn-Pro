"""
Email templates tables (create only; content unused).

Revision ID: 036_email_templates
Revises: 035_profile_fields
Create Date: 2026-07-31
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "036_email_templates"
down_revision = "035_profile_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE emailtemplatecategory AS ENUM ('TRANSACTIONAL', 'NOTIFICATION', 'SUMMARY', 'MARKETING');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
        """
    )

    op.create_table(
        "email_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "category",
            postgresql.ENUM(
                "TRANSACTIONAL",
                "NOTIFICATION",
                "SUMMARY",
                "MARKETING",
                name="emailtemplatecategory",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("variables_schema", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_email_templates_key", "email_templates", ["key"], unique=True)

    op.create_table(
        "email_template_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("template_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("email_templates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("subject", sa.String(500), nullable=False),
        sa.Column("body_html", sa.Text(), nullable=False),
        sa.Column("body_text", sa.Text(), nullable=False),
        sa.Column("from_name", sa.String(255), nullable=True),
        sa.Column("from_email", sa.String(255), nullable=True),
        sa.Column("reply_to", sa.String(255), nullable=True),
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_draft", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_email_template_versions_template_id", "email_template_versions", ["template_id"])
    op.create_index(
        "uq_email_template_published",
        "email_template_versions",
        ["template_id"],
        unique=True,
        postgresql_where=sa.text("is_published = true"),
    )
    op.create_index(
        "uq_email_template_draft",
        "email_template_versions",
        ["template_id"],
        unique=True,
        postgresql_where=sa.text("is_draft = true"),
    )
    op.create_index(
        "idx_email_template_versions_template_num",
        "email_template_versions",
        ["template_id", "version_number"],
    )


def downgrade() -> None:
    op.drop_table("email_template_versions")
    op.drop_table("email_templates")
    op.execute("DROP TYPE IF EXISTS emailtemplatecategory")
