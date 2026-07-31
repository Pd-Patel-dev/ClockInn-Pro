"""
Add user profile preference fields and session device metadata.

Uses existing `sessions` table as the session store (equivalent to user_sessions
in the product spec) — adds device_label + last_used_at.

Revision ID: 035_profile_fields
Revises: 034_password_setup_token
Create Date: 2026-07-31
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "035_profile_fields"
down_revision = "034_password_setup_token"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_url", sa.String(length=1024), nullable=True))
    op.add_column("users", sa.Column("preferred_name", sa.String(length=100), nullable=True))
    op.add_column("users", sa.Column("phone", sa.String(length=30), nullable=True))
    op.add_column(
        "users",
        sa.Column("timezone", sa.String(length=64), nullable=True, server_default="America/Chicago"),
    )
    op.add_column(
        "users",
        sa.Column("date_format", sa.String(length=16), nullable=False, server_default="MM/DD/YYYY"),
    )
    op.add_column(
        "users",
        sa.Column("time_format", sa.String(length=8), nullable=False, server_default="12h"),
    )
    op.add_column(
        "users",
        sa.Column("first_day_of_week", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "users",
        sa.Column("theme_preference", sa.String(length=16), nullable=False, server_default="system"),
    )

    op.create_check_constraint(
        "ck_users_date_format",
        "users",
        "date_format IN ('MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD')",
    )
    op.create_check_constraint(
        "ck_users_time_format",
        "users",
        "time_format IN ('12h', '24h')",
    )
    op.create_check_constraint(
        "ck_users_first_day_of_week",
        "users",
        "first_day_of_week IN (0, 1)",
    )
    op.create_check_constraint(
        "ck_users_theme_preference",
        "users",
        "theme_preference IN ('light', 'dark', 'system')",
    )

    op.add_column("sessions", sa.Column("device_label", sa.String(length=255), nullable=True))
    op.add_column(
        "sessions",
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "user_avatars",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("data_url", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("user_avatars")
    op.drop_column("sessions", "last_used_at")
    op.drop_column("sessions", "device_label")
    op.drop_constraint("ck_users_theme_preference", "users", type_="check")
    op.drop_constraint("ck_users_first_day_of_week", "users", type_="check")
    op.drop_constraint("ck_users_time_format", "users", type_="check")
    op.drop_constraint("ck_users_date_format", "users", type_="check")
    op.drop_column("users", "theme_preference")
    op.drop_column("users", "first_day_of_week")
    op.drop_column("users", "time_format")
    op.drop_column("users", "date_format")
    op.drop_column("users", "timezone")
    op.drop_column("users", "phone")
    op.drop_column("users", "preferred_name")
    op.drop_column("users", "avatar_url")
