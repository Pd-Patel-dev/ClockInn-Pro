from typing import Optional, List
from uuid import UUID
from datetime import datetime, date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from fastapi import HTTPException, status

from app.models.time_entry import TimeEntry, TimeEntryStatus, TimeEntrySource
from app.models.user import User
from app.core.security import verify_pin, normalize_email
from app.schemas.time_entry import TimeEntryEdit
import uuid


async def punch(
    db: AsyncSession,
    company_id: UUID,
    employee_id: Optional[UUID],
    employee_email: Optional[str],
    pin: str,
    source: TimeEntrySource = TimeEntrySource.KIOSK,
) -> TimeEntry:
    """Handle clock in/out punch."""
    # Find employee
    if employee_id:
        result = await db.execute(
            select(User).where(
                and_(
                    User.id == employee_id,
                    User.company_id == company_id,
                    User.role == "EMPLOYEE",
                    User.status == "active",
                )
            )
        )
    elif employee_email:
        normalized_email = normalize_email(employee_email)
        result = await db.execute(
            select(User).where(
                and_(
                    User.email == normalized_email,
                    User.company_id == company_id,
                    User.role == "EMPLOYEE",
                    User.status == "active",
                )
            )
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either employee_id or employee_email required",
        )
    
    employee = result.scalar_one_or_none()
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found",
        )
    
    if not employee.pin_hash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PIN not set for employee",
        )
    
    if not verify_pin(pin, employee.pin_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid PIN",
        )
    
    # Check for open entry
    result = await db.execute(
        select(TimeEntry).where(
            and_(
                TimeEntry.employee_id == employee.id,
                TimeEntry.company_id == company_id,
                TimeEntry.clock_out_at.is_(None),
            )
        ).order_by(TimeEntry.clock_in_at.desc())
    )
    open_entry = result.scalar_one_or_none()
    
    now = datetime.utcnow()
    
    if open_entry:
        # Clock out
        open_entry.clock_out_at = now
        open_entry.status = TimeEntryStatus.CLOSED
        await db.commit()
        await db.refresh(open_entry)
        return open_entry
    else:
        # Clock in
        new_entry = TimeEntry(
            id=uuid.uuid4(),
            company_id=company_id,
            employee_id=employee.id,
            clock_in_at=now,
            source=source,
            status=TimeEntryStatus.OPEN,
        )
        db.add(new_entry)
        await db.commit()
        await db.refresh(new_entry)
        return new_entry


async def get_my_time_entries(
    db: AsyncSession,
    employee_id: UUID,
    company_id: UUID,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[List[TimeEntry], int]:
    """Get employee's own time entries."""
    query = select(TimeEntry).where(
        and_(
            TimeEntry.employee_id == employee_id,
            TimeEntry.company_id == company_id,
        )
    )
    
    if from_date:
        query = query.where(TimeEntry.clock_in_at >= datetime.combine(from_date, datetime.min.time()))
    if to_date:
        query = query.where(TimeEntry.clock_in_at <= datetime.combine(to_date, datetime.max.time()))
    
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0
    
    result = await db.execute(query.order_by(TimeEntry.clock_in_at.desc()).offset(skip).limit(limit))
    entries = result.scalars().all()
    
    return list(entries), total


async def get_admin_time_entries(
    db: AsyncSession,
    company_id: UUID,
    employee_id: Optional[UUID] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    status_filter: Optional[TimeEntryStatus] = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[List[TimeEntry], int]:
    """Get time entries for admin view."""
    query = select(TimeEntry).where(TimeEntry.company_id == company_id)
    
    if employee_id:
        query = query.where(TimeEntry.employee_id == employee_id)
    if from_date:
        query = query.where(TimeEntry.clock_in_at >= datetime.combine(from_date, datetime.min.time()))
    if to_date:
        query = query.where(TimeEntry.clock_in_at <= datetime.combine(to_date, datetime.max.time()))
    if status_filter:
        query = query.where(TimeEntry.status == status_filter)
    
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0
    
    result = await db.execute(query.order_by(TimeEntry.clock_in_at.desc()).offset(skip).limit(limit))
    entries = result.scalars().all()
    
    return list(entries), total


async def edit_time_entry(
    db: AsyncSession,
    entry_id: UUID,
    company_id: UUID,
    editor_id: UUID,
    data: TimeEntryEdit,
) -> TimeEntry:
    """Edit a time entry (admin only)."""
    result = await db.execute(
        select(TimeEntry).where(
            and_(
                TimeEntry.id == entry_id,
                TimeEntry.company_id == company_id,
            )
        )
    )
    entry = result.scalar_one_or_none()
    
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Time entry not found",
        )
    
    if data.clock_in_at is not None:
        entry.clock_in_at = data.clock_in_at
    if data.clock_out_at is not None:
        entry.clock_out_at = data.clock_out_at
    if data.break_minutes is not None:
        entry.break_minutes = data.break_minutes
    
    entry.edited_by = editor_id
    entry.edit_reason = data.edit_reason
    entry.status = TimeEntryStatus.EDITED
    
    # Create audit log
    from app.models.audit_log import AuditLog
    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
        actor_user_id=editor_id,
        action="time_entry_edited",
        entity_type="time_entry",
        entity_id=entry_id,
        metadata_json={
            "clock_in_at": str(data.clock_in_at) if data.clock_in_at else None,
            "clock_out_at": str(data.clock_out_at) if data.clock_out_at else None,
            "break_minutes": data.break_minutes,
            "reason": data.edit_reason,
        },
    )
    db.add(audit_log)
    
    await db.commit()
    await db.refresh(entry)
    
    return entry

