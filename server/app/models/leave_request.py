from sqlalchemy import Column, String, ForeignKey, DateTime, Date, Integer, Enum, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum
from app.core.database import Base


class LeaveType(str, enum.Enum):
    VACATION = "vacation"
    SICK = "sick"
    PERSONAL = "personal"
    OTHER = "other"


class LeaveStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class LeaveRequest(Base):
    __tablename__ = "leave_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    type = Column(Enum(LeaveType, values_callable=lambda x: [e.value for e in x]), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    partial_day_hours = Column(Integer, nullable=True)
    reason = Column(String(1000), nullable=True)
    status = Column(Enum(LeaveStatus, values_callable=lambda x: [e.value for e in x]), nullable=False, default=LeaveStatus.PENDING)
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    review_comment = Column(String(1000), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    employee = relationship("User", foreign_keys=[employee_id], back_populates="leave_requests")
    reviewer = relationship("User", foreign_keys=[reviewed_by])

    __table_args__ = (
        Index("idx_leave_requests_employee_company", "employee_id", "company_id"),
        Index("idx_leave_requests_status", "status"),
        Index("idx_leave_requests_company_status_created", "company_id", "status", "created_at"),
    )

