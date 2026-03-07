"""ShiftNote and ShiftNoteComment models for Common Log / Shift Notepad."""
from sqlalchemy import Column, String, ForeignKey, DateTime, Text, Enum, Index, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum
from app.core.database import Base


class ShiftNoteStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    REVIEWED = "REVIEWED"


class ShiftNote(Base):
    __tablename__ = "shift_notes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True)
    time_entry_id = Column(UUID(as_uuid=True), ForeignKey("time_entries.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content = Column(Text, nullable=False, default="")
    beverage_sold = Column(Integer, nullable=True, default=None)  # optional count of beverages sold
    status = Column(Enum(ShiftNoteStatus, values_callable=lambda x: [e.value for e in x]), nullable=False, default=ShiftNoteStatus.DRAFT)
    last_edited_at = Column(DateTime(timezone=True), nullable=True)
    last_edited_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    time_entry = relationship("TimeEntry", back_populates="shift_note", foreign_keys=[time_entry_id])
    employee = relationship("User", foreign_keys=[employee_id])
    last_editor = relationship("User", foreign_keys=[last_edited_by])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
    comments = relationship("ShiftNoteComment", back_populates="shift_note", cascade="all, delete-orphan", order_by="ShiftNoteComment.created_at")

    __table_args__ = (
        Index("idx_shift_notes_company_updated", "company_id", "updated_at"),
        Index("idx_shift_notes_company_employee_updated", "company_id", "employee_id", "updated_at"),
        Index("idx_shift_notes_company_time_entry", "company_id", "time_entry_id"),
    )


class ShiftNoteComment(Base):
    __tablename__ = "shift_note_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True)
    shift_note_id = Column(UUID(as_uuid=True), ForeignKey("shift_notes.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    comment = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    shift_note = relationship("ShiftNote", back_populates="comments")
    actor = relationship("User", foreign_keys=[actor_user_id])
