"""
Schemas for permissions and role-permission management.
"""
import re

from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Any
from uuid import UUID
from datetime import datetime


def _fix_postgres_tz_offset_string(s: str) -> str:
    """
    AsyncPG / PostgreSQL sometimes expose timestamptz as strings ending in +00 or +05
    instead of +00:00. Pydantic's datetime parser rejects the short form.
    """
    s = s.strip()
    if re.search(r"[+-]\d{2}:\d{2}$", s):
        return s
    if re.search(r"[+-]\d{2}$", s):
        return re.sub(r"([+-]\d{2})$", r"\1:00", s)
    return s


class PermissionResponse(BaseModel):
    """Permission response schema."""
    id: UUID
    name: str
    display_name: str
    description: Optional[str] = None
    category: str
    created_at: datetime

    @field_validator("created_at", mode="before")
    @classmethod
    def coerce_created_at(cls, v: Any) -> Any:
        if isinstance(v, str):
            return _fix_postgres_tz_offset_string(v)
        return v

    class Config:
        from_attributes = True


class PermissionCategoryResponse(BaseModel):
    """Permissions grouped by category."""
    category: str
    permissions: List[PermissionResponse]


class RolePermissionUpdate(BaseModel):
    """Schema for updating role permissions."""
    permission_ids: List[UUID] = Field(..., description="List of permission IDs to assign to the role")


class RolePermissionResponse(BaseModel):
    """Response schema for role permissions."""
    role: str
    permissions: List[PermissionResponse]
    is_company_specific: bool = Field(False, description="Whether these are company-specific permissions")


class UserPermissionCheck(BaseModel):
    """Schema for checking user permissions."""
    permission_name: str = Field(..., description="Name of the permission to check")


class UserPermissionResponse(BaseModel):
    """Response for user permission check."""
    has_permission: bool
    role: str
    permission_name: str
