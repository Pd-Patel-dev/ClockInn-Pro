from typing import Optional, List
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, delete as sql_delete
from app.schemas.user import UserResponse
from fastapi import HTTPException, status

from app.core.error_handling import client_error_detail
import logging

from app.models.user import User, UserRole, UserStatus
from app.models.audit_log import AuditLog
from app.core.query_builder import get_paginated_results, build_company_filtered_query
from app.core.security import (
    get_password_hash,
    get_pin_hash,
    normalize_email,
    validate_password_strength,
    generate_temp_password,
)
from app.schemas.user import UserCreate, UserUpdate, DeveloperUserUpdate, TenantUserCreate
from app.models.company import Company
import uuid

logger = logging.getLogger(__name__)


async def get_user_by_id(
    db: AsyncSession,
    user_id: UUID,
    company_id: UUID,
) -> Optional[User]:
    """Get user by ID scoped to company."""
    result = await db.execute(
        select(User).where(
            and_(User.id == user_id, User.company_id == company_id)
        )
    )
    return result.scalar_one_or_none()


async def get_user_by_id_any(
    db: AsyncSession,
    user_id: UUID,
) -> Optional[User]:
    """Get any user by ID (no company scope). For developer use only."""
    from sqlalchemy.orm import selectinload
    from app.models.company import Company
    result = await db.execute(
        select(User)
        .options(selectinload(User.company))
        .where(User.id == user_id)
    )
    return result.scalar_one_or_none()


async def get_user_me(
    db: AsyncSession,
    user_id: UUID,
) -> Optional[User]:
    """Get current user with company info."""
    from sqlalchemy.orm import selectinload
    from app.models.company import Company
    
    result = await db.execute(
        select(User)
        .options(selectinload(User.company))
        .where(User.id == user_id)
    )
    return result.scalar_one_or_none()


async def list_employees(
    db: AsyncSession,
    company_id: UUID,
    skip: int = 0,
    limit: int = 100,
) -> tuple[List[User], int]:
    """List employees for a company (all non-developer users)."""
    # List all users except DEVELOPER role
    query = select(User).where(
        and_(
            User.company_id == company_id,
            User.role.notin_([UserRole.DEVELOPER])
        )
    )
    
    return await get_paginated_results(db, query, skip=skip, limit=limit)


async def list_employee_user_responses(
    db: AsyncSession,
    company_id: UUID,
    skip: int = 0,
    limit: int = 1000,
) -> List[UserResponse]:
    """List employees as ``UserResponse`` with last punch and clocked-in status (same as GET /users/admin/employees)."""
    from app.models.time_entry import TimeEntry

    employees, _total = await list_employees(db, company_id, skip, limit)

    employee_ids = [emp.id for emp in employees]
    last_punches: dict = {}
    clock_status = {emp_id: False for emp_id in employee_ids}

    if employee_ids:
        open_entries_result = await db.execute(
            select(TimeEntry).where(
                TimeEntry.employee_id.in_(employee_ids),
                TimeEntry.company_id == company_id,
                TimeEntry.clock_out_at.is_(None),
            )
        )
        for entry in open_entries_result.scalars().all():
            clock_status[entry.employee_id] = True

        result = await db.execute(
            select(TimeEntry)
            .where(
                TimeEntry.employee_id.in_(employee_ids),
                TimeEntry.company_id == company_id,
            )
            .order_by(TimeEntry.employee_id, TimeEntry.clock_in_at.desc())
        )
        entries = result.scalars().all()
        seen_employees = set()
        for entry in entries:
            if entry.employee_id not in seen_employees:
                last_punches[entry.employee_id] = (
                    entry.clock_out_at if entry.clock_out_at else entry.clock_in_at
                )
                seen_employees.add(entry.employee_id)

    return [
        UserResponse(
            id=emp.id,
            company_id=emp.company_id,
            name=emp.name,
            email=emp.email,
            role=emp.role,
            status=emp.status,
            has_pin=emp.pin_hash is not None,
            pay_rate=float(emp.pay_rate) if emp.pay_rate is not None else None,
            created_at=emp.created_at,
            last_login_at=emp.last_login_at,
            last_punch_at=last_punches.get(emp.id),
            is_clocked_in=clock_status.get(emp.id, False),
        )
        for emp in employees
    ]


async def create_employee(
    db: AsyncSession,
    company_id: UUID,
    data: UserCreate,
) -> User:
    """Create a new employee."""
    import secrets
    from app.core.security import create_password_setup_token
    from app.services.email_service import email_service
    from app.core.config import settings
    
    # If password is provided, validate it (for backward compatibility)
    if data.password:
        is_valid, error_msg = validate_password_strength(data.password)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg,
            )
        password_hash = get_password_hash(data.password)
    else:
        # Generate a secure random password that will be replaced when user sets their password
        # This ensures password_hash is not null in the database
        temp_password = secrets.token_urlsafe(32)
        password_hash = get_password_hash(temp_password)
    
    normalized_email = normalize_email(data.email)
    
    # Emails are globally unique across the platform
    result = await db.execute(
        select(User).where(User.email == normalized_email)
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already in use on the platform.",
        )
    
    # Check if PIN is unique within the company (if PIN is provided)
    # PINs are used by non-admin roles (MAINTENANCE, FRONTDESK, HOUSEKEEPING)
    if data.pin:
        pin_hash = get_pin_hash(data.pin)
        result = await db.execute(
            select(User).where(
                and_(
                    User.company_id == company_id,
                    User.pin_hash == pin_hash,
                    User.role.in_([
                        UserRole.MAINTENANCE,
                        UserRole.FRONTDESK,
                        UserRole.HOUSEKEEPING,
                    ]),
                )
            )
        )
        existing_pin_user = result.scalar_one_or_none()
        if existing_pin_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This PIN is already in use by another user in your company. Please choose a different PIN.",
            )
    else:
        pin_hash = None
    
    # Create user
    # Use the role from data, defaulting to FRONTDESK if not provided
    user_role = data.role if data.role else UserRole.FRONTDESK
    
    user = User(
        id=uuid.uuid4(),
        company_id=company_id,
        role=user_role,
        name=data.name,
        email=normalized_email,
        password_hash=password_hash,
        pin_hash=pin_hash,
        status=UserStatus.ACTIVE,
        pay_rate=data.pay_rate,
    )
    
    try:
        db.add(user)
        await db.commit()
        await db.refresh(user)
        
        # If password was not provided, send password setup email
        if not data.password:
            try:
                from app.core.security import hash_password_setup_jti
                setup_token, jti, expires_at = create_password_setup_token(
                    str(user.id), normalized_email, hours=48
                )
                user.password_setup_token_hash = hash_password_setup_jti(jti)
                user.password_setup_expires_at = expires_at
                await db.commit()
                await db.refresh(user)
                setup_link = f"{settings.FRONTEND_URL}/set-password?token={setup_token}"
                email_sent = await email_service.send_password_setup_email(
                    normalized_email,
                    data.name,
                    setup_link
                )
                if not email_sent:
                    logger.warning(f"Failed to send password setup email to {normalized_email}, but employee was created")
            except Exception as e:
                logger.error(f"Failed to send password setup email: {e}")
                # Don't fail employee creation if email fails
        
        return user
    except Exception as e:
        await db.rollback()
        # Check if it's a unique constraint violation for PIN or email
        error_str = str(e).lower()
        if "uq_user_email" in error_str or ("email" in error_str and "unique" in error_str):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already in use on the platform.",
            )
        if 'pin_hash' in error_str or 'ix_users_company_pin_hash_unique' in error_str:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This PIN is already in use by another employee in your company. Please choose a different PIN.",
            )
        logger.error("Failed to create employee: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=client_error_detail(
                dev_detail=f"Failed to create employee: {str(e)}",
                prod_detail="Failed to create employee. Please try again.",
            ),
        )


async def create_tenant_user_as_developer(
    db: AsyncSession,
    company_id: UUID,
    data: TenantUserCreate,
    actor_user_id: UUID,
) -> tuple[User, Optional[str], bool]:
    """
    Create a tenant user in any company (developer portal).

    When password is omitted, issues a set-password email (template `password_setup`)
    instead of returning a temp password.

    Returns (user, temp_password_or_none, password_setup_email_sent).
    """
    import secrets
    from app.core.config import settings
    from app.core.security import create_password_setup_token, hash_password_setup_jti
    from app.services.email_service import email_service

    if data.role == UserRole.DEVELOPER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use POST /api/v1/developer/accounts to create developers.",
        )

    company_result = await db.execute(select(Company).where(Company.id == company_id))
    company = company_result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found.")

    send_setup_email = not bool(data.password)
    temp_password: Optional[str] = None
    if data.password:
        is_valid, error_msg = validate_password_strength(data.password)
        if not is_valid:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)
        password_hash = get_password_hash(data.password)
    else:
        # Unusable random hash; user must set password via emailed link
        password_hash = get_password_hash(secrets.token_urlsafe(32))

    normalized_email = normalize_email(data.email)
    existing = await db.execute(select(User).where(User.email == normalized_email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already in use on the platform.",
        )

    pin_hash = None
    if data.pin:
        pin_hash = get_pin_hash(data.pin)
        pin_check = await db.execute(
            select(User).where(
                and_(
                    User.company_id == company_id,
                    User.pin_hash == pin_hash,
                    User.role.in_([
                        UserRole.MAINTENANCE,
                        UserRole.FRONTDESK,
                        UserRole.HOUSEKEEPING,
                        UserRole.RESTAURANT,
                        UserRole.SECURITY,
                    ]),
                )
            )
        )
        if pin_check.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This PIN is already in use by another user in this company. Please choose a different PIN.",
            )

    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)

    email_verified = bool(data.email_verified)
    user = User(
        id=uuid.uuid4(),
        company_id=company_id,
        role=data.role,
        name=data.name.strip(),
        email=normalized_email,
        password_hash=password_hash,
        pin_hash=pin_hash,
        status=UserStatus.ACTIVE,
        pay_rate=float(data.pay_rate) if data.pay_rate is not None else None,
        email_verified=email_verified,
        verification_required=not email_verified,
        last_verified_at=now if email_verified else None,
    )

    setup_email_sent = False
    try:
        db.add(user)
        db.add(
            AuditLog(
                id=uuid.uuid4(),
                company_id=company_id,
                actor_user_id=actor_user_id,
                action="TENANT_USER_CREATED_BY_DEVELOPER",
                entity_type="user",
                entity_id=user.id,
                metadata_json={
                    "email": normalized_email,
                    "role": data.role.value,
                    "password_setup_email": send_setup_email,
                },
            )
        )
        await db.commit()
        await db.refresh(user)

        if send_setup_email:
            try:
                setup_token, jti, expires_at = create_password_setup_token(
                    str(user.id), normalized_email, hours=48
                )
                user.password_setup_token_hash = hash_password_setup_jti(jti)
                user.password_setup_expires_at = expires_at
                await db.commit()
                await db.refresh(user)
                setup_link = f"{settings.FRONTEND_URL}/set-password?token={setup_token}"
                setup_email_sent = await email_service.send_password_setup_email(
                    normalized_email,
                    user.name,
                    setup_link,
                )
                if not setup_email_sent:
                    logger.warning(
                        "Tenant user %s created but password setup email failed for %s",
                        user.id,
                        normalized_email,
                    )
            except Exception as e:
                logger.error(
                    "Failed to send password setup email for tenant user %s: %s",
                    normalized_email,
                    e,
                    exc_info=True,
                )

        logger.info(
            "Developer created tenant user %s (%s) in company %s (setup_email_sent=%s)",
            user.id,
            normalized_email,
            company_id,
            setup_email_sent,
        )
        return user, temp_password, setup_email_sent
    except Exception as e:
        await db.rollback()
        error_str = str(e).lower()
        if "uq_user_email" in error_str or ("email" in error_str and "unique" in error_str):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already in use on the platform.",
            )
        if "pin_hash" in error_str or "ix_users_company_pin_hash_unique" in error_str:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This PIN is already in use by another user in this company. Please choose a different PIN.",
            )
        logger.error("Failed to create tenant user as developer: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=client_error_detail(
                dev_detail=f"Failed to create user: {str(e)}",
                prod_detail="Failed to create user. Please try again.",
            ),
        )


async def update_employee(
    db: AsyncSession,
    employee_id: UUID,
    company_id: UUID,
    data: UserUpdate,
    actor_user_id: Optional[UUID] = None,
) -> User:
    """Update employee."""
    user = await get_user_by_id(db, employee_id, company_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Employee with ID {employee_id} not found in your company",
        )
    
    # Don't allow updating DEVELOPER role through this endpoint
    if user.role == UserRole.DEVELOPER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Developer accounts cannot be updated through this endpoint.",
        )
    
    # Track changes for audit logging
    old_status = user.status
    had_pin = user.pin_hash is not None
    old_role = user.role
    
    if data.name is not None:
        user.name = data.name
    if data.status is not None:
        # Ensure status is set correctly using enum value
        user.status = UserStatus(data.status.value) if isinstance(data.status, UserStatus) else data.status
    if data.role is not None:
        # Don't allow changing to DEVELOPER role
        if data.role == UserRole.DEVELOPER:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot assign DEVELOPER role through this endpoint.",
            )
        user.role = data.role
    if data.pin is not None:
        if data.pin == "":
            user.pin_hash = None
        else:
            # Check if PIN is unique within the company (excluding current employee)
            # PINs are used by non-admin roles (MAINTENANCE, FRONTDESK, HOUSEKEEPING)
            new_pin_hash = get_pin_hash(data.pin)
            result = await db.execute(
                select(User).where(
                    and_(
                        User.company_id == company_id,
                        User.pin_hash == new_pin_hash,
                        User.id != employee_id,  # Exclude current employee
                        User.role.in_([
                            UserRole.MAINTENANCE,
                            UserRole.FRONTDESK,
                            UserRole.HOUSEKEEPING,
                        ]),
                    )
                )
            )
            existing_pin_user = result.scalar_one_or_none()
            if existing_pin_user:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This PIN is already in use by another employee in your company. Please choose a different PIN.",
                )
            user.pin_hash = new_pin_hash
    if data.pay_rate is not None:
        user.pay_rate = data.pay_rate
    
    try:
        # Log status changes
        if data.status is not None and old_status != user.status and actor_user_id:
            audit_log = AuditLog(
                id=uuid.uuid4(),
                company_id=company_id,
                actor_user_id=actor_user_id,
                action="employee_status_changed",
                entity_type="user",
                entity_id=employee_id,
                metadata_json={
                    "old_status": old_status.value,
                    "new_status": user.status.value,
                    "employee_email": user.email,
                    "employee_name": user.name,
                },
            )
            db.add(audit_log)
        
        # Log PIN changes
        if data.pin is not None and actor_user_id:
            pin_changed = False
            if data.pin == "" and had_pin:
                # PIN was cleared
                pin_changed = True
                action_type = "pin_cleared"
            elif data.pin != "" and not had_pin:
                # PIN was set
                pin_changed = True
                action_type = "pin_set"
            elif data.pin != "" and had_pin:
                # PIN was changed
                pin_changed = True
                action_type = "pin_changed"
            
            if pin_changed:
                audit_log = AuditLog(
                    id=uuid.uuid4(),
                    company_id=company_id,
                    actor_user_id=actor_user_id,
                    action=action_type,
                    entity_type="user",
                    entity_id=employee_id,
                    metadata_json={
                        "employee_email": user.email,
                        "employee_name": user.name,
                    },
                )
                db.add(audit_log)
        
        await db.commit()
        await db.refresh(user)
        return user
    except Exception as e:
        await db.rollback()
        # Check if it's a unique constraint violation for PIN
        error_str = str(e).lower()
        if 'pin_hash' in error_str or 'ix_users_company_pin_hash_unique' in error_str or 'unique constraint' in error_str:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This PIN is already in use by another employee in your company. Please choose a different PIN.",
            )
        logger.error("Failed to update employee: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=client_error_detail(
                dev_detail=f"Failed to update employee: {str(e)}",
                prod_detail="Failed to update employee. Please try again.",
            ),
        )


async def update_user_developer(
    db: AsyncSession,
    user_id: UUID,
    data: DeveloperUserUpdate,
    actor_user_id: Optional[UUID] = None,
) -> User:
    """Update any user by ID (developer only). Supports verification and all fields."""
    user = await get_user_by_id_any(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    company_id = user.company_id

    if data.name is not None:
        user.name = data.name
    if data.email is not None:
        normalized = normalize_email(data.email)
        if normalized != user.email:
            result = await db.execute(
                select(User).where(
                    and_(
                        User.email == normalized,
                        User.id != user_id,
                    )
                )
            )
            if result.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Email already in use on the platform.",
                )
            user.email = normalized
    if data.role is not None:
        if user.role == UserRole.DEVELOPER and data.role != UserRole.DEVELOPER:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot convert a developer account to a tenant user via this endpoint.",
            )
        if data.role == UserRole.DEVELOPER:
            # Platform developers must not belong to a company
            user.company_id = None
        user.role = data.role
    if data.status is not None:
        user.status = UserStatus(data.status.value) if isinstance(data.status, UserStatus) else data.status
    if data.email_verified is not None:
        user.email_verified = data.email_verified
        if data.email_verified:
            user.verification_required = False
    if data.verification_required is not None:
        user.verification_required = data.verification_required
    if data.pin is not None:
        if data.pin == "":
            user.pin_hash = None
        else:
            if company_id is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="PIN is only valid for tenant users",
                )
            new_pin_hash = get_pin_hash(data.pin)
            result = await db.execute(
                select(User).where(
                    and_(
                        User.company_id == company_id,
                        User.pin_hash == new_pin_hash,
                        User.id != user_id,
                        User.role.in_(
                            [
                                UserRole.MAINTENANCE,
                                UserRole.FRONTDESK,
                                UserRole.HOUSEKEEPING,
                                UserRole.RESTAURANT,
                                UserRole.SECURITY,
                                UserRole.MANAGER,
                            ]
                        ),
                    )
                )
            )
            if result.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="PIN already in use in this company",
                )
            user.pin_hash = new_pin_hash
    if data.pay_rate is not None:
        user.pay_rate = data.pay_rate

    try:
        await db.commit()
        await db.refresh(user)
        return user
    except Exception as e:
        await db.rollback()
        error_str = str(e).lower()
        if "uq_user_email" in error_str or ("email" in error_str and "unique" in error_str):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already in use on the platform.",
            )
        if "pin_hash" in error_str or "unique" in error_str:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="PIN or email already in use",
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user",
        )


async def send_password_reset_link_as_developer(
    db: AsyncSession,
    user_id: UUID,
    actor_user_id: UUID,
) -> dict:
    """
    Issue a password-reset link email (template `password_reset`).
    Login is blocked until the link is used.
    """
    from app.core.config import settings
    from app.core.security import create_password_setup_token, hash_password_setup_jti
    from app.services.email_service import email_service
    from datetime import datetime, timezone

    user = await get_user_by_id_any(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot send password reset to an inactive user.",
        )

    setup_token, jti, expires_at = create_password_setup_token(
        str(user.id), user.email, hours=48
    )
    user.password_setup_token_hash = hash_password_setup_jti(jti)
    user.password_setup_expires_at = expires_at

    if user.company_id is not None:
        db.add(
            AuditLog(
                id=uuid.uuid4(),
                company_id=user.company_id,
                actor_user_id=actor_user_id,
                action="PASSWORD_RESET_LINK_SENT_BY_DEVELOPER",
                entity_type="user",
                entity_id=user.id,
                metadata_json={"email": user.email, "template": "password_reset"},
            )
        )
    await db.commit()
    await db.refresh(user)

    reset_link = f"{settings.FRONTEND_URL}/set-password?token={setup_token}"
    email_sent = await email_service.send_password_reset_email(
        user.email,
        user.name,
        reset_link,
    )
    if not email_sent:
        logger.warning(
            "Password reset link created for %s but email failed to send",
            user.email,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to send password reset email. Check Email Service / Gmail configuration.",
        )

    logger.info(
        "Developer %s sent password reset link to user %s (%s)",
        actor_user_id,
        user.id,
        user.email,
    )
    return {
        "ok": True,
        "email": user.email,
        "expires_at": expires_at.isoformat() if isinstance(expires_at, datetime) else str(expires_at),
        "message": f"Password reset link sent to {user.email}",
    }


async def reset_password(
    db: AsyncSession,
    employee_id: UUID,
    company_id: UUID,
    new_password: str,
    actor_user_id: Optional[UUID] = None,
) -> User:
    """Reset employee password."""
    is_valid, error_msg = validate_password_strength(new_password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg,
        )
    
    user = await get_user_by_id(db, employee_id, company_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Employee with ID {employee_id} not found in your company",
        )
    
    user.password_hash = get_password_hash(new_password)
    
    # Log password change
    if actor_user_id:
        audit_log = AuditLog(
            id=uuid.uuid4(),
            company_id=company_id,
            actor_user_id=actor_user_id,
            action="password_changed",
            entity_type="user",
            entity_id=employee_id,
            metadata_json={
                "employee_email": user.email,
                "employee_name": user.name,
            },
        )
        db.add(audit_log)
    
    try:
        await db.commit()
        await db.refresh(user)
        return user
    except Exception as e:
        await db.rollback()
        logger.error("Failed to reset password: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=client_error_detail(
                dev_detail=f"Failed to reset password: {str(e)}",
                prod_detail="Failed to reset password. Please try again.",
            ),
        )


async def delete_employee(
    db: AsyncSession,
    employee_id: UUID,
    company_id: UUID,
) -> None:
    """Delete employee and all related records."""
    user = await get_user_by_id(db, employee_id, company_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found",
        )
    
    # Only allow deletion of non-admin/non-developer users
    if user.role in [UserRole.ADMIN, UserRole.DEVELOPER]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete admin or developer users through this endpoint",
        )
    
    # Delete related records
    from app.models.time_entry import TimeEntry
    from app.models.leave_request import LeaveRequest
    from app.models.session import Session
    from app.models.payroll import PayrollLineItem, PayrollAdjustment
    
    # Delete payroll adjustments
    await db.execute(
        sql_delete(PayrollAdjustment).where(PayrollAdjustment.employee_id == employee_id)
    )
    
    # Delete payroll line items
    await db.execute(
        sql_delete(PayrollLineItem).where(PayrollLineItem.employee_id == employee_id)
    )
    
    # Delete time entries
    await db.execute(
        sql_delete(TimeEntry).where(TimeEntry.employee_id == employee_id)
    )
    
    # Delete leave requests
    await db.execute(
        sql_delete(LeaveRequest).where(LeaveRequest.employee_id == employee_id)
    )
    
    # Delete sessions
    await db.execute(
        sql_delete(Session).where(Session.user_id == employee_id)
    )
    
    # Delete audit logs where employee is actor
    from app.models.audit_log import AuditLog
    await db.execute(
        sql_delete(AuditLog).where(AuditLog.actor_user_id == employee_id)
    )
    
    # Delete the user
    await db.execute(
        sql_delete(User).where(User.id == employee_id)
    )
    await db.commit()

