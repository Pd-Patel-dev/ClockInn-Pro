import enum
import uuid

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class SupportTicketType(str, enum.Enum):
    SUPPORT = "support"
    FEEDBACK = "feedback"
    BUG = "bug"


class SupportTicketStatus(str, enum.Enum):
    OPEN = "open"
    RESOLVED = "resolved"


class SupportTicket(Base):
    """User-submitted contact support / feedback / bug reports for the developer portal."""

    __tablename__ = "support_tickets"
    __table_args__ = (
        Index("ix_support_tickets_status_created", "status", "created_at"),
        Index("ix_support_tickets_type_created", "type", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    company_id = Column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True
    )

    type = Column(String(32), nullable=False, default=SupportTicketType.SUPPORT.value, index=True)
    status = Column(String(20), nullable=False, default=SupportTicketStatus.OPEN.value, index=True)
    message = Column(Text, nullable=False)

    # Denormalized snapshot so tickets stay readable if the user/company changes
    user_name = Column(String(255), nullable=False)
    user_email = Column(String(255), nullable=False, index=True)
    user_role = Column(String(64), nullable=True)
    company_name = Column(String(255), nullable=True)

    page_path = Column(String(500), nullable=True)
    user_agent = Column(String(500), nullable=True)
    ip_address = Column(String(64), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
