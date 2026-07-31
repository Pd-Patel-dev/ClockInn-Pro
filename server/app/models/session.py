from sqlalchemy import Column, String, ForeignKey, DateTime, Index, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from app.core.database import Base


class Session(Base):
    """
    Refresh-token sessions (product-spec "user_sessions").

    Each login/refresh rotation creates a row; revoke by setting revoked_at.
    """

    __tablename__ = "sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    # NULL for DEVELOPER (platform) sessions; required for tenant users
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True, index=True)
    refresh_token_hash = Column(String(255), nullable=False, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    user_agent = Column(String(500), nullable=True)
    ip = Column(String(45), nullable=True)
    device_label = Column(String(255), nullable=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", backref="sessions")

    __table_args__ = (
        Index("idx_sessions_user_company", "user_id", "company_id"),
    )


class UserAvatar(Base):
    """DB fallback for avatar binary when object storage is not configured."""

    __tablename__ = "user_avatars"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    data_url = Column(Text, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User", backref="avatar_row", uselist=False)
