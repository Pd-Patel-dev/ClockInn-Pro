from pydantic import BaseModel, Field, model_validator
from typing import Optional
from datetime import date, datetime
from uuid import UUID
from app.models.leave_request import LeaveType, LeaveStatus


class LeaveRequestCreate(BaseModel):
    type: LeaveType
    start_date: date
    end_date: date
    partial_day_hours: Optional[int] = Field(None, ge=0, le=8)
    reason: Optional[str] = Field(None, max_length=1000)
    
    @model_validator(mode='after')
    def validate_date_range(self):
        """Validate that start_date is before or equal to end_date."""
        if self.start_date > self.end_date:
            raise ValueError("start_date must be before or equal to end_date")
        return self


class LeaveRequestUpdate(BaseModel):
    status: LeaveStatus
    review_comment: Optional[str] = Field(None, max_length=1000)


class LeaveRequestResponse(BaseModel):
    id: UUID
    employee_id: UUID
    employee_name: str
    type: LeaveType
    start_date: date
    end_date: date
    partial_day_hours: Optional[int] = None
    reason: Optional[str] = None
    status: LeaveStatus
    reviewed_by: Optional[UUID] = None
    review_comment: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class LeaveRequestListResponse(BaseModel):
    requests: list[LeaveRequestResponse]
    total: int

