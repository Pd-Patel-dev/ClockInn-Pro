from pydantic import BaseModel, Field
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from typing import Literal


OccupancyStatus = Literal["departing", "stayover"]
CleaningStatus = Literal["clean", "dirty"]


class RoomCreate(BaseModel):
    number: str = Field(..., min_length=1, max_length=32)
    room_type: str = Field(default="Standard", min_length=1, max_length=64)


class RoomUpdate(BaseModel):
    number: Optional[str] = Field(None, min_length=1, max_length=32)
    room_type: Optional[str] = Field(None, min_length=1, max_length=64)
    occupancy_status: Optional[OccupancyStatus] = None
    cleaning_status: Optional[CleaningStatus] = None
    is_active: Optional[bool] = None
    assigned_housekeeper_id: Optional[UUID] = None


class RoomBulkUpdate(BaseModel):
    room_ids: List[UUID] = Field(..., min_length=1, max_length=200)
    occupancy_status: Optional[OccupancyStatus] = None
    cleaning_status: Optional[CleaningStatus] = None


class RoomAssignRequest(BaseModel):
    housekeeper_id: UUID
    room_ids: List[UUID] = Field(..., min_length=1, max_length=200)


class RoomUnassignRequest(BaseModel):
    room_ids: List[UUID] = Field(..., min_length=1, max_length=200)


class RoomResponse(BaseModel):
    id: UUID
    company_id: UUID
    number: str
    room_type: str
    occupancy_status: str
    cleaning_status: str
    assigned_housekeeper_id: Optional[UUID] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class HousekeepingSheetCreate(BaseModel):
    housekeeper_id: UUID
    room_ids: List[UUID] = Field(..., min_length=1, max_length=200)
    notes: Optional[str] = Field(None, max_length=1000)


class HousekeepingFinalizeRequest(BaseModel):
    housekeeper_id: UUID
    notes: Optional[str] = Field(None, max_length=1000)


class HousekeepingSheetItemResponse(BaseModel):
    id: UUID
    room_id: Optional[UUID] = None
    room_number: str
    room_type: str
    occupancy_status: str
    cleaning_status: str

    class Config:
        from_attributes = True


class HousekeepingSheetResponse(BaseModel):
    id: UUID
    company_id: UUID
    housekeeper_id: Optional[UUID] = None
    housekeeper_name: str
    created_by: Optional[UUID] = None
    created_by_name: Optional[str] = None
    notes: Optional[str] = None
    kind: Optional[str] = None
    created_at: datetime
    items: List[HousekeepingSheetItemResponse] = []

    class Config:
        from_attributes = True


class HousekeepingSheetListResponse(BaseModel):
    sheets: List[HousekeepingSheetResponse]
    total: int
    total_rooms: int = 0


class HousekeeperOption(BaseModel):
    id: UUID
    name: str
    email: str
