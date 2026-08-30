"""052: room assigned_housekeeper_id for assign board."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "052_room_assigned_housekeeper"
down_revision = "051_housekeeping_permissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column(
            "assigned_housekeeper_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_rooms_assigned_housekeeper_id",
        "rooms",
        ["assigned_housekeeper_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_rooms_assigned_housekeeper_id", table_name="rooms")
    op.drop_column("rooms", "assigned_housekeeper_id")
