from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime


class RegisterCompanyRequest(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=255)
    admin_name: str = Field(..., min_length=1, max_length=255)
    admin_email: EmailStr
    admin_password: str = Field(..., min_length=8)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str

