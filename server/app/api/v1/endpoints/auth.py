from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.schemas.auth import (
    RegisterCompanyRequest,
    LoginRequest,
    TokenResponse,
    RefreshTokenRequest,
    LogoutRequest,
)
from app.services.auth_service import register_company, login, refresh_access_token, logout
from app.models.user import User

router = APIRouter()


@router.post("/register-company", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register_company_endpoint(
    request: RegisterCompanyRequest,
    db: AsyncSession = Depends(get_db),
):
    """Register a new company and create the first admin user."""
    user, access_token, refresh_token = await register_company(db, request)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.post("/login", response_model=TokenResponse)
async def login_endpoint(
    login_data: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """Login with email and password."""
    # IP and user agent are optional - can be added later if needed
    user, access_token, refresh_token = await login(db, login_data, ip=None, user_agent=None)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token_endpoint(
    refresh_data: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    """Refresh access token and rotate refresh token."""
    # IP and user agent are optional - can be added later if needed
    access_token, refresh_token = await refresh_access_token(
        db,
        refresh_data.refresh_token,
        ip=None,
        user_agent=None,
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.post("/logout")
async def logout_endpoint(
    request: LogoutRequest,
    db: AsyncSession = Depends(get_db),
):
    """Logout and revoke refresh token."""
    await logout(db, request.refresh_token)
    return {"message": "Logged out successfully"}

