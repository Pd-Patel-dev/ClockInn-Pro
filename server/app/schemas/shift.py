"""
Pydantic schemas for Shift and Schedule management.
"""
from typing import Optional, List, Any, Literal
from datetime import date, time, datetime
from pydantic import BaseModel, Field, field_validator, field_serializer, model_validator
from uuid import UUID


def _time_to_24h_string(t: time) -> str:
    """Serialize time to 24-hour string HH:MM for unambiguous API responses."""
    return t.strftime("%H:%M")


def _parse_time_24h(value: Any) -> time:
    """Parse time from string as 24-hour only (HH:MM or HH:MM:SS). Rejects 12-hour."""
    if isinstance(value, time):
        return value
    if not isinstance(value, str):
        raise ValueError("Time must be a string in HH:MM or HH:MM:SS (24-hour)")
    s = value.strip()
    if not s:
        raise ValueError("Time string cannot be empty")
    parts = s.split(":")
    if len(parts) < 2:
        raise ValueError("Time must be HH:MM or HH:MM:SS (24-hour)")
    try:
        hour = int(parts[0])
        minute = int(parts[1])
        second = int(parts[2]) if len(parts) > 2 else 0
    except (ValueError, IndexError):
        raise ValueError("Time must be HH:MM or HH:MM:SS (24-hour)")
    if hour < 0 or hour > 23 or minute < 0 or minute > 59 or second < 0 or second > 59:
        raise ValueError("Time must be 24-hour: hour 0-23, minute 0-59")
    return time(hour, minute, second)


def _shift_duration_minutes(start_time: time, end_time: time) -> int:
    """Return shift duration in minutes; end_time <= start_time is treated as overnight (+24h)."""
    start_m = start_time.hour * 60 + start_time.minute
    end_m = end_time.hour * 60 + end_time.minute
    if end_m <= start_m:
        end_m += 24 * 60
    return end_m - start_m


class ShiftBase(BaseModel):
    """Base shift schema. start_time/end_time are 24-hour (e.g. 23:00 = 11 PM).
    Times are wall-clock in the company default timezone; no timezone is stored.
    Send-schedule and UI do not convert to user timezone (see docs/SCHEDULE_FLAWS.md §4.1).
    """
    shift_date: date
    start_time: time
    end_time: time
    break_minutes: int = Field(default=0, ge=0, le=1440)
    notes: Optional[str] = None
    job_role: Optional[str] = None
    requires_approval: bool = False

    @field_validator("start_time", "end_time", mode="before")
    @classmethod
    def parse_time_24h(cls, v: Any) -> time:
        return _parse_time_24h(v)

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

    @model_validator(mode='after')
    def reject_same_start_end_time(self):
        """Reject start_time == end_time; it is ambiguous (zero duration vs 24h overnight). Use distinct times."""
        if self.start_time == self.end_time:
            raise ValueError(
                "start_time and end_time cannot be equal. Use distinct times; for overnight (e.g. 9 AM to 9 AM next day), use end before start on the same day (e.g. 09:00–08:59)."
            )
        return self

    @model_validator(mode='after')
    def break_less_than_duration(self):
        """Ensure break_minutes is less than shift duration (overnight handled)."""
        duration = _shift_duration_minutes(self.start_time, self.end_time)
        if self.break_minutes >= duration:
            raise ValueError(
                f"break_minutes ({self.break_minutes}) must be less than shift duration ({duration} minutes)."
            )
        return self


class ShiftCreate(ShiftBase):
    """Schema for creating a shift."""
    employee_id: UUID


class ShiftUpdate(BaseModel):
    """Schema for updating a shift. start_time/end_time are 24-hour if provided."""
    shift_date: Optional[date] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    break_minutes: Optional[int] = Field(None, ge=0, le=1440)
    notes: Optional[str] = None
    job_role: Optional[str] = None
    status: Optional[Literal["DRAFT", "PUBLISHED", "APPROVED", "CANCELLED"]] = None
    requires_approval: Optional[bool] = None

    @field_validator("start_time", "end_time", mode="before")
    @classmethod
    def parse_time_24h(cls, v: Any) -> Any:
        if v is None:
            return None
        return _parse_time_24h(v)

    @model_validator(mode='after')
    def reject_same_start_end_time_when_both_set(self):
        """When both start_time and end_time are provided, they cannot be equal."""
        if self.start_time is not None and self.end_time is not None and self.start_time == self.end_time:
            raise ValueError(
                "start_time and end_time cannot be equal. Use distinct times; for overnight use end before start (e.g. 09:00–08:59)."
            )
        return self

    @model_validator(mode='after')
    def break_less_than_duration_when_all_set(self):
        """When start_time, end_time and break_minutes are all provided, break must be less than duration."""
        if self.start_time is None or self.end_time is None or self.break_minutes is None:
            return self
        duration = _shift_duration_minutes(self.start_time, self.end_time)
        if self.break_minutes >= duration:
            raise ValueError(
                f"break_minutes ({self.break_minutes}) must be less than shift duration ({duration} minutes)."
            )
        return self


class ShiftResponse(ShiftBase):
    """Schema for shift response. start_time/end_time are serialized as 24-hour HH:MM."""
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

    @field_serializer("start_time", "end_time", when_used="always")
    def serialize_time_24h(self, t: time) -> str:
        return _time_to_24h_string(t)

    class Config:
        from_attributes = True


class ShiftTemplateBase(BaseModel):
    """Base shift template schema."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    start_time: time
    end_time: time
    break_minutes: int = Field(default=0, ge=0, le=1440)
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
    break_minutes: Optional[int] = Field(None, ge=0, le=1440)
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
    """Schema for shift template response. start_time/end_time are serialized as 24-hour HH:MM."""
    id: UUID
    company_id: UUID
    employee_id: Optional[UUID] = None
    employee_name: Optional[str] = None
    created_at: datetime
    created_by: Optional[UUID] = None
    updated_at: datetime

    @field_serializer("start_time", "end_time", when_used="always")
    def serialize_time_24h(self, t: time) -> str:
        return _time_to_24h_string(t)

    class Config:
        from_attributes = True


class GenerateShiftsFromTemplate(BaseModel):
    """Schema for generating shifts from template (full, used by service)."""
    template_id: UUID
    start_date: date
    end_date: date
    employee_ids: Optional[List[UUID]] = None  # If None, use template's employee_id


class GenerateShiftsFromTemplateBody(BaseModel):
    """Request body for POST /shift-templates/{template_id}/generate. template_id comes from the path."""
    start_date: date
    end_date: date
    employee_ids: Optional[List[UUID]] = None


class ShiftConflict(BaseModel):
    """Schema for shift conflict information."""
    conflict_type: str  # 'overlap', 'double_booked', 'same_time'
    conflicting_shift_id: UUID
    conflicting_shift_date: date
    conflicting_employee_id: UUID
    conflicting_employee_name: Optional[str] = None
    message: str


class ShiftResponseWithConflicts(BaseModel):
    """Response for create/update shift that includes the shift and any overlapping conflicts."""
    shift: ShiftResponse
    conflicts: List[ShiftConflict] = Field(default_factory=list, description="Overlapping shifts detected; shift was still created/updated.")


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


class SendScheduleRequest(BaseModel):
    """Schema for sending schedule email to an employee for a week.
    week_start_date must be a Monday (ISO week start)."""
    employee_id: UUID
    week_start_date: date

    @field_validator("week_start_date")
    @classmethod
    def week_start_must_be_monday(cls, v: date) -> date:
        """Ensure week_start_date is a Monday (weekday() 0 = Monday in Python)."""
        if v.weekday() != 0:
            raise ValueError(
                "week_start_date must be a Monday. Use the Monday of the week (e.g. from the schedule week picker)."
            )
        return v

