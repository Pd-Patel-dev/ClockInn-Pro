"""
Split password_reset (link) from password_reset_otp; refresh published password_reset content.

Revision ID: 037_password_reset_templates
Revises: 036_email_templates
Create Date: 2026-07-31
"""

from alembic import op
import sqlalchemy as sa
import uuid
import json
from datetime import datetime, timezone

revision = "037_password_reset_templates"
down_revision = "036_email_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.services.email_template_factory import get_factory_by_key
    from app.services.email_template_service import invalidate_template_cache

    conn = op.get_bind()
    now = datetime.now(timezone.utc)

    # Seed password_reset_otp if missing
    otp = get_factory_by_key("password_reset_otp")
    assert otp
    existing_otp = conn.execute(
        sa.text("SELECT id FROM email_templates WHERE key = 'password_reset_otp'")
    ).fetchone()
    if not existing_otp:
        tid = uuid.uuid4()
        vid = uuid.uuid4()
        conn.execute(
            sa.text(
                """
                INSERT INTO email_templates
                (id, key, name, description, category, variables_schema, is_system, is_enabled, created_at, updated_at)
                VALUES (:id, :key, :name, :description, :category, CAST(:variables_schema AS jsonb), true, true, :now, :now)
                """
            ),
            {
                "id": tid,
                "key": otp["key"],
                "name": otp["name"],
                "description": otp.get("description"),
                "category": otp["category"],
                "variables_schema": json.dumps(otp.get("variables_schema") or {}),
                "now": now,
            },
        )
        conn.execute(
            sa.text(
                """
                INSERT INTO email_template_versions
                (id, template_id, version_number, subject, body_html, body_text,
                 is_published, is_draft, published_at, created_at, notes)
                VALUES
                (:id, :template_id, 1, :subject, :body_html, :body_text,
                 true, false, :now, :now, 'Factory default')
                """
            ),
            {
                "id": vid,
                "template_id": tid,
                "subject": otp["subject"],
                "body_html": otp["body_html"],
                "body_text": otp["body_text"],
                "now": now,
            },
        )

    # Update password_reset metadata + publish new link-based version from factory
    reset = get_factory_by_key("password_reset")
    assert reset
    row = conn.execute(
        sa.text("SELECT id FROM email_templates WHERE key = 'password_reset'")
    ).fetchone()
    if row:
        template_id = row[0]
        conn.execute(
            sa.text(
                """
                UPDATE email_templates
                SET name = :name,
                    description = :description,
                    variables_schema = CAST(:variables_schema AS jsonb),
                    updated_at = :now
                WHERE id = :id
                """
            ),
            {
                "id": template_id,
                "name": reset["name"],
                "description": reset.get("description"),
                "variables_schema": json.dumps(reset.get("variables_schema") or {}),
                "now": now,
            },
        )
        # Unpublish current
        conn.execute(
            sa.text(
                """
                UPDATE email_template_versions
                SET is_published = false
                WHERE template_id = :template_id AND is_published = true
                """
            ),
            {"template_id": template_id},
        )
        max_num = conn.execute(
            sa.text(
                """
                SELECT COALESCE(MAX(version_number), 0)
                FROM email_template_versions
                WHERE template_id = :template_id AND is_draft = false
                """
            ),
            {"template_id": template_id},
        ).scalar()
        conn.execute(
            sa.text(
                """
                INSERT INTO email_template_versions
                (id, template_id, version_number, subject, body_html, body_text,
                 is_published, is_draft, published_at, created_at, notes)
                VALUES
                (:id, :template_id, :version_number, :subject, :body_html, :body_text,
                 true, false, :now, :now, 'Link-based password reset (split from OTP)')
                """
            ),
            {
                "id": uuid.uuid4(),
                "template_id": template_id,
                "version_number": int(max_num or 0) + 1,
                "subject": reset["subject"],
                "body_html": reset["body_html"],
                "body_text": reset["body_text"],
                "now": now,
            },
        )

    invalidate_template_cache()


def downgrade() -> None:
    # Keep password_reset_otp; do not delete data on downgrade
    pass
