"""
Cash Drawer Service

Handles cash drawer session creation, updates, and business logic.
"""
from typing import Optional, Dict, List
from uuid import UUID
from datetime import datetime, date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, or_, delete
from fastapi import HTTPException, status
from decimal import Decimal

from app.models.cash_drawer import (
    CashDrawerSession,
    CashDrawerAudit,
    CashDrawerStatus,
    CashCountSource,
    CashDrawerAuditAction,
)
from app.models.time_entry import TimeEntry, TimeEntryStatus
from app.models.user import User, UserRole, UserStatus
from app.models.company import Company
from app.models.audit_log import AuditLog
from app.services.company_service import get_company_settings


def requires_cash_drawer(company_settings: Dict, employee_role: str) -> bool:
    """Check if cash drawer is required for this employee."""
    if not company_settings.get("cash_drawer_enabled", False):
        return False
    
    # If setting is absent on older company rows, don't require for everyone.
    if company_settings.get("cash_drawer_required_for_all", False):
        return True
    
    required_roles = company_settings.get("cash_drawer_required_roles", ["FRONTDESK"])
    return employee_role in required_roles


async def get_open_company_cash_drawer(
    db: AsyncSession,
    company_id: UUID,
) -> Optional[Dict]:
    """
    Return the company-wide active (OPEN) cash drawer session, if any.
    Only one drawer should be active at a time across Front Desk staff.
    """
    result = await db.execute(
        select(CashDrawerSession, User.name)
        .outerjoin(User, User.id == CashDrawerSession.employee_id)
        .where(
            and_(
                CashDrawerSession.company_id == company_id,
                CashDrawerSession.status == CashDrawerStatus.OPEN,
            )
        )
        .order_by(CashDrawerSession.created_at.desc())
        .limit(1)
    )
    row = result.one_or_none()
    if not row:
        return None
    session, employee_name = row
    return {
        "session_id": session.id,
        "employee_id": session.employee_id,
        "employee_name": employee_name or "Front Desk",
        "time_entry_id": session.time_entry_id,
        "start_cash_cents": int(session.start_cash_cents or 0),
    }


async def employee_has_open_cash_drawer(
    db: AsyncSession,
    company_id: UUID,
    employee_id: UUID,
) -> bool:
    """True if this employee owns the company's open cash drawer session."""
    active = await get_open_company_cash_drawer(db, company_id)
    return bool(active and str(active["employee_id"]) == str(employee_id))


async def create_cash_drawer_session(
    db: AsyncSession,
    company_id: UUID,
    time_entry_id: UUID,
    employee_id: UUID,
    start_cash_cents: int,
    source: CashCountSource = CashCountSource.KIOSK,
) -> CashDrawerSession:
    """Create a new cash drawer session for clock-in."""
    if start_cash_cents < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Start cash amount cannot be negative",
        )

    # Only one company-wide open drawer at a time
    active = await get_open_company_cash_drawer(db, company_id)
    if active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Cash drawer is already activated by {active['employee_name']}. "
                "Clock in without starting a new drawer."
            ),
        )
    
    # Check if session already exists for this time entry
    result = await db.execute(
        select(CashDrawerSession).where(CashDrawerSession.time_entry_id == time_entry_id)
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cash drawer session already exists for this time entry",
        )
    
    session = CashDrawerSession(
        company_id=company_id,
        time_entry_id=time_entry_id,
        employee_id=employee_id,
        start_cash_cents=start_cash_cents,
        start_counted_at=datetime.utcnow(),
        start_count_source=source,
        status=CashDrawerStatus.OPEN,
    )
    db.add(session)
    # Flush to get the session ID before creating audit records
    await db.flush()
    
    # Create audit log
    audit = CashDrawerAudit(
        company_id=company_id,
        cash_drawer_session_id=session.id,
        actor_user_id=employee_id,
        action=CashDrawerAuditAction.CREATE_START,
        new_values_json={"start_cash_cents": start_cash_cents},
    )
    db.add(audit)
    
    # Create audit log entry
    audit_log = AuditLog(
        company_id=company_id,
        actor_user_id=employee_id,
        action="CASH_DRAWER_CREATE_START",
        entity_type="cash_drawer_session",
        entity_id=session.id,
        metadata_json={"start_cash_cents": start_cash_cents, "time_entry_id": str(time_entry_id)},
    )
    db.add(audit_log)
    
    # Flush audit records
    await db.flush()
    return session


async def close_cash_drawer_session(
    db: AsyncSession,
    company_id: UUID,
    time_entry_id: UUID,
    end_cash_cents: int,
    source: CashCountSource = CashCountSource.KIOSK,
    collected_cash_cents: Optional[int] = None,
    drop_amount_cents: Optional[int] = None,
    beverages_cash_cents: Optional[int] = None,
) -> CashDrawerSession:
    """Close a cash drawer session for clock-out.
    Balance (expected) = start_cash + collected_cash - drop_amount. Marketplace sales are not included in balance.
    """
    if end_cash_cents < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="End cash amount cannot be negative",
        )
    
    # Find the cash drawer session
    result = await db.execute(
        select(CashDrawerSession).where(
            and_(
                CashDrawerSession.time_entry_id == time_entry_id,
                CashDrawerSession.company_id == company_id,
            )
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cash drawer session not found for this time entry",
        )
    
    if session.status != CashDrawerStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot close cash drawer session with status {session.status}",
        )
    
    # Store old values for audit
    old_values = {
        "end_cash_cents": session.end_cash_cents,
        "delta_cents": session.delta_cents,
        "status": session.status.value,
    }
    
    # Update session
    session.end_cash_cents = end_cash_cents
    session.end_counted_at = datetime.utcnow()
    session.end_count_source = source
    
    # Store collected cash if provided
    if collected_cash_cents is not None:
        if collected_cash_cents < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Room sale amount cannot be negative",
            )
        session.collected_cash_cents = collected_cash_cents

    # Marketplace sales total: from recorded counts when items configured; else optional client amount
    from app.services.marketplace_service import marketplace_total_cents, normalize_sales
    from sqlalchemy.orm.attributes import flag_modified

    sales = normalize_sales(getattr(session, "marketplace_sales_json", None))
    company = (
        await db.execute(select(Company).where(Company.id == company_id))
    ).scalar_one_or_none()
    catalog = get_company_settings(company).get("marketplace_items") or [] if company else []

    if catalog or sales:
        session.marketplace_sales_json = sales
        flag_modified(session, "marketplace_sales_json")
        session.beverages_cash_cents = marketplace_total_cents(sales)
    elif beverages_cash_cents is not None:
        if beverages_cash_cents < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Marketplace sales amount cannot be negative",
            )
        session.beverages_cash_cents = beverages_cash_cents

    # Discard any unpaid cart when the drawer closes
    if getattr(session, "marketplace_cart_json", None):
        session.marketplace_cart_json = []
        flag_modified(session, "marketplace_cart_json")
    
    if drop_amount_cents is not None:
        if drop_amount_cents < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Drop amount cannot be negative",
            )
        session.drop_amount_cents = drop_amount_cents
    
    # Calculate delta
    session.delta_cents = end_cash_cents - session.start_cash_cents
    
    # Determine status: review only if end balance differs from initial balance
    # If end balance equals initial balance, just log it (CLOSED)
    # If end balance differs from initial balance, mark for review
    if session.delta_cents != 0:
        session.status = CashDrawerStatus.REVIEW_NEEDED
    else:
        session.status = CashDrawerStatus.CLOSED
    
    new_values = {
        "end_cash_cents": end_cash_cents,
        "delta_cents": session.delta_cents,
        "status": session.status.value,
    }
    
    # Create audit log
    audit = CashDrawerAudit(
        company_id=company_id,
        cash_drawer_session_id=session.id,
        actor_user_id=session.employee_id,
        action=CashDrawerAuditAction.SET_END,
        old_values_json=old_values,
        new_values_json=new_values,
    )
    db.add(audit)
    
    # Create audit log entry
    audit_log = AuditLog(
        company_id=company_id,
        actor_user_id=session.employee_id,
        action="CASH_DRAWER_SET_END",
        entity_type="cash_drawer_session",
        entity_id=session.id,
        metadata_json={
            "end_cash_cents": end_cash_cents,
            "delta_cents": session.delta_cents,
            "status": session.status.value,
            "time_entry_id": str(time_entry_id),
        },
    )
    db.add(audit_log)
    
    # Use flush instead of commit to allow caller to manage transaction
    await db.flush()
    return session


# Shown in admin Drawer log until an admin reviews and closes the session
FORGOT_PUNCH_OUT_REVIEW_NOTE = "This employee forgot to punch out please review."


async def force_deactivate_cash_drawer_for_auto_clock_out(
    db: AsyncSession,
    session: CashDrawerSession,
) -> CashDrawerSession:
    """
    Deactivate an OPEN cash drawer when auto clock-out runs without an end count.
    Leaves ending cash unset, marks REVIEW_NEEDED, and sets the forgot-punch review note.
    """
    if session.status != CashDrawerStatus.OPEN:
        return session

    from app.services.marketplace_service import marketplace_total_cents, normalize_sales
    from sqlalchemy.orm.attributes import flag_modified

    old_values = {
        "end_cash_cents": session.end_cash_cents,
        "delta_cents": session.delta_cents,
        "status": session.status.value if hasattr(session.status, "value") else str(session.status),
        "review_note": session.review_note,
    }

    # Do not invent ending cash — admin must review
    session.end_cash_cents = None
    session.end_counted_at = datetime.utcnow()
    session.end_count_source = CashCountSource.WEB
    session.delta_cents = None
    session.status = CashDrawerStatus.REVIEW_NEEDED
    session.review_note = FORGOT_PUNCH_OUT_REVIEW_NOTE
    session.reviewed_by = None
    session.reviewed_at = None

    sales = normalize_sales(getattr(session, "marketplace_sales_json", None))
    if sales:
        session.marketplace_sales_json = sales
        flag_modified(session, "marketplace_sales_json")
        session.beverages_cash_cents = marketplace_total_cents(sales)

    new_values = {
        "end_cash_cents": session.end_cash_cents,
        "delta_cents": session.delta_cents,
        "status": session.status.value,
        "review_note": session.review_note,
        "beverages_cash_cents": session.beverages_cash_cents,
    }

    audit = CashDrawerAudit(
        company_id=session.company_id,
        cash_drawer_session_id=session.id,
        actor_user_id=session.employee_id,
        action=CashDrawerAuditAction.SET_END,
        old_values_json=old_values,
        new_values_json=new_values,
        reason=FORGOT_PUNCH_OUT_REVIEW_NOTE,
    )
    db.add(audit)

    audit_log = AuditLog(
        company_id=session.company_id,
        actor_user_id=session.employee_id,
        action="CASH_DRAWER_AUTO_FORCE_CLOSE",
        entity_type="cash_drawer_session",
        entity_id=session.id,
        metadata_json={
            "status": session.status.value,
            "review_note": session.review_note,
            "time_entry_id": str(session.time_entry_id),
            "reason": "auto_clock_out_forgot_punch",
        },
    )
    db.add(audit_log)

    await db.flush()
    return session


async def edit_cash_drawer_session(
    db: AsyncSession,
    company_id: UUID,
    session_id: UUID,
    actor_user_id: UUID,
    start_cash_cents: Optional[int] = None,
    end_cash_cents: Optional[int] = None,
    reason: str = "",
) -> CashDrawerSession:
    """Edit cash drawer session (admin only)."""
    # Get company settings
    result = await db.execute(select(Company).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found",
        )
    
    company_settings = get_company_settings(company)
    if not company_settings.get("cash_drawer_allow_edit", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cash drawer editing is not allowed",
        )
    
    # Get session
    result = await db.execute(
        select(CashDrawerSession).where(
            and_(
                CashDrawerSession.id == session_id,
                CashDrawerSession.company_id == company_id,
            )
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cash drawer session not found",
        )
    
    if not reason or len(reason.strip()) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reason is required for editing cash drawer session",
        )
    
    # Store old values
    old_values = {
        "start_cash_cents": session.start_cash_cents,
        "end_cash_cents": session.end_cash_cents,
        "delta_cents": session.delta_cents,
    }
    
    # Update values
    action = None
    if start_cash_cents is not None:
        if start_cash_cents < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Start cash amount cannot be negative",
            )
        session.start_cash_cents = start_cash_cents
        action = CashDrawerAuditAction.EDIT_START
    
    if end_cash_cents is not None:
        if end_cash_cents < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="End cash amount cannot be negative",
            )
        session.end_cash_cents = end_cash_cents
        if action is None:
            action = CashDrawerAuditAction.EDIT_END
    
    # Recalculate delta if either value changed
    if start_cash_cents is not None or end_cash_cents is not None:
        if session.end_cash_cents is not None:
            session.delta_cents = session.end_cash_cents - session.start_cash_cents
            
            # Determine status: review only if end balance differs from initial balance
            if session.delta_cents != 0:
                session.status = CashDrawerStatus.REVIEW_NEEDED
            else:
                session.status = CashDrawerStatus.CLOSED
    
    new_values = {
        "start_cash_cents": session.start_cash_cents,
        "end_cash_cents": session.end_cash_cents,
        "delta_cents": session.delta_cents,
        "status": session.status.value,
    }
    
    # Create audit log
    if action:
        audit = CashDrawerAudit(
            company_id=company_id,
            cash_drawer_session_id=session.id,
            actor_user_id=actor_user_id,
            action=action,
            old_values_json=old_values,
            new_values_json=new_values,
            reason=reason,
        )
        db.add(audit)
        
        # Create audit log entry
        audit_log = AuditLog(
            company_id=company_id,
            actor_user_id=actor_user_id,
            action=f"CASH_DRAWER_{action.value}",
            entity_type="cash_drawer_session",
            entity_id=session.id,
            metadata_json={
                "old_values": old_values,
                "new_values": new_values,
                "reason": reason,
            },
        )
        db.add(audit_log)
    
    # Use flush instead of commit to allow caller to manage transaction
    await db.flush()
    return session


async def review_cash_drawer_session(
    db: AsyncSession,
    company_id: UUID,
    session_id: UUID,
    reviewer_id: UUID,
    note: Optional[str] = None,
    new_status: CashDrawerStatus = CashDrawerStatus.CLOSED,
) -> CashDrawerSession:
    """Review and update status of cash drawer session."""
    # Get session
    result = await db.execute(
        select(CashDrawerSession).where(
            and_(
                CashDrawerSession.id == session_id,
                CashDrawerSession.company_id == company_id,
            )
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cash drawer session not found",
        )
    
    # Get old status value before any modifications
    old_status_value = session.status.value if hasattr(session.status, 'value') else str(session.status)
    
    # Update review
    session.reviewed_by = reviewer_id
    session.reviewed_at = datetime.utcnow()
    session.review_note = note
    session.status = new_status
    
    # Get new status value
    new_status_value = new_status.value if hasattr(new_status, 'value') else str(new_status)
    
    # Create audit log
    audit = CashDrawerAudit(
        company_id=company_id,
        cash_drawer_session_id=session.id,
        actor_user_id=reviewer_id,
        action=CashDrawerAuditAction.REVIEW,
        old_values_json={"status": old_status_value},
        new_values_json={"status": new_status_value, "note": note},
        reason=note or "Reviewed by admin",
    )
    db.add(audit)
    
    # Create audit log entry
    audit_log = AuditLog(
        company_id=company_id,
        actor_user_id=reviewer_id,
        action="CASH_DRAWER_REVIEW",
        entity_type="cash_drawer_session",
        entity_id=session.id,
        metadata_json={
            "old_status": old_status_value,
            "new_status": new_status_value,
            "note": note,
        },
    )
    db.add(audit_log)
    
    # Use flush instead of commit to allow caller to manage transaction
    await db.flush()
    
    return session


async def verify_cash_drawer_session(
    db: AsyncSession,
    company_id: UUID,
    session_id: UUID,
    verifier_id: UUID,
    note: Optional[str] = None,
) -> CashDrawerSession:
    """Verify Drop & Sales for a finished cash drawer session (weekly admin check)."""
    result = await db.execute(
        select(CashDrawerSession).where(
            and_(
                CashDrawerSession.id == session_id,
                CashDrawerSession.company_id == company_id,
            )
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cash drawer session not found",
        )

    if session.status == CashDrawerStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot verify an open cash drawer session",
        )

    if session.verified_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cash drawer session is already verified",
        )

    old_status_value = session.status.value if hasattr(session.status, "value") else str(session.status)
    now = datetime.utcnow()

    session.verified_by = verifier_id
    session.verified_at = now

    closed_from_review = False
    if session.status == CashDrawerStatus.REVIEW_NEEDED:
        session.status = CashDrawerStatus.CLOSED
        session.reviewed_by = verifier_id
        session.reviewed_at = now
        if note:
            session.review_note = note
        closed_from_review = True

    new_status_value = session.status.value if hasattr(session.status, "value") else str(session.status)

    audit = CashDrawerAudit(
        company_id=company_id,
        cash_drawer_session_id=session.id,
        actor_user_id=verifier_id,
        action=CashDrawerAuditAction.VERIFY,
        old_values_json={
            "status": old_status_value,
            "verified_at": None,
            "drop_amount_cents": session.drop_amount_cents,
            "beverages_cash_cents": session.beverages_cash_cents,
        },
        new_values_json={
            "status": new_status_value,
            "verified_at": now.isoformat(),
            "note": note,
            "drop_amount_cents": session.drop_amount_cents,
            "beverages_cash_cents": session.beverages_cash_cents,
        },
        reason=note or "Verified Drop & Sales",
    )
    db.add(audit)

    if closed_from_review:
        review_audit = CashDrawerAudit(
            company_id=company_id,
            cash_drawer_session_id=session.id,
            actor_user_id=verifier_id,
            action=CashDrawerAuditAction.REVIEW,
            old_values_json={"status": old_status_value},
            new_values_json={"status": new_status_value, "note": note},
            reason=note or "Closed via weekly verification",
        )
        db.add(review_audit)

    audit_log = AuditLog(
        company_id=company_id,
        actor_user_id=verifier_id,
        action="CASH_DRAWER_VERIFY",
        entity_type="cash_drawer_session",
        entity_id=session.id,
        metadata_json={
            "old_status": old_status_value,
            "new_status": new_status_value,
            "note": note,
            "drop_amount_cents": session.drop_amount_cents,
            "beverages_cash_cents": session.beverages_cash_cents,
            "closed_from_review": closed_from_review,
        },
    )
    db.add(audit_log)

    await db.flush()
    return session


async def get_cash_drawer_session(
    db: AsyncSession,
    company_id: UUID,
    session_id: UUID,
) -> Optional[CashDrawerSession]:
    """Get cash drawer session by ID."""
    result = await db.execute(
        select(CashDrawerSession).where(
            and_(
                CashDrawerSession.id == session_id,
                CashDrawerSession.company_id == company_id,
            )
        )
    )
    return result.scalar_one_or_none()


async def get_cash_drawer_sessions(
    db: AsyncSession,
    company_id: UUID,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    employee_id: Optional[UUID] = None,
    status_filter: Optional[CashDrawerStatus] = None,
    limit: int = 100,
    offset: int = 0,
    verified: Optional[bool] = None,
) -> tuple[List[CashDrawerSession], int]:
    """Get cash drawer sessions with filters."""
    query = select(CashDrawerSession).where(CashDrawerSession.company_id == company_id)
    
    if from_date:
        query = query.where(CashDrawerSession.start_counted_at >= datetime.combine(from_date, datetime.min.time()))
    
    if to_date:
        query = query.where(CashDrawerSession.start_counted_at <= datetime.combine(to_date, datetime.max.time()))
    
    if employee_id:
        query = query.where(CashDrawerSession.employee_id == employee_id)
    
    if status_filter:
        query = query.where(CashDrawerSession.status == status_filter)

    if verified is True:
        query = query.where(CashDrawerSession.verified_at.isnot(None))
    elif verified is False:
        # Finished sessions awaiting weekly Drop & Sales verification
        query = query.where(
            and_(
                CashDrawerSession.status != CashDrawerStatus.OPEN,
                CashDrawerSession.verified_at.is_(None),
            )
        )
    
    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0
    
    # Get paginated results
    query = query.order_by(CashDrawerSession.start_counted_at.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    sessions = result.scalars().all()
    
    return list(sessions), total


async def get_cash_drawer_summary(
    db: AsyncSession,
    company_id: UUID,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    employee_id: Optional[UUID] = None,
) -> Dict:
    """Get cash drawer summary statistics."""
    query = select(CashDrawerSession).where(CashDrawerSession.company_id == company_id)
    
    if from_date:
        query = query.where(CashDrawerSession.start_counted_at >= datetime.combine(from_date, datetime.min.time()))
    
    if to_date:
        query = query.where(CashDrawerSession.start_counted_at <= datetime.combine(to_date, datetime.max.time()))
    
    if employee_id:
        query = query.where(CashDrawerSession.employee_id == employee_id)
    
    query = query.where(CashDrawerSession.end_cash_cents.isnot(None))
    result = await db.execute(query)
    sessions = result.scalars().all()
    
    total_sessions = len(sessions)
    total_delta = sum(s.delta_cents or 0 for s in sessions)
    average_delta = total_delta / total_sessions if total_sessions > 0 else 0
    review_needed = sum(1 for s in sessions if s.status == CashDrawerStatus.REVIEW_NEEDED)
    
    # Per employee totals
    employee_totals = {}
    for session in sessions:
        emp_id = str(session.employee_id)
        if emp_id not in employee_totals:
            employee_totals[emp_id] = {
                "employee_id": emp_id,
                "employee_name": "",  # Will be populated if needed
                "total_delta_cents": 0,
                "session_count": 0,
            }
        employee_totals[emp_id]["total_delta_cents"] += session.delta_cents or 0
        employee_totals[emp_id]["session_count"] += 1
    
    return {
        "total_sessions": total_sessions,
        "total_delta_cents": total_delta,
        "average_delta_cents": average_delta,
        "review_needed_count": review_needed,
        "employee_totals": list(employee_totals.values()),
    }


async def delete_cash_drawer_session(
    db: AsyncSession,
    company_id: UUID,
    session_id: UUID,
    actor_user_id: UUID,
) -> None:
    """Delete a cash drawer session and its audit logs."""
    # Get session
    result = await db.execute(
        select(CashDrawerSession).where(
            and_(
                CashDrawerSession.id == session_id,
                CashDrawerSession.company_id == company_id,
            )
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cash drawer session not found",
        )
    
    # Create audit log entry before deletion
    from app.models.audit_log import AuditLog
    audit_log = AuditLog(
        company_id=company_id,
        actor_user_id=actor_user_id,
        action="CASH_DRAWER_DELETE",
        entity_type="cash_drawer_session",
        entity_id=session.id,
        metadata_json={
            "session_id": str(session.id),
            "employee_id": str(session.employee_id),
            "time_entry_id": str(session.time_entry_id),
            "start_cash_cents": session.start_cash_cents,
            "end_cash_cents": session.end_cash_cents,
            "status": session.status.value if hasattr(session.status, 'value') else str(session.status),
        },
    )
    db.add(audit_log)
    await db.flush()  # Flush audit log first
    
    # Delete cash drawer audit logs first (they reference the session)
    await db.execute(delete(CashDrawerAudit).where(CashDrawerAudit.cash_drawer_session_id == session_id))
    
    # Delete the session
    await db.execute(delete(CashDrawerSession).where(CashDrawerSession.id == session_id))
    
    # Use flush instead of commit to allow caller to manage transaction
    await db.flush()
