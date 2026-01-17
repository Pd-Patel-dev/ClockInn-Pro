from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import datetime
from uuid import UUID
from app.models.time_entry import TimeEntrySource, TimeEntryStatus


class TimeEntryBase(BaseModel):
    clock_in_at: datetime
    clock_out_at: Optional[datetime] = None
    break_minutes: int = 0
    note: Optional[str] = Field(None, max_length=500)


class TimeEntryCreate(BaseModel):
    employee_email: Optional[str] = None
    employee_id: Optional[UUID] = None
    pin: str = Field(..., min_length=4, max_length=4, pattern="^[0-9]{4}$")
    source: TimeEntrySource = TimeEntrySource.KIOSK
    cash_start_cents: Optional[int] = Field(None, ge=0, description="Starting cash in cents (required on clock-in if cash drawer enabled)")
    cash_end_cents: Optional[int] = Field(None, ge=0, description="Ending cash in cents (required on clock-out if cash drawer session exists)")
    collected_cash_cents: Optional[int] = Field(None, ge=0, description="Total cash collected from customers (for punch-out)")
    beverages_cash_cents: Optional[int] = Field(None, ge=0, description="Cash from beverage sales (for punch-out)")


class TimeEntryPunchMe(BaseModel):
    pin: str = Field(..., min_length=4, max_length=4, pattern="^[0-9]{4}$")
    cash_start_cents: Optional[int] = Field(None, ge=0, description="Starting cash in cents (required on clock-in if cash drawer enabled)")
    cash_end_cents: Optional[int] = Field(None, ge=0, description="Ending cash in cents (required on clock-out if cash drawer session exists)")
    collected_cash_cents: Optional[int] = Field(None, ge=0, description="Total cash collected from customers (for punch-out)")
    beverages_cash_cents: Optional[int] = Field(None, ge=0, description="Cash from beverage sales (for punch-out)")


class TimeEntryPunchByPin(BaseModel):
    pin: str = Field(..., min_length=4, max_length=4, pattern="^[0-9]{4}$")


class TimeEntryManualCreate(BaseModel):
    employee_id: UUID
    clock_in_at: datetime
    clock_out_at: Optional[datetime] = None
    break_minutes: int = Field(0, ge=0)
    note: Optional[str] = Field(None, max_length=500)


class TimeEntryEdit(BaseModel):
    clock_in_at: Optional[datetime] = None
    clock_out_at: Optional[datetime] = None
    break_minutes: Optional[int] = None
    edit_reason: str = Field(..., min_length=1, max_length=500)


class TimeEntryResponse(BaseModel):
    id: UUID
    employee_id: UUID
    employee_name: str
    clock_in_at: datetime
    clock_out_at: Optional[datetime] = None
    break_minutes: int
    source: TimeEntrySource
    status: TimeEntryStatus
    note: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    # Rounded hours and minutes (calculated based on company rounding policy)
    rounded_hours: Optional[float] = None
    rounded_minutes: Optional[int] = None
    # Timezone-converted times for display
    clock_in_at_local: Optional[str] = None
    clock_out_at_local: Optional[str] = None
    company_timezone: Optional[str] = None

    class Config:
        from_attributes = True


class TimeEntryListResponse(BaseModel):
    entries: list[TimeEntryResponse]
    total: int
