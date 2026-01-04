"""
Pydantic schemas for Shift and Schedule management.
"""
from typing import Optional, List
from datetime import date, time, datetime
from pydantic import BaseModel, Field, field_validator
from uuid import UUID


class ShiftBase(BaseModel):
    """Base shift schema."""
    shift_date: date
    start_time: time
    end_time: time
    break_minutes: int = Field(default=0, ge=0)
    notes: Optional[str] = None
    job_role: Optional[str] = None
    requires_approval: bool = False

    @field_validator('end_time')
    @classmethod
    def validate_end_time(cls, v, info):
        """
        Validate end_time.
        Allow end_time <= start_time for overnight shifts (which span midnight).
        The actual validation that end_datetime > start_datetime happens in the service layer
        after combining shift_date with times.
        """
        # Only validate that times are valid (no negative durations beyond one day)
        # Overnight shifts are allowed: end_time can be <= start_time to indicate next day
        return v


class ShiftCreate(ShiftBase):
    """Schema for creating a shift."""
    employee_id: UUID


class ShiftUpdate(BaseModel):
    """Schema for updating a shift."""
    shift_date: Optional[date] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    break_minutes: Optional[int] = Field(None, ge=0)
    notes: Optional[str] = None
    job_role: Optional[str] = None
    status: Optional[str] = None
    requires_approval: Optional[bool] = None


class ShiftResponse(ShiftBase):
    """Schema for shift response."""
    id: UUID
    company_id: UUID
    employee_id: UUID
    employee_name: Optional[str] = None
    status: str
    template_id: Optional[UUID] = None
    approved_by: Optional[UUID] = None
    approved_at: Optional[datetime] = None
    created_at: datetime
    created_by: Optional[UUID] = None
    updated_at: datetime

    class Config:
        from_attributes = True


class ShiftTemplateBase(BaseModel):
    """Base shift template schema."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    start_time: time
    end_time: time
    break_minutes: int = Field(default=0, ge=0)
    template_type: str = Field(..., pattern="^(WEEKLY|BIWEEKLY|MONTHLY|NONE)$")
    day_of_week: Optional[int] = Field(None, ge=0, le=6)  # 0=Monday, 6=Sunday
    day_of_month: Optional[int] = Field(None, ge=1, le=31)
    week_of_month: Optional[int] = Field(None, ge=1, le=4)
    start_date: date
    end_date: Optional[date] = None
    is_active: bool = True
    requires_approval: bool = False
    department: Optional[str] = None
    job_role: Optional[str] = None

    @field_validator('end_time')
    @classmethod
    def validate_end_time(cls, v, info):
        """
        Validate end_time.
        Allow end_time <= start_time for overnight shifts (which span midnight).
        The actual validation that end_datetime > start_datetime happens in the service layer
        after combining shift_date with times.
        """
        # Only validate that times are valid (no negative durations beyond one day)
        # Overnight shifts are allowed: end_time can be <= start_time to indicate next day
        return v

    @field_validator('end_date')
    @classmethod
    def validate_end_after_start_date(cls, v, info):
        """Ensure end_date is after start_date."""
        if v and 'start_date' in info.data and v < info.data['start_date']:
            raise ValueError('end_date must be after or equal to start_date')
        return v


class ShiftTemplateCreate(ShiftTemplateBase):
    """Schema for creating a shift template."""
    employee_id: Optional[UUID] = None


class ShiftTemplateUpdate(BaseModel):
    """Schema for updating a shift template."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    break_minutes: Optional[int] = Field(None, ge=0)
    template_type: Optional[str] = Field(None, pattern="^(WEEKLY|BIWEEKLY|MONTHLY|NONE)$")
    day_of_week: Optional[int] = Field(None, ge=0, le=6)
    day_of_month: Optional[int] = Field(None, ge=1, le=31)
    week_of_month: Optional[int] = Field(None, ge=1, le=4)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_active: Optional[bool] = None
    requires_approval: Optional[bool] = None
    department: Optional[str] = None
    job_role: Optional[str] = None


class ShiftTemplateResponse(ShiftTemplateBase):
    """Schema for shift template response."""
    id: UUID
    company_id: UUID
    employee_id: Optional[UUID] = None
    employee_name: Optional[str] = None
    created_at: datetime
    created_by: Optional[UUID] = None
    updated_at: datetime

    class Config:
        from_attributes = True


class GenerateShiftsFromTemplate(BaseModel):
    """Schema for generating shifts from template."""
    template_id: UUID
    start_date: date
    end_date: date
    employee_ids: Optional[List[UUID]] = None  # If None, use template's employee_id


class ShiftConflict(BaseModel):
    """Schema for shift conflict information."""
    conflict_type: str  # 'overlap', 'double_booked', 'same_time'
    conflicting_shift_id: UUID
    conflicting_shift_date: date
    conflicting_employee_id: UUID
    conflicting_employee_name: Optional[str] = None
    message: str


class ShiftBulkCreate(BaseModel):
    """Schema for bulk creating shifts."""
    shifts: List[ShiftCreate]


class ScheduleSwapCreate(BaseModel):
    """Schema for creating a shift swap request."""
    original_shift_id: UUID
    requested_shift_id: Optional[UUID] = None  # Null for open swap request
    notes: Optional[str] = None


class ScheduleSwapUpdate(BaseModel):
    """Schema for updating a shift swap request."""
    status: Optional[str] = Field(None, pattern="^(pending|approved|rejected|cancelled)$")
    notes: Optional[str] = None


class ScheduleSwapResponse(BaseModel):
    """Schema for shift swap response."""
    id: UUID
    company_id: UUID
    original_shift_id: UUID
    requested_shift_id: Optional[UUID] = None
    requester_id: UUID
    requester_name: Optional[str] = None
    offerer_id: Optional[UUID] = None
    offerer_name: Optional[str] = None
    status: str
    approved_by: Optional[UUID] = None
    approved_at: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

