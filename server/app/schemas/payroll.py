from pydantic import BaseModel, Field, model_validator
from typing import Optional, List, Dict
from datetime import date, datetime, timedelta
from uuid import UUID
from decimal import Decimal
from app.models.payroll import PayrollType, PayrollStatus, AdjustmentType


class PayrollGenerateRequest(BaseModel):
    payroll_type: PayrollType
    start_date: date
    include_inactive: bool = False
    employee_ids: Optional[List[UUID]] = None
    # entry_id -> paid hours as reviewed in the generate dialog
    entry_hour_overrides: Optional[Dict[str, float]] = None
    
    @model_validator(mode='after')
    def validate_start_date(self):
        """Validate start_date is not in the future (schedule window enforced in service)."""
        if self.start_date > date.today():
            raise ValueError("start_date cannot be in the future")
        return self


class PayrollLineItemResponse(BaseModel):
    id: UUID
    employee_id: UUID
    employee_name: str
    regular_minutes: int
    overtime_minutes: int
    total_minutes: int
    pay_rate_cents: int
    overtime_multiplier: Decimal
    regular_pay_cents: int
    overtime_pay_cents: int
    total_pay_cents: int
    exceptions_count: int
    details_json: Optional[dict] = None

    class Config:
        from_attributes = True


class PayrollRunResponse(BaseModel):
    id: UUID
    company_id: UUID
    payroll_type: PayrollType
    period_start_date: date
    period_end_date: date
    pay_date: Optional[date] = None
    timezone: str
    status: PayrollStatus
    generated_by: UUID
    generated_by_name: Optional[str] = None
    generated_at: datetime
    total_regular_hours: Decimal
    total_overtime_hours: Decimal
    total_gross_pay_cents: int
    created_at: datetime
    updated_at: datetime
    line_items: List[PayrollLineItemResponse] = []

    class Config:
        from_attributes = True


class PayrollRunSummaryResponse(BaseModel):
    id: UUID
    payroll_type: PayrollType
    period_start_date: date
    period_end_date: date
    pay_date: Optional[date] = None
    status: PayrollStatus
    generated_at: datetime
    total_regular_hours: Decimal
    total_overtime_hours: Decimal
    total_gross_pay_cents: int
    employee_count: int

    class Config:
        from_attributes = True


class PayrollFinalizeRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=500)


class PayrollVoidRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=500)


class PayrollAdjustmentCreate(BaseModel):
    employee_id: UUID
    type: AdjustmentType
    amount_cents: int  # Positive for bonus/reimbursement, negative for deduction
    note: Optional[str] = Field(None, max_length=500)


class PayrollAdjustmentResponse(BaseModel):
    id: UUID
    employee_id: UUID
    employee_name: Optional[str] = None
    type: AdjustmentType
    amount_cents: int
    note: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class EmployeePayrollResponse(BaseModel):
    """Employee's view of their payroll (finalized only)"""
    payroll_run_id: UUID
    period_start_date: date
    period_end_date: date
    payroll_type: PayrollType
    regular_hours: Decimal
    overtime_hours: Decimal
    regular_pay_cents: int
    overtime_pay_cents: int
    total_pay_cents: int
    generated_at: datetime

    class Config:
        from_attributes = True


class PayrollReviewEntry(BaseModel):
    id: str
    clock_in_at: Optional[str] = None
    clock_out_at: Optional[str] = None
    clock_in_local: Optional[str] = None
    clock_out_local: Optional[str] = None
    break_minutes: int = 0
    status: Optional[str] = None
    minutes: int = 0
    hours: float = 0
    is_open: bool = False
    note: Optional[str] = None


class PayrollReviewEmployee(BaseModel):
    employee_id: str
    employee_name: str
    pay_rate_cents: int
    overtime_multiplier: float
    regular_minutes: int
    overtime_minutes: int
    total_minutes: int
    total_hours: float
    exceptions_count: int
    entry_count: int
    open_entry_count: int
    entries: List[PayrollReviewEntry] = []


class PayrollReviewPreviewResponse(BaseModel):
    payroll_type: str
    period_start: str
    period_end: str
    timezone: str
    breaks_paid: bool
    employee_count: int
    employees: List[PayrollReviewEmployee] = []


class PayrollReviewHoursUpdate(BaseModel):
    hours: float = Field(..., ge=0, le=24)
    break_minutes: Optional[int] = Field(None, ge=0)
    edit_reason: str = Field(
        "Payroll review hours adjustment",
        min_length=1,
        max_length=500,
    )

