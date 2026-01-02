from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_current_admin
from app.core.error_handling import handle_endpoint_errors, parse_uuid
from app.models.user import User
from app.models.leave_request import LeaveStatus
from app.schemas.leave_request import (
    LeaveRequestCreate,
    LeaveRequestUpdate,
    LeaveRequestResponse,
    LeaveRequestListResponse,
)
from app.services.leave_service import (
    create_leave_request,
    get_my_leave_requests,
    get_admin_leave_requests,
    update_leave_request,
)

router = APIRouter()


@router.post("/request", response_model=LeaveRequestResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="create_leave_request")
async def create_leave_request_endpoint(
    data: LeaveRequestCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a leave request."""
    leave_req = await create_leave_request(
        db,
        current_user.company_id,
        current_user.id,
        data,
    )
    
    # Get employee name
    from sqlalchemy import select
    result = await db.execute(select(User).where(User.id == leave_req.employee_id))
    employee = result.scalar_one_or_none()
    
    return LeaveRequestResponse(
        id=leave_req.id,
        employee_id=leave_req.employee_id,
        employee_name=employee.name if employee else "Unknown",
        type=leave_req.type,
        start_date=leave_req.start_date,
        end_date=leave_req.end_date,
        partial_day_hours=leave_req.partial_day_hours,
        reason=leave_req.reason,
        status=leave_req.status,
        reviewed_by=leave_req.reviewed_by,
        review_comment=leave_req.review_comment,
        created_at=leave_req.created_at,
        updated_at=leave_req.updated_at,
    )


@router.get("/my", response_model=LeaveRequestListResponse)
@handle_endpoint_errors(operation_name="get_my_leave_requests")
async def get_my_leave_requests_endpoint(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current user's leave requests."""
    requests, total = await get_my_leave_requests(
        db,
        current_user.id,
        current_user.company_id,
        skip,
        limit,
    )
    
    # Get employee names
    from sqlalchemy import select
    employee_ids = {req.employee_id for req in requests}
    result = await db.execute(select(User).where(User.id.in_(employee_ids)))
    employees = {emp.id: emp.name for emp in result.scalars().all()}
    
    return LeaveRequestListResponse(
        requests=[
            LeaveRequestResponse(
                id=req.id,
                employee_id=req.employee_id,
                employee_name=employees.get(req.employee_id, "Unknown"),
                type=req.type,
                start_date=req.start_date,
                end_date=req.end_date,
                partial_day_hours=req.partial_day_hours,
                reason=req.reason,
                status=req.status,
                reviewed_by=req.reviewed_by,
                review_comment=req.review_comment,
                created_at=req.created_at,
                updated_at=req.updated_at,
            )
            for req in requests
        ],
        total=total,
    )


@router.get("/admin/leave", response_model=LeaveRequestListResponse)
@handle_endpoint_errors(operation_name="get_admin_leave_requests")
async def get_admin_leave_requests_endpoint(
    status: Optional[LeaveStatus] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get leave requests for admin view."""
    requests, total = await get_admin_leave_requests(
        db,
        current_user.company_id,
        status,
        skip,
        limit,
    )
    
    # Get employee names
    from sqlalchemy import select
    employee_ids = {req.employee_id for req in requests}
    result = await db.execute(select(User).where(User.id.in_(employee_ids)))
    employees = {emp.id: emp.name for emp in result.scalars().all()}
    
    return LeaveRequestListResponse(
        requests=[
            LeaveRequestResponse(
                id=req.id,
                employee_id=req.employee_id,
                employee_name=employees.get(req.employee_id, "Unknown"),
                type=req.type,
                start_date=req.start_date,
                end_date=req.end_date,
                partial_day_hours=req.partial_day_hours,
                reason=req.reason,
                status=req.status,
                reviewed_by=req.reviewed_by,
                review_comment=req.review_comment,
                created_at=req.created_at,
                updated_at=req.updated_at,
            )
            for req in requests
        ],
        total=total,
    )


@router.put("/admin/leave/{request_id}/approve", response_model=LeaveRequestResponse)
@handle_endpoint_errors(operation_name="approve_leave_request")
async def approve_leave_request_endpoint(
    request_id: str,
    review_comment: Optional[str] = None,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Approve a leave request (admin only)."""
    req_id = parse_uuid(request_id, "Leave request ID")
    
    leave_req = await update_leave_request(
        db,
        req_id,
        current_user.company_id,
        current_user.id,
        LeaveRequestUpdate(status=LeaveStatus.APPROVED, review_comment=review_comment),
    )
    
    # Get employee name
    from sqlalchemy import select
    result = await db.execute(select(User).where(User.id == leave_req.employee_id))
    employee = result.scalar_one_or_none()
    
    return LeaveRequestResponse(
        id=leave_req.id,
        employee_id=leave_req.employee_id,
        employee_name=employee.name if employee else "Unknown",
        type=leave_req.type,
        start_date=leave_req.start_date,
        end_date=leave_req.end_date,
        partial_day_hours=leave_req.partial_day_hours,
        reason=leave_req.reason,
        status=leave_req.status,
        reviewed_by=leave_req.reviewed_by,
        review_comment=leave_req.review_comment,
        created_at=leave_req.created_at,
        updated_at=leave_req.updated_at,
    )


@router.put("/admin/leave/{request_id}/reject", response_model=LeaveRequestResponse)
@handle_endpoint_errors(operation_name="reject_leave_request")
async def reject_leave_request_endpoint(
    request_id: str,
    review_comment: Optional[str] = None,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Reject a leave request (admin only)."""
    req_id = parse_uuid(request_id, "Leave request ID")
    
    leave_req = await update_leave_request(
        db,
        req_id,
        current_user.company_id,
        current_user.id,
        LeaveRequestUpdate(status=LeaveStatus.REJECTED, review_comment=review_comment),
    )
    
    # Get employee name
    from sqlalchemy import select
    result = await db.execute(select(User).where(User.id == leave_req.employee_id))
    employee = result.scalar_one_or_none()
    
    return LeaveRequestResponse(
        id=leave_req.id,
        employee_id=leave_req.employee_id,
        employee_name=employee.name if employee else "Unknown",
        type=leave_req.type,
        start_date=leave_req.start_date,
        end_date=leave_req.end_date,
        partial_day_hours=leave_req.partial_day_hours,
        reason=leave_req.reason,
        status=leave_req.status,
        reviewed_by=leave_req.reviewed_by,
        review_comment=leave_req.review_comment,
        created_at=leave_req.created_at,
        updated_at=leave_req.updated_at,
    )

