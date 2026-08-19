"""Persist and query outbound email delivery attempts."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import normalize_email
from app.models.company import Company
from app.models.email_delivery_log import EmailDeliveryLog, EmailDeliveryStatus
from app.models.user import User, UserRole, UserStatus

logger = logging.getLogger(__name__)

EMAIL_TYPE_LABELS: Dict[str, str] = {
    "verify_email": "Email verification",
    "verification_reminder": "Verification reminder",
    "password_setup": "Password setup",
    "password_reset": "Password reset",
    "password_reset_otp": "Password reset code",
    "leave_request_notification": "Leave request",
    "leave_request_response": "Leave response",
    "schedule_notification": "Schedule notification",
    "punch_violation_warning": "Punch violation warning",
    "shift_summary": "Shift summary",
    "auto_clock_out": "Auto clock-out",
    "auto_clock_out_cash_reminder": "Auto clock-out cash reminder",
    "payroll_generate_reminder": "Payroll generate reminder",
}


def email_type_label(template_key: Optional[str]) -> str:
    if not template_key:
        return "Other"
    return EMAIL_TYPE_LABELS.get(template_key, template_key.replace("_", " ").title())


def _serialize_log(r: EmailDeliveryLog) -> Dict[str, Any]:
    return {
        "id": str(r.id),
        "to_email": r.to_email,
        "from_email": getattr(r, "from_email", None),
        "subject": r.subject,
        "template_key": r.template_key,
        "email_type": email_type_label(r.template_key),
        "kind": r.kind,
        "status": r.status,
        "provider_message_id": r.provider_message_id,
        "error_message": r.error_message,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


async def _enrich_recipient_context(db: AsyncSession, to_email: str) -> Dict[str, Any]:
    """Resolve receiver + company + admins from the recipient address when possible."""
    context: Dict[str, Any] = {
        "receiver_email": to_email,
        "receiver_name": None,
        "receiver_role": None,
        "company_id": None,
        "company_name": None,
        "company_slug": None,
        "admins": [],
    }
    if not to_email or not str(to_email).strip():
        return context

    normalized = normalize_email(to_email)
    user = (
        await db.execute(select(User).where(User.email == normalized))
    ).scalar_one_or_none()
    if not user:
        user = (
            await db.execute(select(User).where(func.lower(User.email) == normalized.lower()))
        ).scalar_one_or_none()
    if not user:
        return context

    context["receiver_name"] = user.name
    context["receiver_role"] = (
        user.role.value if hasattr(user.role, "value") else str(user.role)
    )
    if not user.company_id:
        return context

    company = (
        await db.execute(select(Company).where(Company.id == user.company_id))
    ).scalar_one_or_none()
    if company:
        context["company_id"] = str(company.id)
        context["company_name"] = company.name
        context["company_slug"] = company.slug

    admins = (
        await db.execute(
            select(User)
            .where(
                User.company_id == user.company_id,
                User.role == UserRole.ADMIN,
                User.status == UserStatus.ACTIVE,
            )
            .order_by(User.name.asc())
        )
    ).scalars().all()
    context["admins"] = [
        {
            "name": a.name,
            "email": a.email,
            "role": a.role.value if hasattr(a.role, "value") else str(a.role),
        }
        for a in admins
        if a.email
    ]
    return context


async def record_email_delivery(
    *,
    to_email: str,
    status: str,
    subject: Optional[str] = None,
    template_key: Optional[str] = None,
    kind: str = "transactional",
    provider_message_id: Optional[str] = None,
    error_message: Optional[str] = None,
    from_email: Optional[str] = None,
    db: Optional[AsyncSession] = None,
) -> None:
    """
    Append a delivery log row. Never raises to the caller — logging must not break sends.
    Opens its own session when db is not provided.
    """
    try:
        row = EmailDeliveryLog(
            id=uuid.uuid4(),
            to_email=(to_email or "")[:320],
            from_email=str(from_email)[:320] if from_email else None,
            subject=str(subject)[:500] if subject else None,
            template_key=str(template_key)[:100] if template_key else None,
            kind=(kind or "transactional")[:40],
            status=status[:20],
            provider_message_id=str(provider_message_id)[:255] if provider_message_id else None,
            error_message=str(error_message)[:4000] if error_message else None,
        )
        if db is not None:
            db.add(row)
            await db.flush()
            return

        from app.core.database import AsyncSessionLocal

        async with AsyncSessionLocal() as session:
            session.add(row)
            await session.commit()
    except Exception as e:
        logger.warning("Failed to record email delivery log: %s", e)


async def list_email_delivery_logs(
    db: AsyncSession,
    *,
    limit: int = 100,
    offset: int = 0,
    status: Optional[str] = None,
    q: Optional[str] = None,
    template_key: Optional[str] = None,
) -> Dict[str, Any]:
    limit = max(1, min(limit, 500))
    offset = max(0, offset)

    filters = []
    if status:
        filters.append(EmailDeliveryLog.status == status)
    if template_key:
        filters.append(EmailDeliveryLog.template_key == template_key)
    if q:
        like = f"%{q.strip()}%"
        filters.append(
            or_(EmailDeliveryLog.to_email.ilike(like), EmailDeliveryLog.subject.ilike(like))
        )

    count_q = select(func.count()).select_from(EmailDeliveryLog)
    items_q = select(EmailDeliveryLog).order_by(EmailDeliveryLog.created_at.desc())
    if filters:
        for f in filters:
            count_q = count_q.where(f)
            items_q = items_q.where(f)

    total = int((await db.execute(count_q)).scalar() or 0)
    rows = (await db.execute(items_q.offset(offset).limit(limit))).scalars().all()

    since = datetime.now(timezone.utc) - timedelta(hours=24)
    stats_q = (
        select(EmailDeliveryLog.status, func.count())
        .where(EmailDeliveryLog.created_at >= since)
        .group_by(EmailDeliveryLog.status)
    )
    stats_rows = (await db.execute(stats_q)).all()
    last_24h = {
        EmailDeliveryStatus.SENT.value: 0,
        EmailDeliveryStatus.FAILED.value: 0,
        EmailDeliveryStatus.SKIPPED.value: 0,
    }
    for st, cnt in stats_rows:
        last_24h[str(st)] = int(cnt)

    return {
        "items": [_serialize_log(r) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
        "stats_24h": {
            "sent": last_24h.get("sent", 0),
            "failed": last_24h.get("failed", 0),
            "skipped": last_24h.get("skipped", 0),
            "total": sum(last_24h.values()),
        },
    }


async def get_email_delivery_log_detail(
    db: AsyncSession,
    log_id: uuid.UUID,
) -> Optional[Dict[str, Any]]:
    row = (
        await db.execute(select(EmailDeliveryLog).where(EmailDeliveryLog.id == log_id))
    ).scalar_one_or_none()
    if not row:
        return None

    detail = _serialize_log(row)
    # Prefer the address recorded at send time; otherwise resolve live Gmail account
    if detail.get("from_email"):
        detail["sender_email"] = detail["from_email"]
    else:
        try:
            from app.services.email_service import email_service

            detail["sender_email"] = email_service.get_sender_email()
        except Exception:
            detail["sender_email"] = getattr(settings, "GMAIL_SENDER_EMAIL", None) or None
    detail.update(await _enrich_recipient_context(db, row.to_email))
    return detail
