"""
Shift and Schedule Models

Handles employee shift scheduling, templates, and approvals.
"""
import enum
import uuid
from datetime import datetime, date, time
from sqlalchemy import Column, String, DateTime, Date, Time, ForeignKey, Boolean, Text, Integer, Enum, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class ShiftStatus(str, enum.Enum):
    """Shift status options."""
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    APPROVED = "APPROVED"
    CANCELLED = "CANCELLED"


class ShiftTemplateType(str, enum.Enum):
    """Shift template recurrence type."""
    WEEKLY = "WEEKLY"
    BIWEEKLY = "BIWEEKLY"
    MONTHLY = "MONTHLY"
    NONE = "NONE"  # One-time schedule


class Shift(Base):
    """Individual shift assignment for an employee."""
    __tablename__ = "shifts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    
    # Shift details
    shift_date = Column(Date, nullable=False, index=True)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    break_minutes = Column(Integer, nullable=False, default=0)
    
    # Metadata
    status = Column(Enum(ShiftStatus, values_callable=lambda x: [e.value for e in x]), nullable=False, default=ShiftStatus.DRAFT)
    notes = Column(Text, nullable=True)
    job_role = Column(String(255), nullable=True)  # Optional override for this shift
    
    # Template reference (if created from template)
    template_id = Column(UUID(as_uuid=True), ForeignKey("shift_templates.id"), nullable=True, index=True)
    
    # Series ID for grouping bulk-created shifts (e.g., weekly bulk creation)
    series_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    
    # Approval workflow
    requires_approval = Column(Boolean, nullable=False, default=False)
    approved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationships
    company = relationship("Company", backref="shifts")
    employee = relationship("User", foreign_keys=[employee_id], backref="shifts")
    approver = relationship("User", foreign_keys=[approved_by])
    creator = relationship("User", foreign_keys=[created_by])
    template = relationship("ShiftTemplate", backref="shifts")
    
    # Indexes
    __table_args__ = (
        Index('idx_shifts_company_employee_date', 'company_id', 'employee_id', 'shift_date'),
        Index('idx_shifts_company_date_status', 'company_id', 'shift_date', 'status'),
    )


class ShiftTemplate(Base):
    """Recurring shift template for creating multiple shifts."""
    __tablename__ = "shift_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)  # Null for department templates
    
    # Template details
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    
    # Shift pattern
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    break_minutes = Column(Integer, nullable=False, default=0)
    
    # Recurrence
    template_type = Column(Enum(ShiftTemplateType, values_callable=lambda x: [e.value for e in x]), nullable=False, default=ShiftTemplateType.NONE)
    day_of_week = Column(Integer, nullable=True)  # 0=Monday, 6=Sunday (for weekly/biweekly)
    day_of_month = Column(Integer, nullable=True)  # 1-31 (for monthly)
    week_of_month = Column(Integer, nullable=True)  # 1-4 (for monthly, e.g., "first Monday")
    
    # Date range
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)  # Null = ongoing
    
    # Settings
    is_active = Column(Boolean, nullable=False, default=True)
    requires_approval = Column(Boolean, nullable=False, default=False)
    
    # Department/Team (optional - for bulk assignment)
    department = Column(String(255), nullable=True)
    job_role = Column(String(255), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationships
    company = relationship("Company", backref="shift_templates")
    employee = relationship("User", foreign_keys=[employee_id], backref="shift_templates")
    creator = relationship("User", foreign_keys=[created_by])


class ScheduleSwap(Base):
    """Employee shift swap requests."""
    __tablename__ = "schedule_swaps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    
    # Swaps
    original_shift_id = Column(UUID(as_uuid=True), ForeignKey("shifts.id"), nullable=False)
    requested_shift_id = Column(UUID(as_uuid=True), ForeignKey("shifts.id"), nullable=True)  # Null if open request
    
    # Employees
    requester_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)  # Employee requesting swap
    offerer_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)  # Employee offering swap
    
    # Status
    status = Column(String(50), nullable=False, default="pending")  # pending, approved, rejected, cancelled
    approved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationships
    company = relationship("Company", backref="schedule_swaps")
    original_shift = relationship("Shift", foreign_keys=[original_shift_id], backref="swap_requests")
    requested_shift = relationship("Shift", foreign_keys=[requested_shift_id])
    requester = relationship("User", foreign_keys=[requester_id], backref="swap_requests")
    offerer = relationship("User", foreign_keys=[offerer_id], backref="swap_offers")
    approver = relationship("User", foreign_keys=[approved_by])

