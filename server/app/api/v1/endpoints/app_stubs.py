from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.dependencies import get_current_active_user
from app.models.user import User

notifications_router = APIRouter()
feedback_router = APIRouter()


@notifications_router.get("/unread-count")
async def notifications_unread_count(
    current_user: User = Depends(get_current_active_user),
):
    return {"count": 0}


class FeedbackBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)
    type: str | None = Field(None, max_length=32)


@feedback_router.post("")
async def submit_feedback(
    body: FeedbackBody,
    current_user: User = Depends(get_current_active_user),
):
    return {"ok": True}
