"""
Schemas for permissions and role-permission management.
"""
from pydantic import BaseModel, Field
from typing import List, Optional
from uuid import UUID
from datetime import datetime

from app.models.user import UserRole


class PermissionResponse(BaseModel):
    """Permission response schema."""
    id: UUID
    name: str
    display_name: str
    description: Optional[str] = None
    category: str
    created_at: datetime

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
