"""
Effective feature permissions: role defaults + per-employee grant/deny overrides.
"""
from __future__ import annotations

from typing import Iterable, List, Optional, Set
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, delete as sql_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import (
    FEATURE_PERMISSION_META,
    OVERRIDABLE_FEATURE_KEYS,
    role_feature_permissions,
)
from app.models.user import User, UserRole
from app.models.user_permission_override import UserPermissionOverride


async def list_overrides_for_user(
    db: AsyncSession,
    *,
    company_id: UUID,
    user_id: UUID,
) -> List[UserPermissionOverride]:
    result = await db.execute(
        select(UserPermissionOverride).where(
            and_(
                UserPermissionOverride.company_id == company_id,
                UserPermissionOverride.user_id == user_id,
            )
        )
    )
    return list(result.scalars().all())


async def get_effective_feature_permissions(
    db: AsyncSession,
    user: User,
) -> Set[str]:
    """
    Resolve feature keys for nav/API.
    Admin/Developer: full role catalog.
    Others: role defaults + grants − denies.
    """
    if user.role in (UserRole.ADMIN, UserRole.DEVELOPER):
        return role_feature_permissions(user.role)

    base = role_feature_permissions(user.role)
    if not user.company_id:
        return base

    overrides = await list_overrides_for_user(
        db, company_id=user.company_id, user_id=user.id
    )
    grants = {o.permission_key for o in overrides if o.effect == "grant"}
    denies = {o.permission_key for o in overrides if o.effect == "deny"}
    return (base | grants) - denies


async def user_has_feature_permission(
    db: AsyncSession,
    user: User,
    feature: str,
) -> bool:
    perms = await get_effective_feature_permissions(db, user)
    return feature in perms


def _validate_keys(keys: Iterable[str]) -> List[str]:
    out: List[str] = []
    for key in keys:
        k = (key or "").strip()
        if not k:
            continue
        if k not in OVERRIDABLE_FEATURE_KEYS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown permission key: {k}",
            )
        out.append(k)
    return out


async def get_employee_permission_view(
    db: AsyncSession,
    *,
    actor: User,
    employee: User,
) -> dict:
    """Payload for Admin/Manager employee permissions UI."""
    role_defaults = sorted(role_feature_permissions(employee.role))
    overrides = await list_overrides_for_user(
        db, company_id=employee.company_id, user_id=employee.id
    )
    grants = sorted({o.permission_key for o in overrides if o.effect == "grant"})
    denies = sorted({o.permission_key for o in overrides if o.effect == "deny"})
    effective = sorted(await get_effective_feature_permissions(db, employee))
    actor_perms = await get_effective_feature_permissions(db, actor)

    punch_role_allowed = True
    if employee.company_id:
        from app.models.company import Company
        from app.services.company_service import (
            get_company_settings,
            is_punch_allowed_for_role,
        )

        company = (
            await db.execute(select(Company).where(Company.id == employee.company_id))
        ).scalar_one_or_none()
        if company:
            punch_role_allowed = is_punch_allowed_for_role(
                get_company_settings(company), employee.role
            )

    catalog = []
    for key in sorted(OVERRIDABLE_FEATURE_KEYS):
        meta = FEATURE_PERMISSION_META[key]
        # Managers cannot grant settings; only Admin can.
        can_assign = key in actor_perms or actor.role == UserRole.ADMIN
        if key == "settings" and actor.role != UserRole.ADMIN:
            can_assign = False
        catalog.append(
            {
                "key": key,
                "label": meta["label"],
                "description": meta["description"],
                "role_default": key in role_feature_permissions(employee.role),
                "can_assign": can_assign,
            }
        )

    return {
        "user_id": str(employee.id),
        "role": employee.role.value if hasattr(employee.role, "value") else str(employee.role),
        "role_defaults": role_defaults,
        "grants": grants,
        "denies": denies,
        "effective": effective,
        "catalog": catalog,
        "locked": employee.role in (UserRole.ADMIN, UserRole.DEVELOPER),
        "punch_role_allowed": punch_role_allowed,
    }


async def replace_employee_permission_overrides(
    db: AsyncSession,
    *,
    actor: User,
    employee: User,
    grants: List[str],
    denies: List[str],
) -> dict:
    if employee.role in (UserRole.ADMIN, UserRole.DEVELOPER):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot override permissions for Admin or Developer accounts",
        )
    if employee.company_id != actor.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    if actor.role == UserRole.MANAGER and employee.role == UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Managers cannot modify Admin permissions",
        )

    grant_keys = _validate_keys(grants)
    deny_keys = _validate_keys(denies)
    overlap = set(grant_keys) & set(deny_keys)
    if overlap:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot both grant and deny the same permission: {', '.join(sorted(overlap))}",
        )

    actor_perms = await get_effective_feature_permissions(db, actor)
    for key in grant_keys + deny_keys:
        if key == "settings" and actor.role != UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only Admins can grant or deny company settings access",
            )
        if actor.role != UserRole.ADMIN and key not in actor_perms:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You cannot assign a permission you do not have: {key}",
            )

    await db.execute(
        sql_delete(UserPermissionOverride).where(
            and_(
                UserPermissionOverride.company_id == employee.company_id,
                UserPermissionOverride.user_id == employee.id,
            )
        )
    )

    for key in grant_keys:
        db.add(
            UserPermissionOverride(
                company_id=employee.company_id,
                user_id=employee.id,
                permission_key=key,
                effect="grant",
                created_by=actor.id,
            )
        )
    for key in deny_keys:
        db.add(
            UserPermissionOverride(
                company_id=employee.company_id,
                user_id=employee.id,
                permission_key=key,
                effect="deny",
                created_by=actor.id,
            )
        )

    await db.commit()
    return await get_employee_permission_view(db, actor=actor, employee=employee)
