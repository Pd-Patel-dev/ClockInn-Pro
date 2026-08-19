"""Cash management: sync drawer income, expense CRUD, period summaries."""
from __future__ import annotations

import calendar
import logging
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

import pytz
from fastapi import HTTPException, status
from sqlalchemy import and_, select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.cash_drawer import CashDrawerSession, CashDrawerStatus
from app.models.cash_management import (
    CashTransaction,
    CashTransactionCategory,
    CashTransactionKind,
    CashTransactionSource,
)
from app.models.company import Company
from app.models.user import User
from app.schemas.cash_management import CashExpenseCreate, CashExpenseUpdate
from app.services.company_service import get_company_settings
from app.services.payroll_schedule_service import week_start_on_or_before

logger = logging.getLogger(__name__)

EXPENSE_CATEGORIES = {
    "operations": CashTransactionCategory.OPERATIONS,
    "marketplace": CashTransactionCategory.MARKETPLACE,
    "utilities": CashTransactionCategory.UTILITIES,
    "supplies": CashTransactionCategory.SUPPLIES,
    "other": CashTransactionCategory.OTHER,
}

CATEGORY_LABELS = {
    "operations": "Operations",
    "marketplace": "Marketplace",
    "utilities": "Utilities",
    "supplies": "Supplies",
    "other": "Other",
    "drop": "Room Sale",
    "marketplace_sale": "Marketplace sales",
}


def _company_today(timezone_str: str) -> date:
    try:
        tz = pytz.timezone(timezone_str or "America/Chicago")
    except Exception:
        tz = pytz.timezone("America/Chicago")
    return datetime.now(tz).date()


def resolve_period_range(
    period: str,
    as_of: date,
    week_start_day: int = 0,
) -> Tuple[date, date]:
    """Return inclusive [start, end] for weekly / monthly / yearly."""
    value = (period or "monthly").lower()
    if value == "weekly":
        start = week_start_on_or_before(as_of, week_start_day)
        end = start + timedelta(days=6)
        return start, end
    if value == "yearly":
        return date(as_of.year, 1, 1), date(as_of.year, 12, 31)
    # monthly default
    last_day = calendar.monthrange(as_of.year, as_of.month)[1]
    return date(as_of.year, as_of.month, 1), date(as_of.year, as_of.month, last_day)


def _session_business_date(session: CashDrawerSession, timezone_str: str) -> date:
    try:
        tz = pytz.timezone(timezone_str or "America/Chicago")
    except Exception:
        tz = pytz.timezone("America/Chicago")
    when = session.end_counted_at or session.start_counted_at
    if when.tzinfo is None:
        when = pytz.UTC.localize(when)
    return when.astimezone(tz).date()


async def sync_income_from_drawers(
    db: AsyncSession,
    company_id: UUID,
    timezone_str: str = "America/Chicago",
) -> int:
    """
    Upsert DROP and MARKETPLACE_SALE income rows from closed drawer sessions.
    Returns number of rows created or updated.
    """
    result = await db.execute(
        select(CashDrawerSession).where(
            and_(
                CashDrawerSession.company_id == company_id,
                CashDrawerSession.status.in_(
                    [CashDrawerStatus.CLOSED, CashDrawerStatus.REVIEW_NEEDED]
                ),
            )
        )
    )
    sessions = list(result.scalars().all())
    touched = 0

    for session in sessions:
        occurred_on = _session_business_date(session, timezone_str)
        specs = []
        drop = int(session.drop_amount_cents or 0)
        sales = int(session.beverages_cash_cents or 0)
        if drop > 0:
            specs.append(
                (
                    CashTransactionSource.DROP,
                    CashTransactionCategory.DROP,
                    drop,
                    "Room sale from drawer session",
                )
            )
        if sales > 0:
            from app.services.marketplace_service import (
                marketplace_card_cents,
                marketplace_cash_cents,
                normalize_sales,
            )

            sales_rows = normalize_sales(getattr(session, "marketplace_sales_json", None))
            cash_part = marketplace_cash_cents(sales_rows)
            card_part = marketplace_card_cents(sales_rows)
            if sales > cash_part + card_part:
                cash_part = sales - card_part
            note = (
                f"Marketplace sales from drawer session "
                f"(cash ${cash_part / 100:.2f}, card ${card_part / 100:.2f})"
            )
            specs.append(
                (
                    CashTransactionSource.MARKETPLACE_SALE,
                    CashTransactionCategory.MARKETPLACE_SALE,
                    sales,
                    note,
                )
            )

        for source, category, amount, note in specs:
            existing = await db.execute(
                select(CashTransaction).where(
                    and_(
                        CashTransaction.company_id == company_id,
                        CashTransaction.cash_drawer_session_id == session.id,
                        CashTransaction.source == source,
                    )
                )
            )
            row = existing.scalar_one_or_none()
            if row:
                if row.amount_cents != amount or row.occurred_on != occurred_on:
                    row.amount_cents = amount
                    row.occurred_on = occurred_on
                    row.note = note
                    touched += 1
            else:
                db.add(
                    CashTransaction(
                        id=uuid.uuid4(),
                        company_id=company_id,
                        kind=CashTransactionKind.INCOME,
                        source=source,
                        category=category,
                        amount_cents=amount,
                        occurred_on=occurred_on,
                        note=note,
                        cash_drawer_session_id=session.id,
                    )
                )
                touched += 1

    if touched:
        await db.flush()
    return touched


async def get_cash_management_summary(
    db: AsyncSession,
    company: Company,
    period: str = "monthly",
    as_of: Optional[date] = None,
) -> Dict[str, Any]:
    settings = get_company_settings(company)
    timezone_str = settings.get("timezone") or "America/Chicago"
    week_start_day = int(settings.get("payroll_week_start_day") or 0)
    as_of_date = as_of or _company_today(timezone_str)
    period_key = (period or "monthly").lower()
    if period_key not in ("weekly", "monthly", "yearly"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="period must be weekly, monthly, or yearly",
        )

    await sync_income_from_drawers(db, company.id, timezone_str)
    await db.flush()

    period_start, period_end = resolve_period_range(period_key, as_of_date, week_start_day)

    result = await db.execute(
        select(CashTransaction).where(
            and_(
                CashTransaction.company_id == company.id,
                CashTransaction.occurred_on >= period_start,
                CashTransaction.occurred_on <= period_end,
            )
        )
    )
    rows = list(result.scalars().all())

    income_cents = 0
    expense_cents = 0
    income_by: Dict[str, int] = {}
    expense_by: Dict[str, int] = {}
    mkt_income = 0
    mkt_expense = 0
    mkt_cash_income = 0
    mkt_card_income = 0

    for row in rows:
        key = row.category.value if row.category else "other"
        if row.kind == CashTransactionKind.INCOME:
            income_cents += row.amount_cents
            income_by[key] = income_by.get(key, 0) + row.amount_cents
            if row.source == CashTransactionSource.MARKETPLACE_SALE or key == "marketplace_sale":
                mkt_income += row.amount_cents
        else:
            expense_cents += row.amount_cents
            expense_by[key] = expense_by.get(key, 0) + row.amount_cents
            if key == "marketplace":
                mkt_expense += row.amount_cents

    # Cash vs card split from drawer marketplace JSON (same business dates as synced income)
    from app.services.marketplace_service import (
        marketplace_card_cents,
        marketplace_cash_cents,
        normalize_sales,
    )

    drawer_result = await db.execute(
        select(CashDrawerSession).where(
            and_(
                CashDrawerSession.company_id == company.id,
                CashDrawerSession.status.in_(
                    [CashDrawerStatus.CLOSED, CashDrawerStatus.REVIEW_NEEDED]
                ),
            )
        )
    )
    for session in drawer_result.scalars().all():
        occurred_on = _session_business_date(session, timezone_str)
        if occurred_on < period_start or occurred_on > period_end:
            continue
        sales_rows = normalize_sales(getattr(session, "marketplace_sales_json", None))
        cash_part = marketplace_cash_cents(sales_rows)
        card_part = marketplace_card_cents(sales_rows)
        total = int(session.beverages_cash_cents or 0) or (cash_part + card_part)
        if total > cash_part + card_part:
            cash_part = total - card_part
        mkt_cash_income += cash_part
        mkt_card_income += card_part

    def _breakdown(mapping: Dict[str, int]) -> List[Dict[str, Any]]:
        return [
            {
                "key": k,
                "label": CATEGORY_LABELS.get(k, k.replace("_", " ").title()),
                "amount_cents": v,
            }
            for k, v in sorted(mapping.items(), key=lambda x: -x[1])
        ]

    return {
        "period": period_key,
        "as_of": as_of_date,
        "period_start": period_start,
        "period_end": period_end,
        "income_cents": income_cents,
        "expense_cents": expense_cents,
        "net_cents": income_cents - expense_cents,
        "income_breakdown": _breakdown(income_by),
        "expense_breakdown": _breakdown(expense_by),
        "marketplace_pl": {
            "income_cents": mkt_income,
            "expense_cents": mkt_expense,
            "profit_cents": mkt_income - mkt_expense,
            "cash_income_cents": mkt_cash_income,
            "card_income_cents": mkt_card_income,
        },
        "transaction_count": len(rows),
    }


def _to_response(row: CashTransaction, creator_name: Optional[str] = None) -> Dict[str, Any]:
    return {
        "id": row.id,
        "company_id": row.company_id,
        "kind": row.kind,
        "source": row.source,
        "category": row.category,
        "amount_cents": row.amount_cents,
        "occurred_on": row.occurred_on,
        "note": row.note,
        "cash_drawer_session_id": row.cash_drawer_session_id,
        "created_by": row.created_by,
        "created_by_name": creator_name,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


async def list_cash_transactions(
    db: AsyncSession,
    company_id: UUID,
    *,
    period_start: Optional[date] = None,
    period_end: Optional[date] = None,
    kind: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    query = (
        select(CashTransaction)
        .options(selectinload(CashTransaction.creator))
        .where(CashTransaction.company_id == company_id)
    )
    if period_start:
        query = query.where(CashTransaction.occurred_on >= period_start)
    if period_end:
        query = query.where(CashTransaction.occurred_on <= period_end)
    if kind:
        query = query.where(CashTransaction.kind == CashTransactionKind(kind.upper()))
    if category:
        query = query.where(CashTransaction.category == CashTransactionCategory(category))
    query = query.order_by(CashTransaction.occurred_on.desc(), CashTransaction.created_at.desc()).limit(
        min(max(limit, 1), 500)
    )
    result = await db.execute(query)
    rows = list(result.scalars().all())
    return [
        _to_response(row, row.creator.name if row.creator else None)
        for row in rows
    ]


async def create_expense(
    db: AsyncSession,
    company_id: UUID,
    created_by: UUID,
    data: CashExpenseCreate,
) -> Dict[str, Any]:
    category = EXPENSE_CATEGORIES.get(data.category)
    if not category:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category")
    row = CashTransaction(
        id=uuid.uuid4(),
        company_id=company_id,
        kind=CashTransactionKind.EXPENSE,
        source=CashTransactionSource.MANUAL,
        category=category,
        amount_cents=data.amount_cents,
        occurred_on=data.occurred_on,
        note=data.note,
        created_by=created_by,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    result = await db.execute(select(User).where(User.id == created_by))
    creator = result.scalar_one_or_none()
    return _to_response(row, creator.name if creator else None)


async def update_expense(
    db: AsyncSession,
    company_id: UUID,
    expense_id: UUID,
    data: CashExpenseUpdate,
) -> Dict[str, Any]:
    result = await db.execute(
        select(CashTransaction)
        .options(selectinload(CashTransaction.creator))
        .where(
            and_(
                CashTransaction.id == expense_id,
                CashTransaction.company_id == company_id,
            )
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense not found")
    if row.source != CashTransactionSource.MANUAL or row.kind != CashTransactionKind.EXPENSE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only manual expenses can be edited",
        )
    if data.amount_cents is not None:
        row.amount_cents = data.amount_cents
    if data.occurred_on is not None:
        row.occurred_on = data.occurred_on
    if data.category is not None:
        category = EXPENSE_CATEGORIES.get(data.category)
        if not category:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category")
        row.category = category
    if data.note is not None:
        row.note = data.note
    await db.commit()
    await db.refresh(row)
    return _to_response(row, row.creator.name if row.creator else None)


async def delete_expense(
    db: AsyncSession,
    company_id: UUID,
    expense_id: UUID,
) -> None:
    result = await db.execute(
        select(CashTransaction).where(
            and_(
                CashTransaction.id == expense_id,
                CashTransaction.company_id == company_id,
            )
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense not found")
    if row.source != CashTransactionSource.MANUAL or row.kind != CashTransactionKind.EXPENSE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only manual expenses can be deleted",
        )
    await db.execute(delete(CashTransaction).where(CashTransaction.id == expense_id))
    await db.commit()
