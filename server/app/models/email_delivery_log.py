import enum
import uuid
from sqlalchemy import Column, String, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.core.database import Base


class EmailDeliveryStatus(str, enum.Enum):
    SENT = "sent"
    FAILED = "failed"
    SKIPPED = "skipped"


class EmailDeliveryLog(Base):
    """Append-only record of outbound email attempts."""

    __tablename__ = "email_delivery_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    to_email = Column(String(320), nullable=False, index=True)
    from_email = Column(String(320), nullable=True)
    subject = Column(String(500), nullable=True)
    template_key = Column(String(100), nullable=True, index=True)
    kind = Column(String(40), nullable=False, default="transactional", server_default="transactional")
    status = Column(String(20), nullable=False, index=True)
    provider_message_id = Column(String(255), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
