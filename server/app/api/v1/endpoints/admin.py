"""
Admin maintenance endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from typing import Optional
import logging

from app.core.dependencies import get_current_admin, get_db
from app.core.error_handling import handle_endpoint_errors
from app.models.user import User
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.verification_service import cleanup_expired_verification_data

logger = logging.getLogger(__name__)

router = APIRouter()


class CleanupResponse(BaseModel):
    success: bool
    cleaned_count: int
    cutoff_time: Optional[str] = None
    timestamp: str
    error: Optional[str] = None


@router.post("/cleanup/verification-data", response_model=CleanupResponse)
@handle_endpoint_errors(operation_name="cleanup_verification_data")
async def cleanup_verification_data_endpoint(
    older_than_hours: int = Query(24, ge=1, le=720, description="Clean up PINs expired more than this many hours ago"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Clean up expired verification PINs and old verification data.
    
    This endpoint can be called manually or via cron job to remove orphaned
    verification data that wasn't cleaned up during normal operations.
    
    Admin only endpoint.
    """
    try:
        result = await cleanup_expired_verification_data(db, older_than_hours=older_than_hours)
        return CleanupResponse(**result)
    except Exception as e:
        logger.error(f"Failed to cleanup verification data: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to cleanup verification data: {str(e)}",
        )

