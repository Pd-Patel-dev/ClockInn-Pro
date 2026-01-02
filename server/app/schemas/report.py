from pydantic import BaseModel, Field, model_validator
from typing import List, Optional
from datetime import date
from uuid import UUID


class ReportExportRequest(BaseModel):
    range_type: str = Field(..., pattern="^(weekly|biweekly)$")
    start_date: date
    end_date: date
    format: str = Field(..., pattern="^(pdf|xlsx)$")
    employee_ids: Optional[List[UUID]] = None
    
    @model_validator(mode='after')
    def validate_date_range(self):
        """Validate that start_date is before or equal to end_date."""
        if self.start_date > self.end_date:
            raise ValueError("start_date must be before or equal to end_date")
        return self

