"""Per-employee feature permission overrides (grant/deny on top of role defaults)."""
from sqlalchemy import Column, String, ForeignKey, DateTime, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from app.core.database import Base


class UserPermissionOverride(Base):
    """Grant or deny a feature key for one employee, overriding their role defaults."""

    __tablename__ = "user_permission_overrides"
    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "user_id",
            "permission_key",
            name="uq_user_permission_overrides_company_user_key",
        ),
        Index("ix_user_permission_overrides_user_id", "user_id"),
        Index("ix_user_permission_overrides_company_id", "company_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    permission_key = Column(String(64), nullable=False)
    # "grant" | "deny"
    effect = Column(String(16), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user = relationship("User", foreign_keys=[user_id])
    creator = relationship("User", foreign_keys=[created_by])
