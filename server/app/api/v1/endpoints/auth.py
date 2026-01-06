from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.error_handling import handle_endpoint_errors
from app.schemas.auth import (
    RegisterCompanyRequest,
    LoginRequest,
    TokenResponse,
    RefreshTokenRequest,
    LogoutRequest,
)
from app.services.auth_service import register_company, login, refresh_access_token, logout
from app.services.verification_service import send_verification_pin, verify_email_pin
from app.models.user import User
from app.schemas.auth import SendVerificationPinRequest, VerifyEmailRequest

router = APIRouter()


@router.post("/register-company", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="register_company")
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
@handle_endpoint_errors(operation_name="login")
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
@handle_endpoint_errors(operation_name="refresh_token")
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
@handle_endpoint_errors(operation_name="logout")
async def logout_endpoint(
    request: LogoutRequest,
    db: AsyncSession = Depends(get_db),
):
    """Logout and revoke refresh token."""
    await logout(db, request.refresh_token)
    return {"message": "Logged out successfully"}


@router.post("/send-verification-pin")
@handle_endpoint_errors(operation_name="send_verification_pin")
async def send_verification_pin_endpoint(
    request: SendVerificationPinRequest,
    db: AsyncSession = Depends(get_db),
):
    """Send verification PIN to user's email."""
    from sqlalchemy import select
    from app.core.security import normalize_email
    
    normalized_email = normalize_email(request.email)
    
    # Find user by email
    result = await db.execute(
        select(User).where(User.email == normalized_email)
    )
    user = result.scalar_one_or_none()
    
    # Always return success to prevent email enumeration
    if not user:
        return {"message": "If the email exists, a verification code has been sent."}
    
    # Check if user is already verified and doesn't need re-verification
    from app.services.verification_service import check_verification_required
    if not check_verification_required(user):
        # User is already verified and within 30-day window
        return {"message": "Email is already verified."}
    
    # Send verification PIN
    success, error_msg = await send_verification_pin(db, user)
    
    if not success:
        # Don't reveal if email exists - return generic message
        return {"message": "If the email exists, a verification code has been sent."}
    
    return {"message": "Verification code sent to your email."}


@router.post("/verify-email")
@handle_endpoint_errors(operation_name="verify_email")
async def verify_email_endpoint(
    request: VerifyEmailRequest,
    db: AsyncSession = Depends(get_db),
):
    """Verify email with 6-digit PIN."""
    from sqlalchemy import select
    from app.core.security import normalize_email
    
    normalized_email = normalize_email(request.email)
    
    # Find user by email
    result = await db.execute(
        select(User).where(User.email == normalized_email)
    )
    user = result.scalar_one_or_none()
    
    # Always return generic error to prevent email enumeration
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid email or verification code."
        )
    
    # Verify PIN
    success, error_msg = await verify_email_pin(db, user, request.pin)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg or "Invalid email or verification code."
        )
    
    return {"message": "Email verified successfully."}

