"""
Admin Cash Drawer Management Endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import date
from typing import Optional
from uuid import UUID
from fastapi.responses import StreamingResponse
from io import BytesIO

from app.core.database import get_db
from app.core.dependencies import get_current_admin
from app.core.error_handling import handle_endpoint_errors
from app.models.user import User
from app.models.cash_drawer import CashDrawerSession, CashDrawerStatus
from app.models.time_entry import TimeEntry
from app.schemas.cash_drawer import (
    CashDrawerSessionResponse,
    CashDrawerSessionDetailResponse,
    CashDrawerSessionUpdate,
    CashDrawerSessionReview,
    CashDrawerSummaryResponse,
    CashDrawerExportRequest,
)
from app.services.cash_drawer_service import (
    get_cash_drawer_session,
    get_cash_drawer_sessions,
    get_cash_drawer_summary,
    edit_cash_drawer_session,
    review_cash_drawer_session,
)

router = APIRouter()


@router.get("", response_model=list[CashDrawerSessionResponse])
@handle_endpoint_errors(operation_name="list_cash_drawer_sessions")
async def list_cash_drawer_sessions(
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    employee_id: Optional[UUID] = Query(None),
    status_filter: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """List cash drawer sessions with filters."""
    status_enum = None
    if status_filter:
        try:
            status_enum = CashDrawerStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status: {status_filter}",
            )
    
    sessions, total = await get_cash_drawer_sessions(
        db,
        current_user.company_id,
        from_date,
        to_date,
        employee_id,
        status_enum,
        limit,
        offset,
    )
    
    # Load employee names and time entry data
    from app.models.time_entry import TimeEntry
    result = []
    for session in sessions:
        emp_result = await db.execute(
            select(User).where(User.id == session.employee_id)
        )
        employee = emp_result.scalar_one_or_none()
        
        # Load time entry for clock in/out times
        time_entry_result = await db.execute(
            select(TimeEntry).where(TimeEntry.id == session.time_entry_id)
        )
        time_entry = time_entry_result.scalar_one_or_none()
        
        result.append(CashDrawerSessionResponse(
            id=session.id,
            company_id=session.company_id,
            time_entry_id=session.time_entry_id,
            employee_id=session.employee_id,
            employee_name=employee.name if employee else "Unknown",
            start_cash_cents=session.start_cash_cents,
            start_counted_at=session.start_counted_at,
            start_count_source=session.start_count_source.value,
            end_cash_cents=session.end_cash_cents,
            end_counted_at=session.end_counted_at,
            end_count_source=session.end_count_source.value if session.end_count_source else None,
            collected_cash_cents=session.collected_cash_cents,
            beverages_cash_cents=session.beverages_cash_cents,
            delta_cents=session.delta_cents,
            status=session.status.value,
            reviewed_by=session.reviewed_by,
            reviewed_at=session.reviewed_at,
            review_note=session.review_note,
            created_at=session.created_at,
            updated_at=session.updated_at,
            clock_in_at=time_entry.clock_in_at if time_entry else None,
            clock_out_at=time_entry.clock_out_at if time_entry else None,
        ))
    
    return result


@router.get("/summary", response_model=CashDrawerSummaryResponse)
@handle_endpoint_errors(operation_name="get_cash_drawer_summary")
async def get_cash_drawer_summary_endpoint(
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    employee_id: Optional[UUID] = Query(None),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get cash drawer summary statistics."""
    summary = await get_cash_drawer_summary(
        db,
        current_user.company_id,
        from_date,
        to_date,
        employee_id,
    )
    
    return CashDrawerSummaryResponse(**summary)


@router.get("/{session_id}", response_model=CashDrawerSessionDetailResponse)
@handle_endpoint_errors(operation_name="get_cash_drawer_session")
async def get_cash_drawer_session_endpoint(
    session_id: UUID,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get cash drawer session details with audit history."""
    session = await get_cash_drawer_session(db, current_user.company_id, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cash drawer session not found",
        )
    
    # Load employee name
    emp_result = await db.execute(
        select(User).where(User.id == session.employee_id)
    )
    employee = emp_result.scalar_one_or_none()
    
    # Load audit logs
    from app.models.cash_drawer import CashDrawerAudit
    audit_result = await db.execute(
        select(CashDrawerAudit, User.name)
        .join(User, CashDrawerAudit.actor_user_id == User.id)
        .where(CashDrawerAudit.cash_drawer_session_id == session_id)
        .order_by(CashDrawerAudit.created_at.desc())
    )
    audit_logs = []
    for audit, actor_name in audit_result.all():
        audit_logs.append({
            "id": audit.id,
            "action": audit.action.value,
            "actor_user_id": audit.actor_user_id,
            "actor_name": actor_name,
            "old_values_json": audit.old_values_json,
            "new_values_json": audit.new_values_json,
            "reason": audit.reason,
            "created_at": audit.created_at,
        })
    
    return CashDrawerSessionDetailResponse(
        id=session.id,
        company_id=session.company_id,
        time_entry_id=session.time_entry_id,
        employee_id=session.employee_id,
        employee_name=employee.name if employee else "Unknown",
        start_cash_cents=session.start_cash_cents,
        start_counted_at=session.start_counted_at,
        start_count_source=session.start_count_source.value,
        end_cash_cents=session.end_cash_cents,
        end_counted_at=session.end_counted_at,
        end_count_source=session.end_count_source.value if session.end_count_source else None,
        delta_cents=session.delta_cents,
        status=session.status.value,
        reviewed_by=session.reviewed_by,
        reviewed_at=session.reviewed_at,
        review_note=session.review_note,
        created_at=session.created_at,
        updated_at=session.updated_at,
        audit_logs=audit_logs,
    )


@router.put("/{session_id}", response_model=CashDrawerSessionResponse)
@handle_endpoint_errors(operation_name="edit_cash_drawer_session")
async def edit_cash_drawer_session_endpoint(
    session_id: UUID,
    data: CashDrawerSessionUpdate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Edit cash drawer session (admin only)."""
    session = await edit_cash_drawer_session(
        db,
        current_user.company_id,
        session_id,
        current_user.id,
        data.start_cash_cents,
        data.end_cash_cents,
        data.reason,
    )
    
    # Load employee name and time entry
    emp_result = await db.execute(
        select(User).where(User.id == session.employee_id)
    )
    employee = emp_result.scalar_one_or_none()
    
    # Load time entry for clock in/out times
    time_entry_result = await db.execute(
        select(TimeEntry).where(TimeEntry.id == session.time_entry_id)
    )
    time_entry = time_entry_result.scalar_one_or_none()
    
    return CashDrawerSessionResponse(
        id=session.id,
        company_id=session.company_id,
        time_entry_id=session.time_entry_id,
        employee_id=session.employee_id,
        employee_name=employee.name if employee else "Unknown",
        start_cash_cents=session.start_cash_cents,
        start_counted_at=session.start_counted_at,
        start_count_source=session.start_count_source.value,
        end_cash_cents=session.end_cash_cents,
        end_counted_at=session.end_counted_at,
        end_count_source=session.end_count_source.value if session.end_count_source else None,
        collected_cash_cents=session.collected_cash_cents,
        beverages_cash_cents=session.beverages_cash_cents,
        delta_cents=session.delta_cents,
        status=session.status.value,
        reviewed_by=session.reviewed_by,
        reviewed_at=session.reviewed_at,
        review_note=session.review_note,
        created_at=session.created_at,
        updated_at=session.updated_at,
        clock_in_at=time_entry.clock_in_at if time_entry else None,
        clock_out_at=time_entry.clock_out_at if time_entry else None,
    )


@router.post("/{session_id}/review", response_model=CashDrawerSessionResponse)
@handle_endpoint_errors(operation_name="review_cash_drawer_session")
async def review_cash_drawer_session_endpoint(
    session_id: UUID,
    data: CashDrawerSessionReview,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Review and update cash drawer session status."""
    # After review, status should always be CLOSED
    session = await review_cash_drawer_session(
        db,
        current_user.company_id,
        session_id,
        current_user.id,
        data.note,
        CashDrawerStatus.CLOSED,
    )
    
    # Commit the transaction to persist changes
    await db.commit()
    await db.refresh(session)
    
    # Load employee name and time entry
    emp_result = await db.execute(
        select(User).where(User.id == session.employee_id)
    )
    employee = emp_result.scalar_one_or_none()
    
    # Load time entry for clock in/out times
    time_entry_result = await db.execute(
        select(TimeEntry).where(TimeEntry.id == session.time_entry_id)
    )
    time_entry = time_entry_result.scalar_one_or_none()
    
    return CashDrawerSessionResponse(
        id=session.id,
        company_id=session.company_id,
        time_entry_id=session.time_entry_id,
        employee_id=session.employee_id,
        employee_name=employee.name if employee else "Unknown",
        start_cash_cents=session.start_cash_cents,
        start_counted_at=session.start_counted_at,
        start_count_source=session.start_count_source.value,
        end_cash_cents=session.end_cash_cents,
        end_counted_at=session.end_counted_at,
        end_count_source=session.end_count_source.value if session.end_count_source else None,
        collected_cash_cents=session.collected_cash_cents,
        beverages_cash_cents=session.beverages_cash_cents,
        delta_cents=session.delta_cents,
        status=session.status.value,
        reviewed_by=session.reviewed_by,
        reviewed_at=session.reviewed_at,
        review_note=session.review_note,
        created_at=session.created_at,
        updated_at=session.updated_at,
        clock_in_at=time_entry.clock_in_at if time_entry else None,
        clock_out_at=time_entry.clock_out_at if time_entry else None,
    )


@router.post("/export")
@handle_endpoint_errors(operation_name="export_cash_drawer")
async def export_cash_drawer(
    request: CashDrawerExportRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Export cash drawer sessions to PDF or Excel."""
    from app.services.cash_drawer_export_service import (
        generate_cash_drawer_pdf,
        generate_cash_drawer_excel,
    )
    
    sessions, _ = await get_cash_drawer_sessions(
        db,
        current_user.company_id,
        request.from_date,
        request.to_date,
        request.employee_id,
        CashDrawerStatus(request.status) if request.status else None,
        limit=10000,  # Large limit for export
        offset=0,
    )
    
    if request.format == "pdf":
        buffer = await generate_cash_drawer_pdf(
            db,
            current_user.company_id,
            sessions,
            request.from_date,
            request.to_date,
        )
        return StreamingResponse(
            buffer,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="cash_drawer_{request.from_date}_{request.to_date}.pdf"'
            },
        )
    else:  # xlsx
        buffer = await generate_cash_drawer_excel(
            db,
            current_user.company_id,
            sessions,
            request.from_date,
            request.to_date,
        )
        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="cash_drawer_{request.from_date}_{request.to_date}.xlsx"'
            },
        )
