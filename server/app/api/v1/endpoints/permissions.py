"""
API endpoints for permission and role management.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.core.database import get_db
from app.core.dependencies import get_current_admin, get_current_verified_user
from app.core.error_handling import handle_endpoint_errors
from app.models.user import User, UserRole
from app.schemas.permission import (
    PermissionResponse,
    PermissionCategoryResponse,
    RolePermissionUpdate,
    RolePermissionResponse,
    UserPermissionCheck,
    UserPermissionResponse,
)
from app.services.permission_service import (
    get_all_permissions,
    get_permissions_by_category,
    get_role_permissions,
    set_role_permissions,
    user_has_permission,
)

router = APIRouter()


@router.get("/permissions", response_model=List[PermissionResponse])
@handle_endpoint_errors(operation_name="get_all_permissions")
async def get_permissions(
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get all available permissions (admin only)."""
    permissions = await get_all_permissions(db)
    return permissions


@router.get("/permissions/by-category", response_model=List[PermissionCategoryResponse])
@handle_endpoint_errors(operation_name="get_permissions_by_category")
async def get_permissions_grouped(
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get all permissions grouped by category (admin only)."""
    grouped = await get_permissions_by_category(db)
    return [
        PermissionCategoryResponse(category=cat, permissions=perms)
        for cat, perms in grouped.items()
    ]


@router.get("/roles/{role}/permissions", response_model=RolePermissionResponse)
@handle_endpoint_errors(operation_name="get_role_permissions")
async def get_role_permissions_endpoint(
    role: str,
    company_specific: bool = False,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get permissions for a specific role (admin only)."""
    try:
        user_role = UserRole(role.upper())
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role: {role}",
        )
    
    company_id = current_user.company_id if company_specific else None
    permissions = await get_role_permissions(db, user_role, company_id)
    
    return RolePermissionResponse(
        role=role.upper(),
        permissions=permissions,
        is_company_specific=company_specific,
    )


@router.put("/roles/{role}/permissions", response_model=RolePermissionResponse)
@handle_endpoint_errors(operation_name="set_role_permissions")
async def set_role_permissions_endpoint(
    role: str,
    data: RolePermissionUpdate,
    company_specific: bool = False,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Set permissions for a specific role (admin only)."""
    try:
        user_role = UserRole(role.upper())
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role: {role}",
        )
    
    company_id = current_user.company_id if company_specific else None
    await set_role_permissions(db, user_role, data.permission_ids, company_id)
    
    # Return updated permissions
    permissions = await get_role_permissions(db, user_role, company_id)
    
    return RolePermissionResponse(
        role=role.upper(),
        permissions=permissions,
        is_company_specific=company_specific,
    )


@router.post("/check-permission", response_model=UserPermissionResponse)
@handle_endpoint_errors(operation_name="check_user_permission")
async def check_user_permission(
    data: UserPermissionCheck,
    current_user: User = Depends(get_current_verified_user),
    db: AsyncSession = Depends(get_db),
):
    """Check if the current user has a specific permission."""
    has_perm = await user_has_permission(db, current_user, data.permission_name)
    
    return UserPermissionResponse(
        has_permission=has_perm,
        role=current_user.role.value,
        permission_name=data.permission_name,
    )
