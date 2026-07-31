"""Pydantic schemas for email template management."""
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.models.email_template import EmailTemplateCategory


class DraftPayload(BaseModel):
    subject: str
    body_html: str
    body_text: str
    from_name: Optional[str] = None
    from_email: Optional[str] = None
    reply_to: Optional[str] = None
    notes: Optional[str] = None


class PublishPayload(BaseModel):
    notes: Optional[str] = None


class TemplateMetadataPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    category: Optional[EmailTemplateCategory] = None
    is_enabled: Optional[bool] = None


class PreviewRequest(BaseModel):
    version: str = "published"  # draft | published | version uuid
    variables: Optional[Dict[str, Any]] = None
    format: Literal["html", "text", "both"] = "both"


class PreviewResponse(BaseModel):
    subject: str
    body_html: Optional[str] = None
    body_text: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)


class SendTestRequest(BaseModel):
    to_email: EmailStr
    version: Literal["draft", "published"] = "draft"
    variables: Optional[Dict[str, Any]] = None


class SendTestResponse(BaseModel):
    status: str
    subject: Optional[str] = None
    message: Optional[str] = None


class VersionContentOut(BaseModel):
    id: UUID
    template_id: Optional[UUID] = None
    version_number: int
    subject: str
    body_html: str
    body_text: str
    from_name: Optional[str] = None
    from_email: Optional[str] = None
    reply_to: Optional[str] = None
    is_published: bool
    is_draft: bool
    published_at: Optional[datetime] = None
    published_by: Optional[UUID] = None
    published_by_name: Optional[str] = None
    created_at: Optional[datetime] = None
    notes: Optional[str] = None

    class Config:
        from_attributes = True


class VersionSummaryOut(BaseModel):
    id: UUID
    version_number: int
    is_published: bool
    is_draft: bool
    published_at: Optional[datetime] = None
    published_by: Optional[UUID] = None
    published_by_name: Optional[str] = None
    created_at: Optional[datetime] = None
    notes: Optional[str] = None
    subject: Optional[str] = None

    class Config:
        from_attributes = True


class PaginatedVersionsOut(BaseModel):
    items: List[VersionSummaryOut]
    total: int
    page: int
    page_size: int


class TemplateListItemOut(BaseModel):
    id: UUID
    key: str
    name: str
    description: Optional[str] = None
    category: EmailTemplateCategory
    is_enabled: bool
    is_system: bool
    has_draft: bool = False
    subject: Optional[str] = None
    last_updated_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    updated_by_name: Optional[str] = None


class TemplateDetailOut(BaseModel):
    id: UUID
    key: str
    name: str
    description: Optional[str] = None
    category: EmailTemplateCategory
    is_enabled: bool
    is_system: bool
    variables_schema: Dict[str, Any] = Field(default_factory=dict)
    published_version: Optional[VersionContentOut] = None
    draft_version: Optional[VersionContentOut] = None
    has_draft: bool = False
    last_updated_at: Optional[datetime] = None
    updated_by_name: Optional[str] = None
