"""Marketplace sales during an open Front Desk shift."""
from __future__ import annotations

from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.cash_drawer import CashDrawerSession, CashDrawerStatus
from app.models.company import Company
from app.models.time_entry import TimeEntry, TimeEntryStatus
from app.models.user import User, UserRole
from app.services.company_service import get_company_settings


def marketplace_total_cents(sales: list[dict] | None) -> int:
    if not sales:
        return 0
    total = 0
    for row in sales:
        try:
            qty = int(row.get("qty") or 0)
            price = int(row.get("price_cents") or 0)
        except (TypeError, ValueError):
            continue
        if qty > 0 and price >= 0:
            total += qty * price
    return total


def normalize_sales(sales: list | None) -> list[dict]:
    if not sales:
        return []
    out = []
    for row in sales:
        if not isinstance(row, dict):
            continue
        item_id = str(row.get("id") or "")
        if not item_id:
            continue
        try:
            qty = max(0, int(row.get("qty") or 0))
            price = max(0, int(row.get("price_cents") or 0))
        except (TypeError, ValueError):
            continue
        label = str(row.get("label") or "Item")[:100]
        out.append({"id": item_id, "label": label, "price_cents": price, "qty": qty})
    return out


async def _get_open_frontdesk_session(
    db: AsyncSession,
    company_id: UUID,
    employee_id: UUID,
) -> tuple[CashDrawerSession, TimeEntry]:
    result = await db.execute(
        select(TimeEntry)
        .where(
            and_(
                TimeEntry.company_id == company_id,
                TimeEntry.employee_id == employee_id,
                TimeEntry.status == TimeEntryStatus.OPEN,
                TimeEntry.clock_out_at.is_(None),
            )
        )
        .order_by(TimeEntry.clock_in_at.desc())
        .limit(1)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must be clocked in to record marketplace sales.",
        )

    result = await db.execute(
        select(CashDrawerSession).where(
            and_(
                CashDrawerSession.time_entry_id == entry.id,
                CashDrawerSession.company_id == company_id,
            )
        )
    )
    session = result.scalar_one_or_none()
    if not session or session.status != CashDrawerStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No open cash drawer session for this shift.",
        )
    return session, entry


async def _get_last_closed_shift_summary(
    db: AsyncSession,
    company_id: UUID,
    employee_id: UUID,
) -> dict[str, Any] | None:
    """Most recent closed cash drawer shift for the company (previous FD on the drawer)."""
    result = await db.execute(
        select(CashDrawerSession, TimeEntry, User.name)
        .outerjoin(TimeEntry, TimeEntry.id == CashDrawerSession.time_entry_id)
        .outerjoin(User, User.id == CashDrawerSession.employee_id)
        .where(
            and_(
                CashDrawerSession.company_id == company_id,
                CashDrawerSession.end_cash_cents.isnot(None),
                CashDrawerSession.status.in_(
                    [CashDrawerStatus.CLOSED, CashDrawerStatus.REVIEW_NEEDED]
                ),
            )
        )
        .order_by(
            CashDrawerSession.end_counted_at.desc().nullslast(),
            CashDrawerSession.created_at.desc(),
        )
        .limit(1)
    )
    row = result.one_or_none()
    if not row:
        return None
    session, entry, employee_name = row
    sales = normalize_sales(getattr(session, "marketplace_sales_json", None))
    marketplace_cents = (
        int(session.beverages_cash_cents)
        if session.beverages_cash_cents is not None
        else marketplace_total_cents(sales)
    )
    return {
        "employee_name": employee_name or "Front Desk",
        "is_own_shift": str(session.employee_id) == str(employee_id),
        "start_cash_cents": int(session.start_cash_cents or 0),
        "end_cash_cents": int(session.end_cash_cents or 0)
        if session.end_cash_cents is not None
        else None,
        "collected_cash_cents": int(session.collected_cash_cents)
        if session.collected_cash_cents is not None
        else None,
        "drop_amount_cents": int(session.drop_amount_cents)
        if session.drop_amount_cents is not None
        else None,
        "marketplace_sales_cents": marketplace_cents,
        "units_sold": sum(int(r.get("qty") or 0) for r in sales),
        "marketplace_sales": [s for s in sales if int(s.get("qty") or 0) > 0],
        "delta_cents": int(session.delta_cents) if session.delta_cents is not None else None,
        "clock_in_at": entry.clock_in_at.isoformat() if entry and entry.clock_in_at else None,
        "clock_out_at": entry.clock_out_at.isoformat()
        if entry and entry.clock_out_at
        else None,
        "ended_at": session.end_counted_at.isoformat() if session.end_counted_at else None,
    }


async def get_marketplace_state(
    db: AsyncSession,
    user: User,
) -> dict[str, Any]:
    if user.role != UserRole.FRONTDESK:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Marketplace sales are only available for Front Desk.",
        )

    company = (
        await db.execute(select(Company).where(Company.id == user.company_id))
    ).scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    settings = get_company_settings(company)
    catalog = settings.get("marketplace_items") or []
    last_shift = await _get_last_closed_shift_summary(db, user.company_id, user.id)

    from app.services.cash_drawer_service import get_open_company_cash_drawer

    open_company_drawer = await get_open_company_cash_drawer(db, user.company_id)
    active_drawer = None
    if open_company_drawer:
        active_drawer = {
            "employee_id": str(open_company_drawer["employee_id"]),
            "employee_name": open_company_drawer["employee_name"],
            "is_mine": str(open_company_drawer["employee_id"]) == str(user.id),
        }

    def catalog_as_sales(existing: list[dict] | None = None) -> list[dict]:
        sales_by_id = {s["id"]: s for s in (existing or [])}
        merged: list[dict] = []
        for item in catalog:
            item_id = str(item.get("id") or "")
            if not item_id:
                continue
            catalog_label = str(item.get("label") or "Item")[:100]
            catalog_price = int(item.get("price_cents") or 0)
            existing_row = sales_by_id.get(item_id)
            if existing_row:
                qty = int(existing_row.get("qty") or 0)
                # Always show the current settings label; keep price locked after first sale
                merged.append(
                    {
                        "id": item_id,
                        "label": catalog_label,
                        "price_cents": int(existing_row.get("price_cents") or 0)
                        if qty > 0
                        else catalog_price,
                        "qty": max(0, qty),
                    }
                )
            else:
                merged.append(
                    {
                        "id": item_id,
                        "label": catalog_label,
                        "price_cents": catalog_price,
                        "qty": 0,
                    }
                )
        for sid, row in sales_by_id.items():
            if sid not in {m["id"] for m in merged}:
                merged.append(row)
        return merged

    try:
        session, _entry = await _get_open_frontdesk_session(db, user.company_id, user.id)
        sales = normalize_sales(getattr(session, "marketplace_sales_json", None))
    except HTTPException as e:
        if e.status_code == 400:
            # Still return catalog rows so the dashboard can render buttons after clock-in
            # even if cash-drawer session lookup races; edits still require an open session.
            merged = catalog_as_sales()
            return {
                "items": catalog,
                "sales": merged,
                "total_cents": marketplace_total_cents(merged),
                "units_sold": sum(int(r.get("qty") or 0) for r in merged),
                "start_cash_cents": None,
                "last_shift": last_shift,
                "active_drawer": active_drawer,
                "clocked_in": False,
            }
        raise

    merged = catalog_as_sales(sales)
    # Persist renamed labels onto the open session so dashboard + clock-out stay in sync
    if merged != sales:
        session.marketplace_sales_json = normalize_sales(merged)
        flag_modified(session, "marketplace_sales_json")
        await db.commit()
    return {
        "items": catalog,
        "sales": merged,
        "total_cents": marketplace_total_cents(merged),
        "units_sold": sum(int(r.get("qty") or 0) for r in merged),
        "start_cash_cents": int(session.start_cash_cents or 0),
        "last_shift": last_shift,
        "active_drawer": active_drawer,
        "clocked_in": True,
    }


async def update_marketplace_qty(
    db: AsyncSession,
    user: User,
    item_id: str,
    qty: Optional[int] = None,
    delta: Optional[int] = None,
) -> dict[str, Any]:
    if user.role != UserRole.FRONTDESK:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Marketplace sales are only available for Front Desk.",
        )
    if qty is None and delta is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide qty or delta.",
        )

    company = (
        await db.execute(select(Company).where(Company.id == user.company_id))
    ).scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    settings = get_company_settings(company)
    catalog = {str(i.get("id")): i for i in (settings.get("marketplace_items") or []) if i.get("id")}
    catalog_item = catalog.get(item_id)

    session, _entry = await _get_open_frontdesk_session(db, user.company_id, user.id)
    sales = normalize_sales(getattr(session, "marketplace_sales_json", None))
    sales_by_id = {s["id"]: s for s in sales}

    row = sales_by_id.get(item_id)
    if row is None:
        if not catalog_item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Marketplace item not found.",
            )
        row = {
            "id": item_id,
            "label": str(catalog_item.get("label") or "Item")[:100],
            "price_cents": int(catalog_item.get("price_cents") or 0),
            "qty": 0,
        }
        sales.append(row)
        sales_by_id[item_id] = row
    elif catalog_item:
        # Keep dashboard/settings labels in sync for in-progress shifts
        row["label"] = str(catalog_item.get("label") or row.get("label") or "Item")[:100]
        if int(row.get("qty") or 0) <= 0:
            row["price_cents"] = int(catalog_item.get("price_cents") or 0)

    if qty is not None:
        row["qty"] = max(0, int(qty))
    else:
        row["qty"] = max(0, int(row.get("qty") or 0) + int(delta or 0))

    session.marketplace_sales_json = normalize_sales(list(sales_by_id.values()))
    flag_modified(session, "marketplace_sales_json")
    await db.commit()

    return await get_marketplace_state(db, user)
