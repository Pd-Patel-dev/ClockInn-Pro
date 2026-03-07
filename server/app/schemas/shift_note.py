"""Pydantic schemas for Shift Notepad / Common Log."""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class ShiftNoteUpdateContent(BaseModel):
    """Body for updating current shift note content (autosave)."""
    content: str = Field(..., description="Note content (plain text)")
    beverage_sold: Optional[int] = Field(None, ge=0, description="Number of beverages sold (optional)")


class ShiftNoteResponse(BaseModel):
    """Full shift note for employee current note or admin detail."""
    id: str
    company_id: str
    time_entry_id: str
    employee_id: str
    employee_name: Optional[str] = None
    content: str
    beverage_sold: Optional[int] = None
    status: str  # DRAFT, SUBMITTED, REVIEWED
    last_edited_at: Optional[datetime] = None
    last_edited_by: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    # Shift metadata (when available)
    clock_in_at: Optional[datetime] = None
    clock_out_at: Optional[datetime] = None
    is_shift_open: Optional[bool] = None
    can_edit: Optional[bool] = None

    class Config:
        from_attributes = True


class ShiftNoteListItem(BaseModel):
    """List item for admin common log left panel."""
    id: str
    time_entry_id: str
    employee_id: str
    employee_name: str
    clock_in_at: Optional[datetime] = None
    clock_out_at: Optional[datetime] = None
    preview: str  # First 1-2 lines
    beverage_sold: Optional[int] = None
    status: str
    updated_at: datetime
    last_edited_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None
    updated_since_review: bool = False
    cash_delta_cents: Optional[int] = None

    class Config:
        from_attributes = True


class ShiftNoteListResponse(BaseModel):
    """Paginated list of shift notes for admin."""
    items: list[ShiftNoteListItem]
    total: int


class ShiftNoteReviewRequest(BaseModel):
    """Optional body for review action."""
    pass


class ShiftNoteCommentCreate(BaseModel):
    """Create a manager comment on a shift note."""
    comment: str = Field(..., min_length=1, max_length=2000)


class ShiftNoteCommentResponse(BaseModel):
    """A single comment on a shift note."""
    id: str
    shift_note_id: str
    actor_user_id: str
    actor_name: Optional[str] = None
    comment: str
    created_at: datetime

    class Config:
        from_attributes = True
