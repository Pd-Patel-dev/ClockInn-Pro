from typing import Optional, List
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, delete as sql_delete
from fastapi import HTTPException, status
import logging

from app.models.user import User, UserRole, UserStatus
from app.models.audit_log import AuditLog
from app.core.query_builder import get_paginated_results, build_company_filtered_query
from app.core.security import (
    get_password_hash,
    get_pin_hash,
    normalize_email,
    validate_password_strength,
)
from app.schemas.user import UserCreate, UserUpdate
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
    """List employees for a company."""
    query = build_company_filtered_query(
        User,
        company_id,
        additional_filters={"role": UserRole.EMPLOYEE}
    )
    
    return await get_paginated_results(db, query, skip=skip, limit=limit)


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
    
    # Check if email exists in company
    result = await db.execute(
        select(User).where(
            and_(
                User.email == normalized_email,
                User.company_id == company_id,
            )
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already exists in company",
        )
    
    # Check if PIN is unique within the company (if PIN is provided)
    if data.pin:
        pin_hash = get_pin_hash(data.pin)
        result = await db.execute(
            select(User).where(
                and_(
                    User.company_id == company_id,
                    User.pin_hash == pin_hash,
                    User.role == UserRole.EMPLOYEE,
                )
            )
        )
        existing_pin_user = result.scalar_one_or_none()
        if existing_pin_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This PIN is already in use by another employee in your company. Please choose a different PIN.",
            )
    else:
        pin_hash = None
    
    # Create user
    user = User(
        id=uuid.uuid4(),
        company_id=company_id,
        role=UserRole.EMPLOYEE,
        name=data.name,
        email=normalized_email,
        password_hash=password_hash,
        pin_hash=pin_hash,
        status=UserStatus.ACTIVE,
        job_role=data.job_role,
        pay_rate=data.pay_rate,
    )
    
    try:
        db.add(user)
        await db.commit()
        await db.refresh(user)
        
        # If password was not provided, send password setup email
        if not data.password:
            try:
                setup_token = create_password_setup_token(str(user.id), normalized_email)
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
        # Check if it's a unique constraint violation for PIN
        error_str = str(e).lower()
        if 'pin_hash' in error_str or 'ix_users_company_pin_hash_unique' in error_str:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This PIN is already in use by another employee in your company. Please choose a different PIN.",
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create employee: {str(e)}",
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
    
    if user.role != UserRole.EMPLOYEE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"User {user.email} is not an employee. Only employees can be updated through this endpoint.",
        )
    
    # Track changes for audit logging
    old_status = user.status
    had_pin = user.pin_hash is not None
    
    if data.name is not None:
        user.name = data.name
    if data.status is not None:
        # Ensure status is set correctly using enum value
        user.status = UserStatus(data.status.value) if isinstance(data.status, UserStatus) else data.status
    if data.pin is not None:
        if data.pin == "":
            user.pin_hash = None
        else:
            # Check if PIN is unique within the company (excluding current employee)
            new_pin_hash = get_pin_hash(data.pin)
            result = await db.execute(
                select(User).where(
                    and_(
                        User.company_id == company_id,
                        User.pin_hash == new_pin_hash,
                        User.id != employee_id,  # Exclude current employee
                        User.role == UserRole.EMPLOYEE,
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
    if data.job_role is not None:
        user.job_role = data.job_role
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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update employee: {str(e)}",
        )


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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to reset password: {str(e)}",
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
    
    if user.role != UserRole.EMPLOYEE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not an employee",
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

