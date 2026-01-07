from sqlalchemy import Column, String, ForeignKey, Enum, DateTime, Boolean, Numeric, Integer, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum
from app.core.database import Base


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    EMPLOYEE = "EMPLOYEE"
    DEVELOPER = "DEVELOPER"


class UserStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class PayRateType(str, enum.Enum):
    HOURLY = "HOURLY"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    role = Column(Enum(UserRole, values_callable=lambda x: [e.value for e in x]), nullable=False, default=UserRole.EMPLOYEE)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    pin_hash = Column(String(255), nullable=True)
    status = Column(Enum(UserStatus, values_callable=lambda x: [e.value for e in x]), nullable=False, default=UserStatus.ACTIVE)
    job_role = Column(String(255), nullable=True)
    pay_rate = Column(Numeric(10, 2), nullable=True)  # Legacy field, kept for backward compatibility
    pay_rate_cents = Column(Integer, nullable=False, default=0)  # Pay rate in cents (e.g., 2500 = $25.00)
    pay_rate_type = Column(Enum(PayRateType, values_callable=lambda x: [e.value for e in x]), nullable=False, default=PayRateType.HOURLY)
    overtime_multiplier = Column(Numeric(4, 2), nullable=True)  # Employee-specific override, defaults to company setting
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    
    # Email verification fields
    email_verified = Column(Boolean, nullable=False, default=False)
    last_verified_at = Column(DateTime(timezone=True), nullable=True)
    verification_pin_hash = Column(String(255), nullable=True)
    verification_expires_at = Column(DateTime(timezone=True), nullable=True)
    verification_attempts = Column(Integer, nullable=False, default=0)
    last_verification_sent_at = Column(DateTime(timezone=True), nullable=True)
    verification_required = Column(Boolean, nullable=False, default=True)

    # Relationships
    company = relationship("Company", backref="users")
    time_entries = relationship("TimeEntry", back_populates="employee", foreign_keys="TimeEntry.employee_id")
    leave_requests = relationship("LeaveRequest", back_populates="employee", foreign_keys="LeaveRequest.employee_id")

    __table_args__ = (
        UniqueConstraint("company_id", "email", name="uq_user_company_email"),
        Index("idx_users_company_status", "company_id", "status"),
    )

