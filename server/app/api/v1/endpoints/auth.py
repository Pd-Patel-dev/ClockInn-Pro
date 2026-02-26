from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
import uuid

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.error_handling import handle_endpoint_errors
from app.schemas.auth import (
    RegisterCompanyRequest,
    LoginRequest,
    TokenResponse,
    RefreshTokenRequest,
    LogoutRequest,
    SetPasswordRequest,
)
from app.services.auth_service import register_company, login, refresh_access_token, logout
from app.services.verification_service import send_verification_pin, verify_email_pin
from app.models.user import User
from app.schemas.auth import SendVerificationPinRequest, VerifyEmailRequest, ForgotPasswordRequest, ResetPasswordRequest
from app.services.password_reset_service import send_password_reset_otp, verify_otp_and_reset_password
from app.core.security import normalize_email

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
    # Log received data for debugging (only in development)
    import os
    import logging
    logger = logging.getLogger(__name__)
    if os.getenv("ENVIRONMENT", "").lower() not in ["prod", "production"]:
        logger.debug(f"Login attempt for email: {login_data.email[:3]}***")
    
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


@router.post("/forgot-password")
@handle_endpoint_errors(operation_name="forgot_password")
async def forgot_password_endpoint(
    request: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """Request a 6-digit OTP to be sent to the given email for password reset."""
    normalized_email = normalize_email(request.email)
    success, error_msg = await send_password_reset_otp(db, normalized_email)
    if not success and error_msg:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)
    return {"message": "If an account exists with this email, a verification code has been sent."}


@router.post("/reset-password")
@handle_endpoint_errors(operation_name="reset_password_after_otp")
async def reset_password_after_otp_endpoint(
    request: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """Verify OTP and set new password (forgot password flow)."""
    normalized_email = normalize_email(request.email)
    success, error_msg = await verify_otp_and_reset_password(
        db, normalized_email, request.otp, request.new_password
    )
    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg or "Invalid request.")
    return {"message": "Password has been reset. You can now log in with your new password."}


@router.get("/set-password/info")
@handle_endpoint_errors(operation_name="get_password_setup_info")
async def get_password_setup_info(
    token: str = Query(..., description="Password setup token"),
    db: AsyncSession = Depends(get_db),
):
    """Get user information from password setup token."""
    from sqlalchemy import select
    from app.core.security import decode_token, normalize_email
    
    # Decode and verify token
    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired token."
        )
    
    # Check token type
    if payload.get("type") != "password_setup":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid token type."
        )
    
    user_id = payload.get("sub")
    token_email = payload.get("email")
    
    if not user_id or not token_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid token payload."
        )
    
    # Find user
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid user ID in token."
        )
    
    result = await db.execute(
        select(User).where(User.id == user_uuid)
    )
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )
    
    # Verify email matches
    normalized_email = normalize_email(token_email)
    if normalize_email(user.email) != normalized_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token email does not match user email."
        )
    
    return {
        "name": user.name,
        "email": user.email,
    }


@router.post("/set-password")
@handle_endpoint_errors(operation_name="set_password")
async def set_password_endpoint(
    request: SetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """Set password for new employee using setup token."""
    from sqlalchemy import select
    from app.core.security import (
        decode_token,
        validate_password_strength,
        get_password_hash,
        normalize_email,
    )
    
    # Decode and verify token
    payload = decode_token(request.token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired token."
        )
    
    # Check token type
    if payload.get("type") != "password_setup":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid token type."
        )
    
    user_id = payload.get("sub")
    token_email = payload.get("email")
    
    if not user_id or not token_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid token payload."
        )
    
    # Validate password strength
    is_valid, error_msg = validate_password_strength(request.password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg,
        )
    
    # Find user
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid user ID in token."
        )
    
    result = await db.execute(
        select(User).where(User.id == user_uuid)
    )
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )
    
    # Verify email matches
    normalized_email = normalize_email(token_email)
    if normalize_email(user.email) != normalized_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token email does not match user email."
        )
    
    # Set password
    user.password_hash = get_password_hash(request.password)
    
    try:
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return {"message": "Password set successfully. You can now log in."}
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to set password: {str(e)}"
        )

