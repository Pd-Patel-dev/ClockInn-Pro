from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import date, datetime
from uuid import UUID
from app.models.cash_management import (
    CashTransactionKind,
    CashTransactionSource,
    CashTransactionCategory,
)


class CashExpenseCreate(BaseModel):
    amount_cents: int = Field(..., gt=0)
    occurred_on: date
    category: Literal["operations", "marketplace", "utilities", "supplies", "other"] = "operations"
    note: Optional[str] = Field(None, max_length=500)


class CashExpenseUpdate(BaseModel):
    amount_cents: Optional[int] = Field(None, gt=0)
    occurred_on: Optional[date] = None
    category: Optional[Literal["operations", "marketplace", "utilities", "supplies", "other"]] = None
    note: Optional[str] = Field(None, max_length=500)


class CashTransactionResponse(BaseModel):
    id: UUID
    company_id: UUID
    kind: CashTransactionKind
    source: CashTransactionSource
    category: CashTransactionCategory
    amount_cents: int
    occurred_on: date
    note: Optional[str] = None
    cash_drawer_session_id: Optional[UUID] = None
    created_by: Optional[UUID] = None
    created_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CashBreakdownItem(BaseModel):
    key: str
    label: str
    amount_cents: int


class MarketplacePL(BaseModel):
    income_cents: int
    expense_cents: int
    profit_cents: int
    cash_income_cents: int = 0
    card_income_cents: int = 0


class CashManagementSummaryResponse(BaseModel):
    period: Literal["weekly", "monthly", "yearly"]
    as_of: date
    period_start: date
    period_end: date
    income_cents: int
    expense_cents: int
    net_cents: int
    income_breakdown: List[CashBreakdownItem]
    expense_breakdown: List[CashBreakdownItem]
    marketplace_pl: MarketplacePL
    transaction_count: int
