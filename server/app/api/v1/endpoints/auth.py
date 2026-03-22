from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
import logging
import uuid

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.error_handling import handle_endpoint_errors, client_error_detail
from app.schemas.auth import (
    RegisterCompanyRequest,
    LoginRequest,
    TokenResponse,
    RefreshTokenRequest,
    LogoutRequest,
    SetPasswordRequest,
    VerifyEmailRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
)
from app.services.auth_service import register_company, login, refresh_access_token, logout
from app.services.verification_service import send_verification_pin, verify_email_pin
from app.models.user import User
from app.services.password_reset_service import send_password_reset_otp, verify_otp_and_reset_password
from app.core.security import normalize_email

logger = logging.getLogger(__name__)

router = APIRouter()

# Cookie settings for refresh token (HttpOnly, Secure, SameSite to prevent XSS access)
def _refresh_cookie_max_age() -> int:
    return settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60


def _refresh_cookie_scope_kwargs() -> dict:
    """Path/secure/httponly/samesite/domain must match on set and delete or browsers may not clear the cookie."""
    kw: dict = {
        "path": "/",
        "secure": settings.COOKIE_SECURE,
        "httponly": True,
        "samesite": settings.COOKIE_SAMESITE.lower(),
    }
    if settings.COOKIE_DOMAIN:
        kw["domain"] = settings.COOKIE_DOMAIN
    return kw


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        key=settings.REFRESH_TOKEN_COOKIE_NAME,
        value=refresh_token,
        max_age=_refresh_cookie_max_age(),
        **_refresh_cookie_scope_kwargs(),
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.REFRESH_TOKEN_COOKIE_NAME,
        **_refresh_cookie_scope_kwargs(),
    )


@router.post("/register-company", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="register_company")
async def register_company_endpoint(
    request: RegisterCompanyRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Register a new company and create the first admin user. Sets refresh token in HttpOnly cookie."""
    user, access_token, refresh_token = await register_company(db, request)
    _set_refresh_cookie(response, refresh_token)
    return TokenResponse(
        access_token=access_token,
        refresh_token=None,
    )


@router.post("/login", response_model=TokenResponse)
@handle_endpoint_errors(operation_name="login")
async def login_endpoint(
    request: Request,
    login_data: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Login with email and password. Sets refresh token in HttpOnly cookie. Credentials in body only."""
    ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    user, access_token, refresh_token = await login(db, login_data, ip=ip, user_agent=user_agent)
    _set_refresh_cookie(response, refresh_token)
    return TokenResponse(
        access_token=access_token,
        refresh_token=None,
    )


@router.post("/refresh", response_model=TokenResponse)
@handle_endpoint_errors(operation_name="refresh_token")
async def refresh_token_endpoint(
    request: Request,
    response: Response,
    refresh_data: RefreshTokenRequest | None = Body(None),
    db: AsyncSession = Depends(get_db),
):
    """Refresh access token and rotate refresh token. Reads refresh token from HttpOnly cookie (or body for backwards compatibility)."""
    refresh_token = request.cookies.get(settings.REFRESH_TOKEN_COOKIE_NAME)
    if not refresh_token and refresh_data and refresh_data.refresh_token:
        refresh_token = refresh_data.refresh_token
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token required (cookie or body).",
        )
    access_token, new_refresh_token = await refresh_access_token(
        db,
        refresh_token,
        ip=None,
        user_agent=None,
    )
    _set_refresh_cookie(response, new_refresh_token)
    return TokenResponse(
        access_token=access_token,
        refresh_token=None,
    )


@router.post("/logout")
@handle_endpoint_errors(operation_name="logout")
async def logout_endpoint(
    request: Request,
    response: Response,
    body: LogoutRequest | None = Body(None),
    db: AsyncSession = Depends(get_db),
):
    """Logout and revoke refresh token. Reads from HttpOnly cookie (or body for backwards compatibility)."""
    refresh_token = request.cookies.get(settings.REFRESH_TOKEN_COOKIE_NAME)
    if not refresh_token and body and body.refresh_token:
        refresh_token = body.refresh_token
    if refresh_token:
        await logout(db, refresh_token)
    _clear_refresh_cookie(response)
    return {"message": "Logged out successfully"}


@router.post("/send-verification-pin")
@handle_endpoint_errors(operation_name="send_verification_pin")
async def send_verification_pin_endpoint(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send verification PIN to the registered email only (current user's email)."""
    from app.services.verification_service import check_verification_required_for_user

    if not await check_verification_required_for_user(db, current_user):
        return {"message": "Email is already verified."}

    success, error_msg = await send_verification_pin(db, current_user)
    if not success:
        return {"message": "If the email exists, a verification code has been sent."}
    return {"message": "Verification code sent to your email."}


@router.post("/verify-email")
@handle_endpoint_errors(operation_name="verify_email")
async def verify_email_endpoint(
    request: VerifyEmailRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verify email with 6-digit PIN. Only the registered (current user) email can be verified."""
    from app.core.security import normalize_email

    normalized_request_email = normalize_email(request.email)
    if normalized_request_email != normalize_email(current_user.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid email or verification code.",
        )

    success, error_msg = await verify_email_pin(db, current_user, request.pin)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg or "Invalid email or verification code.",
        )
    return {"message": "Email verified successfully."}


@router.post("/forgot-password")
@handle_endpoint_errors(operation_name="forgot_password")
async def forgot_password_endpoint(
    request: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """Request a 6-digit OTP to be sent to the given email for password reset.
    Returns an error if the email is not registered."""
    normalized_email = normalize_email(request.email)
    success, error_msg = await send_password_reset_otp(db, normalized_email)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg or "No account is registered with this email.",
        )
    return {"message": "A verification code has been sent to your email."}


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
        logger.error("set_password commit failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=client_error_detail(
                dev_detail=f"Failed to set password: {str(e)}",
                prod_detail="Failed to set password. Please try again.",
            ),
        )

