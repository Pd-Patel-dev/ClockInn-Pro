"""Hotel rooms for housekeeping board."""
from sqlalchemy import Column, String, ForeignKey, DateTime, Boolean, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum

from app.core.database import Base


class RoomOccupancyStatus(str, enum.Enum):
    DEPARTING = "departing"
    STAYOVER = "stayover"


class HousekeepingSheetKind(str, enum.Enum):
    ASSIGNMENT = "assignment"
    FINALIZE = "finalize"


class RoomCleaningStatus(str, enum.Enum):
    CLEAN = "clean"
    DIRTY = "dirty"


class Room(Base):
    __tablename__ = "rooms"
    __table_args__ = (
        UniqueConstraint("company_id", "number", name="uq_rooms_company_number"),
        Index("ix_rooms_company_id", "company_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    number = Column(String(32), nullable=False)
    room_type = Column(String(64), nullable=False, default="Standard")
    occupancy_status = Column(
        String(20), nullable=False, default=RoomOccupancyStatus.DEPARTING.value
    )
    cleaning_status = Column(
        String(20), nullable=False, default=RoomCleaningStatus.CLEAN.value
    )
    assigned_housekeeper_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class HousekeepingSheet(Base):
    """Printed assignment batch for a housekeeper (snapshot history)."""

    __tablename__ = "housekeeping_sheets"
    __table_args__ = (Index("ix_housekeeping_sheets_company_id", "company_id"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    housekeeper_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    housekeeper_name = Column(String(255), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by_name = Column(String(255), nullable=True)
    notes = Column(String(1000), nullable=True)
    kind = Column(String(20), nullable=False, default=HousekeepingSheetKind.ASSIGNMENT.value)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    items = relationship(
        "HousekeepingSheetItem",
        back_populates="sheet",
        cascade="all, delete-orphan",
        order_by="HousekeepingSheetItem.room_number",
    )


class HousekeepingSheetItem(Base):
    __tablename__ = "housekeeping_sheet_items"
    __table_args__ = (Index("ix_housekeeping_sheet_items_sheet_id", "sheet_id"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sheet_id = Column(
        UUID(as_uuid=True), ForeignKey("housekeeping_sheets.id", ondelete="CASCADE"), nullable=False
    )
    room_id = Column(UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True)
    room_number = Column(String(32), nullable=False)
    room_type = Column(String(64), nullable=False)
    occupancy_status = Column(String(20), nullable=False)
    cleaning_status = Column(String(20), nullable=False)

    sheet = relationship("HousekeepingSheet", back_populates="items")
