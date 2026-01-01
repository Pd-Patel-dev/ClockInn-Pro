from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import date
from uuid import UUID


class ReportExportRequest(BaseModel):
    range_type: str = Field(..., pattern="^(weekly|biweekly)$")
    start_date: date
    end_date: date
    format: str = Field(..., pattern="^(pdf|xlsx)$")
    employee_ids: Optional[List[UUID]] = None

