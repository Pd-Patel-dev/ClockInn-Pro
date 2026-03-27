"""Batch payload for the admin schedule page (employees + shifts + timeline settings)."""
from typing import List

from pydantic import BaseModel, Field

from app.schemas.shift import ShiftResponse
from app.schemas.user import UserResponse


class SchedulePageContextResponse(BaseModel):
    employees: List[UserResponse]
    shifts: List[ShiftResponse]
    schedule_day_start_hour: int = Field(default=7, ge=0, le=23)
    schedule_day_end_hour: int = Field(default=7, ge=0, le=23)
