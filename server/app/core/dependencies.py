from typing import Optional
import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from jose import JWTError

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User, UserRole, UserStatus
from app.core.config import settings
from app.core.permissions import has_permission

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Get current authenticated user from JWT token."""
    token = credentials.credentials
    
    # Validate token format before decoding
    if not token or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials: token is empty",
        )
    
    payload = decode_token(token)
    
    if payload is None or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )
    
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    try:
        user_uuid = uuid.UUID(str(user_id))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    from sqlalchemy import select
    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()
    
    if user is None or user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    
    # Check and update verification status (respects company email_verification_required)
    from app.services.verification_service import check_verification_required_for_user
    if await check_verification_required_for_user(db, user):
        user.verification_required = True
        db.add(user)
        await db.flush()
    
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Ensure user is active."""
    if current_user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is inactive",
        )
    return current_user


async def get_current_verified_user(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Ensure user's email is verified (unless company has email_verification_required=False)."""
    from app.services.verification_service import check_verification_required_for_user
    
    # If company does not require email verification, allow through
    if not await check_verification_required_for_user(db, current_user):
        return current_user
    # Update database and block
    current_user.verification_required = True
    db.add(current_user)
    await db.flush()
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "error": "EMAIL_VERIFICATION_REQUIRED",
            "message": "Please verify your email to continue.",
            "email": current_user.email,
        }
    )


def require_role(allowed_roles: list[UserRole]):
    """Dependency factory for role-based access control."""
    async def role_checker(
        current_user: User = Depends(get_current_active_user),
    ) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user
    return role_checker


async def get_current_admin(
    current_user: User = Depends(get_current_verified_user),
) -> User:
    """Require ADMIN role and verified email."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


async def get_current_developer(
    current_user: User = Depends(get_current_verified_user),
) -> User:
    """Require DEVELOPER role and verified email."""
    if current_user.role != UserRole.DEVELOPER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Developer access required",
        )
    return current_user


def require_permission(permission_name: str):
    """
    Dependency factory for permission-based access control.
    Supports:
    - legacy permission keys (contains ':') via DB permission service
    - feature keys (e.g. 'payroll') via ROLE_PERMISSIONS
    """
    async def permission_checker(
        current_user: User = Depends(get_current_verified_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        if ":" in permission_name:
            from app.services.permission_service import user_has_permission

            has_perm = await user_has_permission(db, current_user, permission_name)
            if not has_perm:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Permission required: {permission_name}",
                )
        elif not has_permission(current_user.role, permission_name):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Your role does not have access to: {permission_name}",
            )
        return current_user
    return permission_checker

