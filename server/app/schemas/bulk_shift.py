"""
Bulk Shift Creation Schemas

Handles creating multiple shifts for a week for a single employee.
"""
from typing import List, Optional, Dict, Literal
from datetime import date, time
from pydantic import BaseModel, Field, field_validator, model_validator
from uuid import UUID


class DayTemplate(BaseModel):
    """Template for a single day's shift."""
    enabled: bool = True
    start_time: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$", description="HH:mm format")
    end_time: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$", description="HH:mm format")
    break_minutes: Optional[int] = Field(None, ge=0, le=1440, description="Break minutes (0-1440)")


class BulkWeekShiftTemplate(BaseModel):
    """Template for creating shifts across a week."""
    start_time: str = Field(..., pattern=r"^\d{2}:\d{2}$", description="HH:mm format")
    end_time: str = Field(..., pattern=r"^\d{2}:\d{2}$", description="HH:mm format")
    break_minutes: int = Field(0, ge=0, le=1440, description="Break minutes (0-1440)")
    status: Literal["DRAFT", "PUBLISHED", "APPROVED"] = Field("DRAFT", description="Initial shift status")
    notes: Optional[str] = Field(None, max_length=1000, description="Notes for all shifts")
    job_role: Optional[str] = Field(None, max_length=255, description="Job role override")
    
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
    timezone: str = Field("America/Chicago", description="IANA timezone (e.g., America/Chicago)")
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

