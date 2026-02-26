"""
Service for managing permissions and role-permission relationships.
"""
from typing import List, Dict, Optional
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import selectinload

from app.models.permission import Permission, RolePermission, PermissionCategory, DEFAULT_COMPANY_ID
from app.models.user import UserRole


async def get_all_permissions(
    db: AsyncSession,
) -> List[Permission]:
    """Get all available permissions."""
    result = await db.execute(select(Permission).order_by(Permission.category, Permission.name))
    return list(result.scalars().all())


async def get_permissions_by_category(
    db: AsyncSession,
) -> Dict[str, List[Permission]]:
    """Get all permissions grouped by category."""
    permissions = await get_all_permissions(db)
    grouped = {}
    for perm in permissions:
        if perm.category not in grouped:
            grouped[perm.category] = []
        grouped[perm.category].append(perm)
    return grouped


async def get_role_permissions(
    db: AsyncSession,
    role: UserRole,
    company_id: Optional[UUID] = None,
) -> List[Permission]:
    """
    Get permissions for a specific role.
    If company_id is provided, returns company-specific permissions merged with defaults.
    Otherwise, returns default role permissions.
    ADMIN role always gets all permissions.
    """
    # ADMIN role always gets all permissions
    if role == UserRole.ADMIN:
        return await get_all_permissions(db)
    
    query = select(RolePermission).where(RolePermission.role == role.value)
    
    if company_id:
        # Get company-specific permissions or default permissions
        query = query.where(
            or_(
                RolePermission.company_id == company_id,
                RolePermission.company_id == DEFAULT_COMPANY_ID
            )
        )
    else:
        # Only default permissions
        query = query.where(RolePermission.company_id == DEFAULT_COMPANY_ID)
    
    result = await db.execute(query.options(selectinload(RolePermission.permission)))
    role_perms = result.scalars().all()
    
    # Extract permissions, prioritizing company-specific over defaults
    permissions_dict = {}
    for rp in role_perms:
        perm_id = str(rp.permission_id)
        if rp.company_id != DEFAULT_COMPANY_ID:
            # Company-specific permission takes precedence
            permissions_dict[perm_id] = rp.permission
        elif perm_id not in permissions_dict:
            # Default permission (only if no company-specific exists)
            permissions_dict[perm_id] = rp.permission
    
    return list(permissions_dict.values())


async def user_has_permission(
    db: AsyncSession,
    user: "User",
    permission_name: str,
) -> bool:
    """
    Check if a user has a specific permission.
    Checks both role-based permissions and ADMIN role (which has all permissions).
    """
    # ADMIN role has all permissions
    if user.role == UserRole.ADMIN:
        return True
    
    # Check role permissions
    role_permissions = await get_role_permissions(db, user.role, user.company_id)
    permission_names = {perm.name for perm in role_permissions}
    
    return permission_name in permission_names


async def set_role_permissions(
    db: AsyncSession,
    role: UserRole,
    permission_ids: List[UUID],
    company_id: Optional[UUID] = None,
) -> List[RolePermission]:
    """
    Set permissions for a role.
    If company_id is provided, creates company-specific permissions.
    Otherwise, sets default role permissions (using DEFAULT_COMPANY_ID).
    """
    # Use DEFAULT_COMPANY_ID if no company_id provided
    # Ensure it's always a UUID object, never None
    if company_id is None:
        effective_company_id = DEFAULT_COMPANY_ID
    else:
        # Ensure it's a UUID object
        effective_company_id = UUID(str(company_id)) if not isinstance(company_id, UUID) else company_id
    
    # Delete existing permissions for this role (and company if specified)
    delete_query = select(RolePermission).where(
        and_(
            RolePermission.role == role.value,
            RolePermission.company_id == effective_company_id
        )
    )
    
    result = await db.execute(delete_query)
    existing = result.scalars().all()
    for rp in existing:
        await db.delete(rp)
    
    # Create new role-permission relationships
    new_role_permissions = []
    for perm_id in permission_ids:
        # Ensure all values are proper types
        perm_uuid = UUID(str(perm_id)) if not isinstance(perm_id, UUID) else perm_id
        company_uuid = UUID(str(effective_company_id)) if not isinstance(effective_company_id, UUID) else effective_company_id
        
        # Create RolePermission with explicit company_id (required for primary key)
        rp = RolePermission(
            role=role.value,
            permission_id=perm_uuid,
            company_id=company_uuid,  # Must be set - part of primary key
        )
        db.add(rp)
        new_role_permissions.append(rp)
    
    await db.commit()
    
    # Refresh to get the permission relationships
    for rp in new_role_permissions:
        await db.refresh(rp, ["permission"])
    
    return new_role_permissions


async def get_permission_by_name(
    db: AsyncSession,
    name: str,
) -> Optional[Permission]:
    """Get a permission by its name."""
    result = await db.execute(select(Permission).where(Permission.name == name))
    return result.scalar_one_or_none()
