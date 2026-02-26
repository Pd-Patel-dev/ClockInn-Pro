"""
Permission and Role Permission models for fine-grained access control.
"""
from sqlalchemy import Column, String, ForeignKey, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum
from app.core.database import Base


class PermissionCategory(str, enum.Enum):
    """Categories for organizing permissions."""
    TIME_ENTRIES = "TIME_ENTRIES"
    EMPLOYEES = "EMPLOYEES"
    SCHEDULES = "SCHEDULES"
    PAYROLL = "PAYROLL"
    REPORTS = "REPORTS"
    SETTINGS = "SETTINGS"
    LEAVE_REQUESTS = "LEAVE_REQUESTS"
    CASH_DRAWER = "CASH_DRAWER"
    ADMIN = "ADMIN"


class Permission(Base):
    """Permission model for fine-grained access control."""
    __tablename__ = "permissions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False, unique=True)  # e.g., "time_entries.view"
    display_name = Column(String(255), nullable=False)  # e.g., "View Time Entries"
    description = Column(Text, nullable=True)
    category = Column(String(50), nullable=False)  # PermissionCategory as string
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    role_permissions = relationship("RolePermission", back_populates="permission", cascade="all, delete-orphan")


# Special UUID for default/global permissions (all zeros)
DEFAULT_COMPANY_ID = uuid.UUID('00000000-0000-0000-0000-000000000000')


class RolePermission(Base):
    """Junction model for role-permission relationships with company-specific overrides."""
    __tablename__ = "role_permissions"

    role = Column(String(50), primary_key=True)  # UserRole enum value
    permission_id = Column(UUID(as_uuid=True), ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, primary_key=True)
    # company_id uses DEFAULT_COMPANY_ID (all zeros) for default role permissions
    # If company_id is DEFAULT_COMPANY_ID, it's a default permission for that role
    # If company_id is a real company UUID, it's a custom permission override for that company
    
    # Relationships
    permission = relationship("Permission", back_populates="role_permissions")
