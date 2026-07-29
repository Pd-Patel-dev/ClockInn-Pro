from sqlalchemy import (
    Column,
    String,
    ForeignKey,
    Enum,
    DateTime,
    Boolean,
    Numeric,
    Integer,
    Index,
    CheckConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, validates
from sqlalchemy.sql import func
import uuid
import enum
from app.core.database import Base


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    MANAGER = "MANAGER"
    DEVELOPER = "DEVELOPER"
    # Hotel-specific roles
    MAINTENANCE = "MAINTENANCE"
    FRONTDESK = "FRONTDESK"
    HOUSEKEEPING = "HOUSEKEEPING"
    RESTAURANT = "RESTAURANT"
    SECURITY = "SECURITY"


class UserStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class PayRateType(str, enum.Enum):
    HOURLY = "HOURLY"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # NULL only for DEVELOPER (platform) accounts; required for all tenant roles
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True, index=True)
    role = Column(Enum(UserRole, values_callable=lambda x: [e.value for e in x]), nullable=False, default=UserRole.FRONTDESK)
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

    # Password reset OTP (forgot password flow)
    password_reset_otp_hash = Column(String(255), nullable=True)
    password_reset_otp_expires_at = Column(DateTime(timezone=True), nullable=True)
    password_reset_attempts = Column(Integer, nullable=False, default=0)
    last_password_reset_sent_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    company = relationship("Company", backref="users")
    time_entries = relationship("TimeEntry", back_populates="employee", foreign_keys="TimeEntry.employee_id")
    leave_requests = relationship("LeaveRequest", back_populates="employee", foreign_keys="LeaveRequest.employee_id")

    __table_args__ = (
        CheckConstraint(
            "(role = 'DEVELOPER' AND company_id IS NULL) OR (role <> 'DEVELOPER' AND company_id IS NOT NULL)",
            name="ck_user_company_by_role",
        ),
        Index("uq_user_email", text("LOWER(email)"), unique=True),
        Index("idx_users_company_status", "company_id", "status"),
    )

    @validates("company_id", "role")
    def validate_company_by_role(self, key, value):
        """Enforce: DEVELOPER <=> company_id IS NULL; all other roles require a company."""
        role = value if key == "role" else self.__dict__.get("role")
        company_id = value if key == "company_id" else self.__dict__.get("company_id")

        if role is None:
            return value

        role_val = role.value if isinstance(role, UserRole) else str(role)
        if role_val == UserRole.DEVELOPER.value:
            if company_id is not None:
                raise ValueError("DEVELOPER users must have company_id = NULL")
        else:
            # Only enforce when company_id is being set to None, or role is set while company_id is already None
            if key == "company_id" and company_id is None:
                raise ValueError("Non-DEVELOPER users must have a company_id")
            if key == "role" and "company_id" in self.__dict__ and company_id is None:
                raise ValueError("Non-DEVELOPER users must have a company_id")
        return value
