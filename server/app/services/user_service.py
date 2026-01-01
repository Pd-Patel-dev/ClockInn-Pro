from typing import Optional, List
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, delete as sql_delete
from fastapi import HTTPException, status

from app.models.user import User, UserRole, UserStatus
from app.core.security import (
    get_password_hash,
    get_pin_hash,
    normalize_email,
    validate_password_strength,
)
from app.schemas.user import UserCreate, UserUpdate
import uuid


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
    query = select(User).where(
        and_(
            User.company_id == company_id,
            User.role == UserRole.EMPLOYEE,
        )
    )
    
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0
    
    result = await db.execute(query.offset(skip).limit(limit))
    users = result.scalars().all()
    
    return list(users), total


async def create_employee(
    db: AsyncSession,
    company_id: UUID,
    data: UserCreate,
) -> User:
    """Create a new employee."""
    # Validate password
    is_valid, error_msg = validate_password_strength(data.password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg,
        )
    
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
    
    # Create user
    user = User(
        id=uuid.uuid4(),
        company_id=company_id,
        role=UserRole.EMPLOYEE,
        name=data.name,
        email=normalized_email,
        password_hash=get_password_hash(data.password),
        pin_hash=get_pin_hash(data.pin) if data.pin else None,
        status=UserStatus.ACTIVE,
        job_role=data.job_role,
        pay_rate=data.pay_rate,
    )
    
    db.add(user)
    await db.commit()
    await db.refresh(user)
    
    return user


async def update_employee(
    db: AsyncSession,
    employee_id: UUID,
    company_id: UUID,
    data: UserUpdate,
) -> User:
    """Update employee."""
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
    
    if data.name is not None:
        user.name = data.name
    if data.status is not None:
        # Ensure status is set correctly using enum value
        user.status = UserStatus(data.status.value) if isinstance(data.status, UserStatus) else data.status
    if data.pin is not None:
        if data.pin == "":
            user.pin_hash = None
        else:
            user.pin_hash = get_pin_hash(data.pin)
    if data.job_role is not None:
        user.job_role = data.job_role
    if data.pay_rate is not None:
        user.pay_rate = data.pay_rate
    
    await db.commit()
    await db.refresh(user)
    
    return user


async def reset_password(
    db: AsyncSession,
    employee_id: UUID,
    company_id: UUID,
    new_password: str,
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
            detail="Employee not found",
        )
    
    user.password_hash = get_password_hash(new_password)
    await db.commit()
    await db.refresh(user)
    
    return user


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
    
    # Delete the user
    await db.execute(
        sql_delete(User).where(User.id == employee_id)
    )
    await db.commit()

