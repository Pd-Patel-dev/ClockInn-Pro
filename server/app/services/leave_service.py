from typing import Optional, List
from uuid import UUID
from datetime import date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from fastapi import HTTPException, status

from app.models.leave_request import LeaveRequest, LeaveStatus
from app.core.query_builder import get_paginated_results, build_employee_company_filtered_query, build_company_filtered_query, filter_by_status
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
    
    try:
        db.add(leave_request)
        await db.commit()
        await db.refresh(leave_request)
        return leave_request
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create leave request: {str(e)}",
        )


async def get_my_leave_requests(
    db: AsyncSession,
    employee_id: UUID,
    company_id: UUID,
    skip: int = 0,
    limit: int = 100,
) -> tuple[List[LeaveRequest], int]:
    """Get employee's own leave requests."""
    query = build_employee_company_filtered_query(LeaveRequest, employee_id, company_id)
    
    return await get_paginated_results(
        db,
        query,
        skip=skip,
        limit=limit,
        order_by=LeaveRequest.created_at.desc()
    )


async def get_admin_leave_requests(
    db: AsyncSession,
    company_id: UUID,
    status_filter: Optional[LeaveStatus] = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[List[LeaveRequest], int]:
    """Get leave requests for admin view."""
    query = build_company_filtered_query(LeaveRequest, company_id)
    
    # Apply status filter
    if status_filter:
        query = filter_by_status(query, LeaveRequest, status_filter)
    
    return await get_paginated_results(
        db,
        query,
        skip=skip,
        limit=limit,
        order_by=LeaveRequest.created_at.desc()
    )


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
            detail=f"Leave request with ID {request_id} not found in your company",
        )
    
    if leave_request.status != LeaveStatus.PENDING:
        status_display = leave_request.status.value.title()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This leave request has already been {status_display.lower()}. Only pending requests can be updated.",
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
    try:
        db.add(audit_log)
        await db.commit()
        await db.refresh(leave_request)
        return leave_request
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update leave request: {str(e)}",
        )

