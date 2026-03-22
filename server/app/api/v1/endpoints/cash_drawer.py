"""
Admin Cash Drawer Management Endpoints
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import date, datetime
from typing import Optional
from uuid import UUID
from fastapi.responses import StreamingResponse
from io import BytesIO

from app.core.database import get_db
from app.core.dependencies import get_current_admin
from app.core.error_handling import handle_endpoint_errors, parse_uuid, client_error_detail
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
    delete_cash_drawer_session,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _safe_session_attr(session, name, default=None):
    """Use getattr for optional columns so missing migrations don't cause 500."""
    return getattr(session, name, default)


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
            collected_cash_cents=_safe_session_attr(session, "collected_cash_cents"),
            drop_amount_cents=_safe_session_attr(session, "drop_amount_cents"),
            beverages_cash_cents=_safe_session_attr(session, "beverages_cash_cents"),
            expected_balance_cents=(
                session.start_cash_cents
                + (_safe_session_attr(session, "collected_cash_cents") or 0)
                - (_safe_session_attr(session, "drop_amount_cents") or 0)
            ) if session.end_cash_cents is not None else None,
            delta_cents=_safe_session_attr(session, "delta_cents"),
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


@router.get("/export")
@handle_endpoint_errors(operation_name="export_cash_drawer")
async def export_cash_drawer(
    format: str = Query(..., pattern="^(pdf|xlsx)$", description="Export format: 'pdf' or 'xlsx'"),
    from_date: str = Query(..., description="Start date in YYYY-MM-DD format"),
    to_date: str = Query(..., description="End date in YYYY-MM-DD format"),
    employee_id: Optional[UUID] = Query(None),
    status_filter: Optional[str] = Query(None, pattern="^(OPEN|CLOSED|REVIEW_NEEDED)$"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Export cash drawer sessions to PDF or Excel."""
    # Validate and parse date strings
    if not from_date or not to_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="from_date and to_date are required.",
        )
    
    try:
        from_date_parsed = datetime.strptime(from_date, "%Y-%m-%d").date()
        to_date_parsed = datetime.strptime(to_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid date format. Use YYYY-MM-DD.",
        )
    
    # Validate date range
    if from_date_parsed > to_date_parsed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="from_date must be less than or equal to to_date.",
        )
    
    # Validate format
    if format not in ["pdf", "xlsx"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid format '{format}'. Must be 'pdf' or 'xlsx'.",
        )
    
    from app.services.cash_drawer_export_service import (
        generate_cash_drawer_pdf,
        generate_cash_drawer_excel,
    )
    
    # Validate status if provided
    status_enum = None
    if status_filter:
        try:
            status_enum = CashDrawerStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid status '{status_filter}'. Must be one of: OPEN, CLOSED, REVIEW_NEEDED.",
            )
    
    sessions, _ = await get_cash_drawer_sessions(
        db,
        current_user.company_id,
        from_date_parsed,
        to_date_parsed,
        employee_id,
        status_enum,
        limit=10000,  # Large limit for export
        offset=0,
    )
    
    try:
        if format == "pdf":
            buffer = await generate_cash_drawer_pdf(
                db,
                current_user.company_id,
                sessions,
                from_date_parsed,
                to_date_parsed,
            )
            filename = f"cash_drawer_{from_date_parsed.strftime('%Y%m%d')}_{to_date_parsed.strftime('%Y%m%d')}.pdf"
            return StreamingResponse(
                buffer,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"'
                },
            )
        else:  # xlsx
            buffer = await generate_cash_drawer_excel(
                db,
                current_user.company_id,
                sessions,
                from_date_parsed,
                to_date_parsed,
            )
            filename = f"cash_drawer_{from_date_parsed.strftime('%Y%m%d')}_{to_date_parsed.strftime('%Y%m%d')}.xlsx"
            return StreamingResponse(
                buffer,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"'
                },
            )
    except ValueError as e:
        logger.error("Cash drawer export failed (%s): %s", format, e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=client_error_detail(
                dev_detail=f"Failed to generate {format.upper()} export: {str(e)}",
                prod_detail="Export failed. Please try again or check server logs.",
            ),
        )


@router.get("/{session_id}", response_model=CashDrawerSessionDetailResponse)
@handle_endpoint_errors(operation_name="get_cash_drawer_session")
async def get_cash_drawer_session_endpoint(
    session_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get cash drawer session details with audit history."""
    sid = parse_uuid(session_id, "Session ID")
    session = await get_cash_drawer_session(db, current_user.company_id, sid)
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
        .where(CashDrawerAudit.cash_drawer_session_id == sid)
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
        collected_cash_cents=_safe_session_attr(session, "collected_cash_cents"),
        drop_amount_cents=_safe_session_attr(session, "drop_amount_cents"),
        beverages_cash_cents=_safe_session_attr(session, "beverages_cash_cents"),
        expected_balance_cents=(
            session.start_cash_cents
            + (_safe_session_attr(session, "collected_cash_cents") or 0)
            - (_safe_session_attr(session, "drop_amount_cents") or 0)
        ) if session.end_cash_cents is not None else None,
        delta_cents=_safe_session_attr(session, "delta_cents"),
        status=session.status.value,
        reviewed_by=session.reviewed_by,
        reviewed_at=session.reviewed_at,
        review_note=session.review_note,
        created_at=session.created_at,
        updated_at=session.updated_at,
        clock_in_at=time_entry.clock_in_at if time_entry else None,
        clock_out_at=time_entry.clock_out_at if time_entry else None,
        audit_logs=audit_logs,
    )


@router.put("/{session_id}", response_model=CashDrawerSessionResponse)
@handle_endpoint_errors(operation_name="edit_cash_drawer_session")
async def edit_cash_drawer_session_endpoint(
    session_id: str,
    data: CashDrawerSessionUpdate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Edit cash drawer session (admin only)."""
    sid = parse_uuid(session_id, "Session ID")
    session = await edit_cash_drawer_session(
        db,
        current_user.company_id,
        sid,
        current_user.id,
        data.start_cash_cents,
        data.end_cash_cents,
        data.reason,
    )
    await db.refresh(session)

    # Copy all session attributes to locals *before* any other await (avoid expired attributes -> MissingGreenlet)
    collected = _safe_session_attr(session, "collected_cash_cents")
    drop = _safe_session_attr(session, "drop_amount_cents")
    beverages = _safe_session_attr(session, "beverages_cash_cents")
    delta = _safe_session_attr(session, "delta_cents")
    payload = {
        "id": session.id,
        "company_id": session.company_id,
        "time_entry_id": session.time_entry_id,
        "employee_id": session.employee_id,
        "start_cash_cents": session.start_cash_cents,
        "start_counted_at": session.start_counted_at,
        "start_count_source": session.start_count_source.value,
        "end_cash_cents": session.end_cash_cents,
        "end_counted_at": session.end_counted_at,
        "end_count_source": session.end_count_source.value if session.end_count_source else None,
        "collected_cash_cents": collected,
        "drop_amount_cents": drop,
        "beverages_cash_cents": beverages,
        "delta_cents": delta,
        "status": session.status.value,
        "reviewed_by": session.reviewed_by,
        "reviewed_at": session.reviewed_at,
        "review_note": session.review_note,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
    }

    emp_result = await db.execute(
        select(User).where(User.id == session.employee_id)
    )
    employee = emp_result.scalar_one_or_none()
    time_entry_result = await db.execute(
        select(TimeEntry).where(TimeEntry.id == session.time_entry_id)
    )
    time_entry = time_entry_result.scalar_one_or_none()

    response = CashDrawerSessionResponse(
        **payload,
        employee_name=employee.name if employee else "Unknown",
        expected_balance_cents=(
            payload["start_cash_cents"] + (collected or 0) - (drop or 0)
        ) if payload["end_cash_cents"] is not None else None,
        clock_in_at=time_entry.clock_in_at if time_entry else None,
        clock_out_at=time_entry.clock_out_at if time_entry else None,
    )
    await db.commit()
    return response


@router.post("/{session_id}/review", response_model=CashDrawerSessionResponse)
@handle_endpoint_errors(operation_name="review_cash_drawer_session")
async def review_cash_drawer_session_endpoint(
    session_id: str,
    data: CashDrawerSessionReview,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Review and update cash drawer session status."""
    sid = parse_uuid(session_id, "Session ID")
    session = await review_cash_drawer_session(
        db,
        current_user.company_id,
        sid,
        current_user.id,
        data.note,
        CashDrawerStatus.CLOSED,
    )
    await db.refresh(session)

    collected = _safe_session_attr(session, "collected_cash_cents")
    drop = _safe_session_attr(session, "drop_amount_cents")
    payload = {
        "id": session.id,
        "company_id": session.company_id,
        "time_entry_id": session.time_entry_id,
        "employee_id": session.employee_id,
        "start_cash_cents": session.start_cash_cents,
        "start_counted_at": session.start_counted_at,
        "start_count_source": session.start_count_source.value,
        "end_cash_cents": session.end_cash_cents,
        "end_counted_at": session.end_counted_at,
        "end_count_source": session.end_count_source.value if session.end_count_source else None,
        "collected_cash_cents": collected,
        "drop_amount_cents": drop,
        "beverages_cash_cents": _safe_session_attr(session, "beverages_cash_cents"),
        "delta_cents": _safe_session_attr(session, "delta_cents"),
        "status": session.status.value,
        "reviewed_by": session.reviewed_by,
        "reviewed_at": session.reviewed_at,
        "review_note": session.review_note,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
    }
    emp_result = await db.execute(
        select(User).where(User.id == session.employee_id)
    )
    employee = emp_result.scalar_one_or_none()
    time_entry_result = await db.execute(
        select(TimeEntry).where(TimeEntry.id == session.time_entry_id)
    )
    time_entry = time_entry_result.scalar_one_or_none()
    response = CashDrawerSessionResponse(
        **payload,
        employee_name=employee.name if employee else "Unknown",
        expected_balance_cents=(
            payload["start_cash_cents"] + (collected or 0) - (drop or 0)
        ) if payload["end_cash_cents"] is not None else None,
        clock_in_at=time_entry.clock_in_at if time_entry else None,
        clock_out_at=time_entry.clock_out_at if time_entry else None,
    )
    await db.commit()
    return response


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
@handle_endpoint_errors(operation_name="delete_cash_drawer_session")
async def delete_cash_drawer_session_endpoint(
    session_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a cash drawer session."""
    sid = parse_uuid(session_id, "Session ID")
    await delete_cash_drawer_session(
        db,
        current_user.company_id,
        sid,
        current_user.id,
    )
    
    # Commit the transaction to persist changes
    await db.commit()
    
    return None
