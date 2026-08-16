"""Admin notification feed: leave, missing punch, recent clock in/out."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cash_drawer import CashDrawerSession, CashDrawerStatus
from app.models.leave_request import LeaveRequest, LeaveStatus
from app.models.time_entry import TimeEntry, TimeEntryStatus
from app.models.user import User
from app.services.cash_drawer_service import FORGOT_PUNCH_OUT_REVIEW_NOTE

_FORGOT_PUNCH_MARKER = "forgot to punch out"
_AUTO_CLOCK_OUT_MARKER = "Auto clock-out"
_ACTIVITY_HOURS = 24
_LIST_LIMIT = 40


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _item(
    *,
    id: str,
    type: str,
    title: str,
    employee_name: str,
    href: str,
    created_at: Optional[datetime],
    message: Optional[str] = None,
    actionable: bool = False,
    employee_id: Optional[UUID] = None,
) -> Dict[str, Any]:
    return {
        "id": id,
        "type": type,
        "title": title,
        "message": message,
        "employee_name": employee_name,
        "employee_id": str(employee_id) if employee_id else None,
        "href": href,
        "created_at": _iso(created_at),
        "actionable": actionable,
    }


async def get_admin_unread_count(
    db: AsyncSession,
    company_id: UUID,
    *,
    since: Optional[datetime] = None,
) -> int:
    """Count items that need admin attention (leave + missing punch reviews)."""
    leave_filters = [
        LeaveRequest.company_id == company_id,
        LeaveRequest.status == LeaveStatus.PENDING,
    ]
    if since is not None:
        leave_filters.append(LeaveRequest.created_at > since)

    leave_count = (
        await db.execute(select(func.count()).select_from(LeaveRequest).where(and_(*leave_filters)))
    ).scalar_one()

    drawer_filters = [
        CashDrawerSession.company_id == company_id,
        CashDrawerSession.status == CashDrawerStatus.REVIEW_NEEDED,
        CashDrawerSession.review_note.isnot(None),
        CashDrawerSession.review_note.ilike(f"%{_FORGOT_PUNCH_MARKER}%"),
    ]
    if since is not None:
        drawer_filters.append(
            func.coalesce(CashDrawerSession.updated_at, CashDrawerSession.created_at) > since
        )

    forgot_drawer = (
        await db.execute(
            select(func.count()).select_from(CashDrawerSession).where(and_(*drawer_filters))
        )
    ).scalar_one()

    return int(leave_count or 0) + int(forgot_drawer or 0)


async def get_admin_notifications(
    db: AsyncSession,
    company_id: UUID,
    *,
    limit: int = _LIST_LIMIT,
) -> List[Dict[str, Any]]:
    """Build a merged, newest-first notification list for company admins."""
    items: List[Dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    activity_since = now - timedelta(hours=_ACTIVITY_HOURS)
    week_since = now - timedelta(days=7)

    # Pending leave
    leave_rows = (
        await db.execute(
            select(LeaveRequest, User.name)
            .outerjoin(User, User.id == LeaveRequest.employee_id)
            .where(
                and_(
                    LeaveRequest.company_id == company_id,
                    LeaveRequest.status == LeaveStatus.PENDING,
                )
            )
            .order_by(LeaveRequest.created_at.desc())
            .limit(20)
        )
    ).all()
    for req, name in leave_rows:
        leave_type = req.type.value if hasattr(req.type, "value") else str(req.type)
        items.append(
            _item(
                id=f"leave-{req.id}",
                type="leave_pending",
                title="Leave request",
                message=f"{leave_type.replace('_', ' ').title()} · {req.start_date} – {req.end_date}",
                employee_name=name or "Employee",
                employee_id=req.employee_id,
                href="/leave-requests",
                created_at=req.created_at,
                actionable=True,
            )
        )

    # Missing punch (drawer auto-closed)
    drawer_rows = (
        await db.execute(
            select(CashDrawerSession, User.name)
            .outerjoin(User, User.id == CashDrawerSession.employee_id)
            .where(
                and_(
                    CashDrawerSession.company_id == company_id,
                    CashDrawerSession.status == CashDrawerStatus.REVIEW_NEEDED,
                    CashDrawerSession.review_note.isnot(None),
                    CashDrawerSession.review_note.ilike(f"%{_FORGOT_PUNCH_MARKER}%"),
                )
            )
            .order_by(CashDrawerSession.updated_at.desc())
            .limit(20)
        )
    ).all()
    drawer_time_entry_ids = set()
    for session, name in drawer_rows:
        drawer_time_entry_ids.add(session.time_entry_id)
        items.append(
            _item(
                id=f"forgot-{session.id}",
                type="missing_punch",
                title="Missing punch-out",
                message=session.review_note or FORGOT_PUNCH_OUT_REVIEW_NOTE,
                employee_name=name or "Employee",
                employee_id=session.employee_id,
                href="/admin/shift-log",
                created_at=session.updated_at or session.created_at,
                actionable=True,
            )
        )

    # Missing punch (auto clock-out without drawer review flag)
    auto_rows = (
        await db.execute(
            select(TimeEntry, User.name)
            .outerjoin(User, User.id == TimeEntry.employee_id)
            .where(
                and_(
                    TimeEntry.company_id == company_id,
                    TimeEntry.clock_out_at.isnot(None),
                    TimeEntry.clock_out_at >= week_since,
                    TimeEntry.note.isnot(None),
                    TimeEntry.note.ilike(f"%{_AUTO_CLOCK_OUT_MARKER}%"),
                )
            )
            .order_by(TimeEntry.clock_out_at.desc())
            .limit(20)
        )
    ).all()
    for entry, name in auto_rows:
        if entry.id in drawer_time_entry_ids:
            continue
        items.append(
            _item(
                id=f"auto-out-{entry.id}",
                type="missing_punch",
                title="Missing punch-out",
                message="Auto clocked out at scheduled end",
                employee_name=name or "Employee",
                employee_id=entry.employee_id,
                href="/time-entries",
                created_at=entry.clock_out_at or entry.updated_at,
                actionable=False,
            )
        )

    # Recent clock-ins (still open or recently started)
    clock_in_rows = (
        await db.execute(
            select(TimeEntry, User.name)
            .outerjoin(User, User.id == TimeEntry.employee_id)
            .where(
                and_(
                    TimeEntry.company_id == company_id,
                    TimeEntry.clock_in_at >= activity_since,
                )
            )
            .order_by(TimeEntry.clock_in_at.desc())
            .limit(15)
        )
    ).all()
    for entry, name in clock_in_rows:
        items.append(
            _item(
                id=f"in-{entry.id}",
                type="clock_in",
                title="Clocked in",
                employee_name=name or "Employee",
                employee_id=entry.employee_id,
                href="/time-entries",
                created_at=entry.clock_in_at,
                actionable=False,
            )
        )

    # Recent clock-outs (exclude auto clock-out already listed as missing punch)
    clock_out_rows = (
        await db.execute(
            select(TimeEntry, User.name)
            .outerjoin(User, User.id == TimeEntry.employee_id)
            .where(
                and_(
                    TimeEntry.company_id == company_id,
                    TimeEntry.clock_out_at.isnot(None),
                    TimeEntry.clock_out_at >= activity_since,
                    TimeEntry.status.in_(
                        [TimeEntryStatus.CLOSED, TimeEntryStatus.EDITED, TimeEntryStatus.APPROVED]
                    ),
                    or_(
                        TimeEntry.note.is_(None),
                        ~TimeEntry.note.ilike(f"%{_AUTO_CLOCK_OUT_MARKER}%"),
                    ),
                )
            )
            .order_by(TimeEntry.clock_out_at.desc())
            .limit(15)
        )
    ).all()
    for entry, name in clock_out_rows:
        items.append(
            _item(
                id=f"out-{entry.id}",
                type="clock_out",
                title="Clocked out",
                employee_name=name or "Employee",
                employee_id=entry.employee_id,
                href="/time-entries",
                created_at=entry.clock_out_at,
                actionable=False,
            )
        )

    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return items[: max(1, min(limit, 100))]


async def get_employee_auto_clock_out_notifications(
    db: AsyncSession,
    *,
    company_id: UUID,
    employee_id: UUID,
    limit: int = _LIST_LIMIT,
) -> List[Dict[str, Any]]:
    """Notify the employee about their own recent auto clock-outs."""
    week_since = datetime.now(timezone.utc) - timedelta(days=7)
    rows = (
        await db.execute(
            select(TimeEntry)
            .where(
                and_(
                    TimeEntry.company_id == company_id,
                    TimeEntry.employee_id == employee_id,
                    TimeEntry.clock_out_at.isnot(None),
                    TimeEntry.clock_out_at >= week_since,
                    TimeEntry.note.isnot(None),
                    TimeEntry.note.ilike(f"%{_AUTO_CLOCK_OUT_MARKER}%"),
                )
            )
            .order_by(TimeEntry.clock_out_at.desc())
            .limit(max(1, min(limit, 40)))
        )
    ).scalars().all()

    if not rows:
        return []

    entry_ids = [e.id for e in rows]
    reviewed_entry_ids = set(
        (
            await db.execute(
                select(CashDrawerSession.time_entry_id).where(
                    and_(
                        CashDrawerSession.time_entry_id.in_(entry_ids),
                        CashDrawerSession.status == CashDrawerStatus.REVIEW_NEEDED,
                        CashDrawerSession.review_note.ilike(f"%{_FORGOT_PUNCH_MARKER}%"),
                    )
                )
            )
        ).scalars().all()
    )

    items: List[Dict[str, Any]] = []
    for entry in rows:
        message = (
            "You were auto clocked out. Your cash drawer needs admin review."
            if entry.id in reviewed_entry_ids
            else "You were clocked out at your scheduled end time."
        )
        items.append(
            _item(
                id=f"my-auto-out-{entry.id}",
                type="auto_clock_out",
                title="Auto clocked out",
                message=message,
                employee_name="You",
                employee_id=employee_id,
                href="/my-schedule",
                created_at=entry.clock_out_at or entry.updated_at,
                actionable=True,
            )
        )
    return items


async def get_employee_unread_count(
    db: AsyncSession,
    *,
    company_id: UUID,
    employee_id: UUID,
    since: Optional[datetime] = None,
) -> int:
    week_since = datetime.now(timezone.utc) - timedelta(days=7)
    lower = week_since
    if since is not None and since > week_since:
        lower = since
    count = (
        await db.execute(
            select(func.count())
            .select_from(TimeEntry)
            .where(
                and_(
                    TimeEntry.company_id == company_id,
                    TimeEntry.employee_id == employee_id,
                    TimeEntry.clock_out_at.isnot(None),
                    TimeEntry.clock_out_at > lower,
                    TimeEntry.note.isnot(None),
                    TimeEntry.note.ilike(f"%{_AUTO_CLOCK_OUT_MARKER}%"),
                )
            )
        )
    ).scalar_one()
    return int(count or 0)
