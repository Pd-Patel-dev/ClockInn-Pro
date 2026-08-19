"""Admin Cash Management endpoints."""
import logging
from datetime import date
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_permission
from app.core.error_handling import handle_endpoint_errors
from app.models.user import User
from app.schemas.cash_management import (
    CashExpenseCreate,
    CashExpenseUpdate,
    CashManagementSummaryResponse,
    CashTransactionResponse,
)
from app.services.cash_management_service import (
    create_expense,
    delete_expense,
    get_cash_management_summary,
    list_cash_transactions,
    resolve_period_range,
    update_expense,
)
from app.services.company_service import get_company_info, get_company_settings

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/summary", response_model=CashManagementSummaryResponse)
@handle_endpoint_errors(operation_name="cash_management_summary")
async def cash_management_summary(
    period: str = Query("monthly", pattern="^(weekly|monthly|yearly)$"),
    as_of: Optional[date] = Query(None),
    current_user: User = Depends(require_permission("cash_drawer")),
    db: AsyncSession = Depends(get_db),
):
    company = await get_company_info(db, current_user.company_id)
    summary = await get_cash_management_summary(db, company, period=period, as_of=as_of)
    await db.commit()
    return summary


@router.get("/transactions", response_model=List[CashTransactionResponse])
@handle_endpoint_errors(operation_name="list_cash_transactions")
async def cash_management_transactions(
    period: Optional[str] = Query(None, pattern="^(weekly|monthly|yearly)$"),
    as_of: Optional[date] = Query(None),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    kind: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(require_permission("cash_drawer")),
    db: AsyncSession = Depends(get_db),
):
    company = await get_company_info(db, current_user.company_id)
    settings = get_company_settings(company)
    week_start_day = int(settings.get("payroll_week_start_day") or 0)

    period_start = from_date
    period_end = to_date
    if period:
        as_of_date = as_of or date.today()
        period_start, period_end = resolve_period_range(period, as_of_date, week_start_day)

    rows = await list_cash_transactions(
        db,
        current_user.company_id,
        period_start=period_start,
        period_end=period_end,
        kind=kind,
        category=category,
        limit=limit,
    )
    return rows


@router.post("/expenses", response_model=CashTransactionResponse, status_code=201)
@handle_endpoint_errors(operation_name="create_cash_expense")
async def create_cash_expense(
    data: CashExpenseCreate,
    current_user: User = Depends(require_permission("cash_drawer")),
    db: AsyncSession = Depends(get_db),
):
    return await create_expense(db, current_user.company_id, current_user.id, data)


@router.put("/expenses/{expense_id}", response_model=CashTransactionResponse)
@handle_endpoint_errors(operation_name="update_cash_expense")
async def update_cash_expense(
    expense_id: UUID,
    data: CashExpenseUpdate,
    current_user: User = Depends(require_permission("cash_drawer")),
    db: AsyncSession = Depends(get_db),
):
    return await update_expense(db, current_user.company_id, expense_id, data)


@router.delete("/expenses/{expense_id}", status_code=204)
@handle_endpoint_errors(operation_name="delete_cash_expense")
async def delete_cash_expense(
    expense_id: UUID,
    current_user: User = Depends(require_permission("cash_drawer")),
    db: AsyncSession = Depends(get_db),
):
    await delete_expense(db, current_user.company_id, expense_id)
    return None
