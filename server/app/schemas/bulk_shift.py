"""
Bulk Shift Creation Schemas

Handles creating multiple shifts for a week for a single employee.
"""
from typing import List, Optional, Dict, Literal
from datetime import date, time
from pydantic import BaseModel, Field, field_validator, model_validator
from uuid import UUID


def _validate_time_24h(value: Optional[str]) -> Optional[str]:
    """Validate time string H:mm or HH:mm, hour 0-23, minute 0-59. Returns normalized HH:mm."""
    if value is None:
        return None
    s = value.strip()
    if not s:
        return None
    parts = s.split(":")
    if len(parts) != 2:
        raise ValueError("Time must be H:mm or HH:mm (e.g. 9:00 or 09:00)")
    try:
        h, m = int(parts[0]), int(parts[1])
    except ValueError:
        raise ValueError("Time must have numeric hour and minute")
    if h < 0 or h > 23 or m < 0 or m > 59:
        raise ValueError("Hour must be 0-23 and minute 0-59")
    return f"{h:02d}:{m:02d}"


def _duration_minutes_from_strings(start_time: str, end_time: str) -> int:
    """Return shift duration in minutes from HH:mm strings; end <= start is treated as overnight."""
    def to_minutes(s: str) -> int:
        parts = s.split(":")
        h, m = int(parts[0]), int(parts[1]) if len(parts) > 1 else 0
        return h * 60 + m
    start_m = to_minutes(start_time)
    end_m = to_minutes(end_time)
    if end_m <= start_m:
        end_m += 24 * 60
    return end_m - start_m


class DayTemplate(BaseModel):
    """Template for a single day's shift."""
    enabled: bool = True
    start_time: Optional[str] = Field(None, pattern=r"^\d{1,2}:\d{2}$", description="H:mm or HH:mm (24-hour)")
    end_time: Optional[str] = Field(None, pattern=r"^\d{1,2}:\d{2}$", description="H:mm or HH:mm (24-hour)")
    break_minutes: Optional[int] = Field(None, ge=0, le=1440, description="Break minutes (0-1440)")

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_range(cls, v: Optional[str]) -> Optional[str]:
        return _validate_time_24h(v)

    @model_validator(mode='after')
    def reject_same_start_end_time_when_both_set(self):
        """When both start_time and end_time are set, they cannot be equal."""
        if self.start_time and self.end_time and self.start_time == self.end_time:
            raise ValueError("start_time and end_time cannot be equal. Use distinct times; for overnight use end before start (e.g. 09:00–08:59).")
        return self

    @model_validator(mode='after')
    def break_less_than_duration_when_all_set(self):
        """When start_time, end_time and break_minutes are set, break must be less than duration."""
        if not self.start_time or not self.end_time or self.break_minutes is None:
            return self
        duration = _duration_minutes_from_strings(self.start_time, self.end_time)
        if self.break_minutes >= duration:
            raise ValueError(f"break_minutes ({self.break_minutes}) must be less than shift duration ({duration} minutes).")
        return self


class BulkWeekShiftTemplate(BaseModel):
    """Template for creating shifts across a week."""
    start_time: str = Field(..., pattern=r"^\d{1,2}:\d{2}$", description="H:mm or HH:mm (24-hour)")
    end_time: str = Field(..., pattern=r"^\d{1,2}:\d{2}$", description="H:mm or HH:mm (24-hour)")
    break_minutes: int = Field(0, ge=0, le=1440, description="Break minutes (0-1440)")
    status: Literal["DRAFT", "PUBLISHED", "APPROVED"] = Field("DRAFT", description="Initial shift status")
    notes: Optional[str] = Field(None, max_length=1000, description="Notes for all shifts")
    job_role: Optional[str] = Field(None, max_length=255, description="Job role override")

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_range(cls, v: str) -> str:
        result = _validate_time_24h(v)
        return result or v

    @model_validator(mode='after')
    def reject_same_start_end_time(self):
        """Reject start_time == end_time (ambiguous: zero duration vs 24h overnight). Use distinct times."""
        if self.start_time == self.end_time:
            raise ValueError("start_time and end_time cannot be equal. Use distinct times; for overnight use end before start (e.g. 09:00–08:59).")
        return self

    @model_validator(mode='after')
    def break_less_than_duration(self):
        """Ensure break_minutes is less than shift duration (overnight handled)."""
        duration = _duration_minutes_from_strings(self.start_time, self.end_time)
        if self.break_minutes >= duration:
            raise ValueError(f"break_minutes ({self.break_minutes}) must be less than shift duration ({duration} minutes).")
        return self

    @field_validator("notes")
    @classmethod
    def sanitize_notes(cls, v: Optional[str]) -> Optional[str]:
        """Sanitize notes field."""
        if not v:
            return None
        # Remove any HTML tags and limit length
        import re
        v = re.sub(r'<[^>]+>', '', v)
        return v[:1000] if v else None


class BulkWeekShiftCreate(BaseModel):
    """Request to create shifts for a whole week."""
    week_start_date: date = Field(..., description="Monday of the week (YYYY-MM-DD)")
    timezone: str = Field("America/Chicago", description="IANA timezone (e.g., America/Chicago). Accepted for context/future use; shift dates and times are currently created as provided (wall-clock), not converted using this zone.")
    employee_id: UUID = Field(..., description="Employee ID")
    mode: Literal["same_each_day", "per_day"] = Field("same_each_day", description="Creation mode")
    template: BulkWeekShiftTemplate
    days: Dict[str, DayTemplate] = Field(
        default_factory=lambda: {
            "mon": DayTemplate(enabled=True),
            "tue": DayTemplate(enabled=True),
            "wed": DayTemplate(enabled=True),
            "thu": DayTemplate(enabled=True),
            "fri": DayTemplate(enabled=True),
            "sat": DayTemplate(enabled=False),
            "sun": DayTemplate(enabled=False),
        },
        description="Day configuration (mon-sun)"
    )
    conflict_policy: Literal["skip", "overwrite", "draft", "error"] = Field(
        "skip",
        description="How to handle conflicts: skip, overwrite (cancel existing), draft (create as draft with conflict note), error (reject)"
    )
    
    @model_validator(mode='after')
    def validate_per_day_overrides(self):
        """Validate per_day mode has overrides for enabled days."""
        if self.mode == "per_day":
            enabled_days = [k for k, v in self.days.items() if v.enabled]
            for day_key in enabled_days:
                day_template = self.days[day_key]
                if not day_template.start_time or not day_template.end_time:
                    raise ValueError(
                        f"per_day mode requires start_time and end_time for enabled day '{day_key}'"
                    )
        return self
    
    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, v: str) -> str:
        """Validate timezone is a valid IANA timezone."""
        try:
            import pytz
            pytz.timezone(v)
        except Exception:
            raise ValueError(f"Invalid timezone: {v}. Must be a valid IANA timezone.")
        return v


class ShiftConflictDetail(BaseModel):
    """Details about a shift conflict."""
    employee_id: UUID
    employee_name: Optional[str] = None
    shift_date: date
    existing_shift_id: UUID
    existing_start_time: time
    existing_end_time: time
    new_start_time: time
    new_end_time: time
    message: str


class PreviewShift(BaseModel):
    """Preview of a shift that would be created."""
    employee_id: UUID
    employee_name: Optional[str] = None
    shift_date: date
    start_time: time
    end_time: time
    break_minutes: int
    status: str
    notes: Optional[str] = None
    job_role: Optional[str] = None
    has_conflict: bool = False
    conflict_detail: Optional[ShiftConflictDetail] = None


class BulkWeekShiftPreviewResponse(BaseModel):
    """Response from preview endpoint."""
    shifts_to_create: List[PreviewShift] = Field(default_factory=list)
    conflicts: List[ShiftConflictDetail] = Field(default_factory=list)
    total_shifts: int = 0
    total_conflicts: int = 0


class BulkWeekShiftCreateResponse(BaseModel):
    """Response from create endpoint."""
    created_count: int = 0
    skipped_count: int = 0
    overwritten_count: int = 0
    created_shift_ids: List[UUID] = Field(default_factory=list)
    skipped_shifts: List[PreviewShift] = Field(default_factory=list)
    conflicts: List[ShiftConflictDetail] = Field(default_factory=list)
    series_id: Optional[UUID] = None

