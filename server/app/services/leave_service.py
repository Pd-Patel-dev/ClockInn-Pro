from typing import Optional, List
from uuid import UUID
from datetime import date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from fastapi import HTTPException, status

from app.models.leave_request import LeaveRequest, LeaveStatus
from app.schemas.leave_request import LeaveRequestCreate, LeaveRequestUpdate
import uuid


async def create_leave_request(
    db: AsyncSession,
    company_id: UUID,
    employee_id: UUID,
    data: LeaveRequestCreate,
) -> LeaveRequest:
    """Create a leave request."""
    if data.start_date > data.end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Start date must be before end date",
        )
    
    # Check for overlapping requests (optional warning - we'll allow but could add check)
    
    leave_request = LeaveRequest(
        id=uuid.uuid4(),
        company_id=company_id,
        employee_id=employee_id,
        type=data.type,
        start_date=data.start_date,
        end_date=data.end_date,
        partial_day_hours=data.partial_day_hours,
        reason=data.reason,
        status=LeaveStatus.PENDING,
    )
    
    db.add(leave_request)
    await db.commit()
    await db.refresh(leave_request)
    
    return leave_request


async def get_my_leave_requests(
    db: AsyncSession,
    employee_id: UUID,
    company_id: UUID,
    skip: int = 0,
    limit: int = 100,
) -> tuple[List[LeaveRequest], int]:
    """Get employee's own leave requests."""
    query = select(LeaveRequest).where(
        and_(
            LeaveRequest.employee_id == employee_id,
            LeaveRequest.company_id == company_id,
        )
    )
    
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0
    
    result = await db.execute(query.order_by(LeaveRequest.created_at.desc()).offset(skip).limit(limit))
    requests = result.scalars().all()
    
    return list(requests), total


async def get_admin_leave_requests(
    db: AsyncSession,
    company_id: UUID,
    status_filter: Optional[LeaveStatus] = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[List[LeaveRequest], int]:
    """Get leave requests for admin view."""
    query = select(LeaveRequest).where(LeaveRequest.company_id == company_id)
    
    if status_filter:
        query = query.where(LeaveRequest.status == status_filter)
    
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0
    
    result = await db.execute(query.order_by(LeaveRequest.created_at.desc()).offset(skip).limit(limit))
    requests = result.scalars().all()
    
    return list(requests), total


async def update_leave_request(
    db: AsyncSession,
    request_id: UUID,
    company_id: UUID,
    reviewer_id: UUID,
    data: LeaveRequestUpdate,
) -> LeaveRequest:
    """Approve or reject a leave request."""
    result = await db.execute(
        select(LeaveRequest).where(
            and_(
                LeaveRequest.id == request_id,
                LeaveRequest.company_id == company_id,
            )
        )
    )
    leave_request = result.scalar_one_or_none()
    
    if not leave_request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Leave request not found",
        )
    
    if leave_request.status != LeaveStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Leave request already processed",
        )
    
    leave_request.status = data.status
    leave_request.reviewed_by = reviewer_id
    leave_request.review_comment = data.review_comment
    
    # Create audit log
    from app.models.audit_log import AuditLog
    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
        actor_user_id=reviewer_id,
        action=f"leave_request_{data.status.value}",
        entity_type="leave_request",
        entity_id=request_id,
        metadata_json={
            "status": data.status.value,
            "comment": data.review_comment,
        },
    )
    db.add(audit_log)
    
    await db.commit()
    await db.refresh(leave_request)
    
    return leave_request

