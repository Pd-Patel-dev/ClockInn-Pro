from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
from datetime import datetime, date
from uuid import UUID
from decimal import Decimal


class CashDrawerSessionBase(BaseModel):
    start_cash_cents: int = Field(..., ge=0, description="Starting cash in cents")
    end_cash_cents: Optional[int] = Field(None, ge=0, description="Ending cash in cents")
    review_note: Optional[str] = Field(None, max_length=1000, description="Review note")


class CashDrawerSessionCreate(CashDrawerSessionBase):
    time_entry_id: UUID
    employee_id: UUID
    start_cash_cents: int = Field(..., ge=0)


class CashDrawerSessionUpdate(BaseModel):
    start_cash_cents: Optional[int] = Field(None, ge=0)
    end_cash_cents: Optional[int] = Field(None, ge=0)
    reason: str = Field(..., min_length=1, max_length=500, description="Reason for edit")


class CashDrawerSessionReview(BaseModel):
    note: Optional[str] = Field(None, max_length=1000)
    # Status is always set to CLOSED after review, so this field is optional for backward compatibility
    status: Optional[str] = Field(None, pattern="^(CLOSED|REVIEW_NEEDED)$")


class CashDrawerSessionResponse(BaseModel):
    id: UUID
    company_id: UUID
    time_entry_id: UUID
    employee_id: UUID
    employee_name: str
    start_cash_cents: int
    start_counted_at: datetime
    start_count_source: str
    end_cash_cents: Optional[int]
    end_counted_at: Optional[datetime]
    end_count_source: Optional[str]
    collected_cash_cents: Optional[int] = None
    beverages_cash_cents: Optional[int] = None
    delta_cents: Optional[int]
    status: str
    reviewed_by: Optional[UUID]
    reviewed_at: Optional[datetime]
    review_note: Optional[str]
    created_at: datetime
    updated_at: datetime
    clock_in_at: Optional[datetime] = None
    clock_out_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CashDrawerAuditResponse(BaseModel):
    id: UUID
    action: str
    actor_user_id: UUID
    actor_name: str
    old_values_json: Optional[dict]
    new_values_json: Optional[dict]
    reason: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class CashDrawerSessionDetailResponse(CashDrawerSessionResponse):
    audit_logs: List[CashDrawerAuditResponse] = []


class CashDrawerSummaryResponse(BaseModel):
    total_sessions: int
    total_delta_cents: int
    average_delta_cents: float
    review_needed_count: int
    employee_totals: List[dict] = []


class CashDrawerExportRequest(BaseModel):
    format: str = Field(..., pattern="^(pdf|xlsx)$")
    from_date: date
    to_date: date
    employee_id: Optional[UUID] = None
    status: Optional[str] = Field(None, pattern="^(OPEN|CLOSED|REVIEW_NEEDED)$")
