from pydantic import BaseModel, EmailStr, Field, model_validator
from typing import Optional
from datetime import datetime


class RegisterCompanyRequest(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=255)
    admin_name: str = Field(..., min_length=1, max_length=255)
    admin_email: EmailStr
    admin_password: str = Field(..., min_length=8)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=255)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None  # Omitted when using HttpOnly cookie
    token_type: str = "bearer"


class RefreshTokenRequest(BaseModel):
    """
    Deprecated: send an empty body and rely on the HttpOnly refresh cookie.
    Body `refresh_token` remains for backwards compatibility and will be removed in a future release.
    """

    refresh_token: Optional[str] = Field(
        default=None,
        description="Deprecated. Use the refresh_token HttpOnly cookie only (empty JSON body).",
        json_schema_extra={"deprecated": True},
    )


class LogoutRequest(BaseModel):
    """Optional body for legacy clients; prefer HttpOnly refresh cookie."""

    refresh_token: Optional[str] = Field(
        default=None,
        description="Deprecated. Use the refresh_token HttpOnly cookie only (empty JSON body).",
        json_schema_extra={"deprecated": True},
    )


class SendVerificationPinRequest(BaseModel):
    """Optional; when authenticated, PIN is always sent to the registered email only."""
    email: Optional[EmailStr] = None


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    pin: str = Field(..., min_length=6, max_length=6, pattern="^[0-9]{6}$")


class SetPasswordRequest(BaseModel):
    token: str
    password: str = Field(..., min_length=8, max_length=255)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    otp: str = Field(..., min_length=6, max_length=6, pattern="^[0-9]{6}$")
    new_password: str = Field(..., min_length=8, max_length=255)
    confirm_password: str = Field(..., min_length=8, max_length=255)

    @model_validator(mode="after")
    def passwords_match(self):
        if self.new_password != self.confirm_password:
            raise ValueError("Passwords do not match")
        return self

