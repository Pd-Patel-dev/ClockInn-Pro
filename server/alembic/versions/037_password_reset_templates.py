"""
Legacy password-reset template seed (no-op).

Emails now use hardcoded bodies in email_service; DB template content is unused.

Revision ID: 037_password_reset_templates
Revises: 036_email_templates
Create Date: 2026-07-31
"""

revision = "037_password_reset_templates"
down_revision = "036_email_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
