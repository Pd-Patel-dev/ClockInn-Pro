from sqlalchemy import Column, String, ForeignKey, DateTime, Integer, Enum, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum
from app.core.database import Base


class TimeEntrySource(str, enum.Enum):
    KIOSK = "kiosk"
    WEB = "web"


class TimeEntryStatus(str, enum.Enum):
    OPEN = "open"
    CLOSED = "closed"
    EDITED = "edited"
    APPROVED = "approved"


class TimeEntry(Base):
    __tablename__ = "time_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    clock_in_at = Column(DateTime(timezone=True), nullable=False)
    clock_out_at = Column(DateTime(timezone=True), nullable=True)
    break_minutes = Column(Integer, default=0, nullable=False)
    source = Column(Enum(TimeEntrySource, values_callable=lambda x: [e.value for e in x]), nullable=False, default=TimeEntrySource.KIOSK)
    note = Column(String(500), nullable=True)
    status = Column(Enum(TimeEntryStatus, values_callable=lambda x: [e.value for e in x]), nullable=False, default=TimeEntryStatus.OPEN)
    edited_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    edit_reason = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    employee = relationship("User", foreign_keys=[employee_id], back_populates="time_entries")
    editor = relationship("User", foreign_keys=[edited_by])

    __table_args__ = (
        Index("idx_time_entries_employee_company", "employee_id", "company_id"),
        Index("idx_time_entries_clock_in", "clock_in_at"),
    )

