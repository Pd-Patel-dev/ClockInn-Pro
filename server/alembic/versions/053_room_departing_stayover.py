"""053: room occupancy vacant/occupied → departing/stayover."""
from alembic import op


revision = "053_room_departing_stayover"
down_revision = "052_room_assigned_housekeeper"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE rooms SET occupancy_status = 'departing' WHERE occupancy_status = 'vacant'")
    op.execute("UPDATE rooms SET occupancy_status = 'stayover' WHERE occupancy_status = 'occupied'")
    op.execute(
        "UPDATE rooms SET occupancy_status = 'departing' "
        "WHERE occupancy_status NOT IN ('departing', 'stayover')"
    )
    op.alter_column("rooms", "occupancy_status", server_default="departing")


def downgrade() -> None:
    op.execute("UPDATE rooms SET occupancy_status = 'vacant' WHERE occupancy_status = 'departing'")
    op.execute("UPDATE rooms SET occupancy_status = 'occupied' WHERE occupancy_status = 'stayover'")
    op.alter_column("rooms", "occupancy_status", server_default="vacant")
