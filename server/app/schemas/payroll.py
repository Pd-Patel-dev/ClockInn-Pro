from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime
from uuid import UUID
from decimal import Decimal
from app.models.payroll import PayrollType, PayrollStatus, AdjustmentType


class PayrollGenerateRequest(BaseModel):
    payroll_type: PayrollType
    start_date: date
    include_inactive: bool = False
    employee_ids: Optional[List[UUID]] = None


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
    status: PayrollStatus
    generated_at: datetime
    total_regular_hours: Decimal
    total_overtime_hours: Decimal
    total_gross_pay_cents: int
    employee_count: int

    class Config:
        from_attributes = True


class PayrollFinalizeRequest(BaseModel):
    note: Optional[str] = None


class PayrollVoidRequest(BaseModel):
    reason: str = Field(..., min_length=1)


class PayrollAdjustmentCreate(BaseModel):
    employee_id: UUID
    type: AdjustmentType
    amount_cents: int  # Positive for bonus/reimbursement, negative for deduction
    note: Optional[str] = None


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

