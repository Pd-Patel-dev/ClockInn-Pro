from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_active_user, get_db
from app.models.user import User, UserRole
from app.services.notification_service import (
    get_admin_notifications,
    get_admin_unread_count,
    get_employee_auto_clock_out_notifications,
    get_employee_unread_count,
)

notifications_router = APIRouter()
feedback_router = APIRouter()


def _parse_since(since: str | None) -> datetime | None:
    if not since:
        return None
    try:
        dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


@notifications_router.get("/unread-count")
async def notifications_unread_count(
    since: str | None = Query(None, description="ISO timestamp; only count items newer than this"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Unread count: admin action items, or employee auto clock-outs."""
    if not current_user.company_id:
        return {"count": 0}
    since_dt = _parse_since(since)
    if current_user.role in (UserRole.ADMIN, UserRole.MANAGER):
        count = await get_admin_unread_count(db, current_user.company_id, since=since_dt)
        return {"count": count}
    if current_user.role == UserRole.DEVELOPER:
        return {"count": 0}
    count = await get_employee_unread_count(
        db,
        company_id=current_user.company_id,
        employee_id=current_user.id,
        since=since_dt,
    )
    return {"count": count}


@notifications_router.get("")
async def list_notifications(
    limit: int = Query(40, ge=1, le=100),
    type: str | None = Query(
        None,
        description="Optional filter: leave_pending, missing_punch, clock_in, clock_out, auto_clock_out",
    ),
    since: str | None = Query(None, description="ISO timestamp for unread_count only"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin feed or employee auto clock-out notifications."""
    if not current_user.company_id:
        return {"items": [], "unread_count": 0}

    since_dt = _parse_since(since)

    if current_user.role in (UserRole.ADMIN, UserRole.MANAGER):
        items = await get_admin_notifications(db, current_user.company_id, limit=limit)
        if type:
            allowed = {type, "forgot_punch_out"} if type == "missing_punch" else {type}
            items = [i for i in items if i.get("type") in allowed]
        unread = await get_admin_unread_count(db, current_user.company_id, since=since_dt)
        return {"items": items, "unread_count": unread}

    if current_user.role == UserRole.DEVELOPER:
        return {"items": [], "unread_count": 0}

    items = await get_employee_auto_clock_out_notifications(
        db,
        company_id=current_user.company_id,
        employee_id=current_user.id,
        limit=limit,
    )
    if type and type not in ("auto_clock_out", "missing_punch", "forgot_punch_out"):
        items = []
    unread = await get_employee_unread_count(
        db,
        company_id=current_user.company_id,
        employee_id=current_user.id,
        since=since_dt,
    )
    return {"items": items, "unread_count": unread}


class FeedbackBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)
    type: str | None = Field(None, max_length=32)
    page_path: str | None = Field(None, max_length=500)


@feedback_router.post("")
async def submit_feedback(
    body: FeedbackBody,
    request: Request,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.company import Company
    from app.models.support_ticket import SupportTicket, SupportTicketType, SupportTicketStatus

    raw_type = (body.type or "support").strip().lower()
    allowed = {t.value for t in SupportTicketType}
    ticket_type = raw_type if raw_type in allowed else SupportTicketType.SUPPORT.value

    company_name = None
    if current_user.company_id:
        result = await db.execute(select(Company.name).where(Company.id == current_user.company_id))
        company_name = result.scalar_one_or_none()

    ua = request.headers.get("user-agent") or request.headers.get("User-Agent")
    if ua and len(ua) > 500:
        ua = ua[:500]

    ip = None
    forwarded = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if forwarded:
        ip = forwarded.split(",")[0].strip()[:64]
    elif request.client and request.client.host:
        ip = request.client.host[:64]

    page_path = (body.page_path or "").strip() or None
    if page_path and len(page_path) > 500:
        page_path = page_path[:500]

    ticket = SupportTicket(
        user_id=current_user.id,
        company_id=current_user.company_id,
        type=ticket_type,
        status=SupportTicketStatus.OPEN.value,
        message=body.message.strip(),
        user_name=current_user.name,
        user_email=current_user.email,
        user_role=current_user.role.value if current_user.role else None,
        company_name=company_name,
        page_path=page_path,
        user_agent=ua,
        ip_address=ip,
    )
    db.add(ticket)
    await db.commit()
    await db.refresh(ticket)
    return {"ok": True, "id": str(ticket.id)}

