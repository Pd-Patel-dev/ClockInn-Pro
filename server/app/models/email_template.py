import enum
import uuid
from sqlalchemy import (
    Column,
    String,
    Text,
    Boolean,
    Integer,
    DateTime,
    ForeignKey,
    Enum,
    Index,
    text,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class EmailTemplateCategory(str, enum.Enum):
    TRANSACTIONAL = "TRANSACTIONAL"
    NOTIFICATION = "NOTIFICATION"
    SUMMARY = "SUMMARY"
    MARKETING = "MARKETING"


class EmailTemplate(Base):
    __tablename__ = "email_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key = Column(String(100), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(
        Enum(EmailTemplateCategory, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=EmailTemplateCategory.TRANSACTIONAL,
    )
    variables_schema = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    is_system = Column(Boolean, nullable=False, default=False, server_default="false")
    is_enabled = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    updated_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    versions = relationship("EmailTemplateVersion", back_populates="template", cascade="all, delete-orphan")
    updated_by_user = relationship("User", foreign_keys=[updated_by])


class EmailTemplateVersion(Base):
    __tablename__ = "email_template_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id = Column(UUID(as_uuid=True), ForeignKey("email_templates.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False, default=1)
    subject = Column(String(500), nullable=False)
    body_html = Column(Text, nullable=False)
    body_text = Column(Text, nullable=False)
    from_name = Column(String(255), nullable=True)
    from_email = Column(String(255), nullable=True)
    reply_to = Column(String(255), nullable=True)
    is_published = Column(Boolean, nullable=False, default=False, server_default="false")
    is_draft = Column(Boolean, nullable=False, default=False, server_default="false")
    published_at = Column(DateTime(timezone=True), nullable=True)
    published_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    notes = Column(Text, nullable=True)

    template = relationship("EmailTemplate", back_populates="versions")
    published_by_user = relationship("User", foreign_keys=[published_by])

    __table_args__ = (
        Index(
            "uq_email_template_published",
            "template_id",
            unique=True,
            postgresql_where=text("is_published = true"),
        ),
        Index(
            "uq_email_template_draft",
            "template_id",
            unique=True,
            postgresql_where=text("is_draft = true"),
        ),
        Index("idx_email_template_versions_template_num", "template_id", "version_number"),
    )
