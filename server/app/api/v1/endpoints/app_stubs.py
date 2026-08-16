from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
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
    if current_user.role == UserRole.ADMIN:
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

    if current_user.role == UserRole.ADMIN:
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


@feedback_router.post("")
async def submit_feedback(
    body: FeedbackBody,
    current_user: User = Depends(get_current_active_user),
):
    return {"ok": True}
