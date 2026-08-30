"""050: rooms + housekeeping assignment sheets."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "050_housekeeping_rooms"
down_revision = "049_user_permission_overrides"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rooms",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.String(32), nullable=False),
        sa.Column("room_type", sa.String(64), nullable=False, server_default="Standard"),
        sa.Column("occupancy_status", sa.String(20), nullable=False, server_default="vacant"),
        sa.Column("cleaning_status", sa.String(20), nullable=False, server_default="clean"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("company_id", "number", name="uq_rooms_company_number"),
    )
    op.create_index("ix_rooms_company_id", "rooms", ["company_id"])

    op.create_table(
        "housekeeping_sheets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("housekeeper_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("housekeeper_name", sa.String(255), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_name", sa.String(255), nullable=True),
        sa.Column("notes", sa.String(1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_housekeeping_sheets_company_id", "housekeeping_sheets", ["company_id"])

    op.create_table(
        "housekeeping_sheet_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("sheet_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("housekeeping_sheets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True),
        sa.Column("room_number", sa.String(32), nullable=False),
        sa.Column("room_type", sa.String(64), nullable=False),
        sa.Column("occupancy_status", sa.String(20), nullable=False),
        sa.Column("cleaning_status", sa.String(20), nullable=False),
    )
    op.create_index("ix_housekeeping_sheet_items_sheet_id", "housekeeping_sheet_items", ["sheet_id"])


def downgrade() -> None:
    op.drop_index("ix_housekeeping_sheet_items_sheet_id", table_name="housekeeping_sheet_items")
    op.drop_table("housekeeping_sheet_items")
    op.drop_index("ix_housekeeping_sheets_company_id", table_name="housekeeping_sheets")
    op.drop_table("housekeeping_sheets")
    op.drop_index("ix_rooms_company_id", table_name="rooms")
    op.drop_table("rooms")
