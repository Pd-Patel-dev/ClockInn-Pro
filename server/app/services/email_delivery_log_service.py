"""Persist and query outbound email delivery attempts."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email_delivery_log import EmailDeliveryLog, EmailDeliveryStatus

logger = logging.getLogger(__name__)


async def record_email_delivery(
    *,
    to_email: str,
    status: str,
    subject: Optional[str] = None,
    template_key: Optional[str] = None,
    kind: str = "transactional",
    provider_message_id: Optional[str] = None,
    error_message: Optional[str] = None,
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
    last_24h = {EmailDeliveryStatus.SENT.value: 0, EmailDeliveryStatus.FAILED.value: 0, EmailDeliveryStatus.SKIPPED.value: 0}
    for st, cnt in stats_rows:
        last_24h[str(st)] = int(cnt)

    return {
        "items": [
            {
                "id": str(r.id),
                "to_email": r.to_email,
                "subject": r.subject,
                "template_key": r.template_key,
                "kind": r.kind,
                "status": r.status,
                "provider_message_id": r.provider_message_id,
                "error_message": r.error_message,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
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
