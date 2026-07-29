from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from typing import Optional
from datetime import datetime
from uuid import UUID
from app.models.user import UserRole, UserStatus


def _normalize_email_value(email: str) -> str:
    return email.strip().lower()


class UserBase(BaseModel):
    name: str
    email: EmailStr
    role: UserRole


class UserCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    password: Optional[str] = Field(None, min_length=8, max_length=255)
    role: UserRole = UserRole.FRONTDESK
    pin: Optional[str] = Field(None, min_length=4, max_length=4, pattern="^[0-9]{4}$")
    pay_rate: Optional[float] = Field(None, ge=0)
    # Optional; when present must be set for non-DEVELOPER (admin create supplies company via context)
    company_id: Optional[UUID] = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: EmailStr) -> str:
        return _normalize_email_value(str(v))

    @model_validator(mode="after")
    def validate_role_company(self):
        # Admin employee APIs must never create platform developers
        if self.role == UserRole.DEVELOPER:
            raise ValueError("Cannot create DEVELOPER users through tenant employee APIs")
        return self


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    status: Optional[UserStatus] = None
    role: Optional[UserRole] = None
    pin: Optional[str] = Field(None, min_length=0, max_length=4)
    pay_rate: Optional[float] = Field(None, ge=0)
    company_id: Optional[UUID] = None
    email: Optional[EmailStr] = None

    @field_validator("pin")
    @classmethod
    def validate_pin(cls, v: Optional[str]) -> Optional[str]:
        """Validate PIN is either empty string or exactly 4 numeric digits."""
        if v is None or v == "":
            return v
        if not v.isdigit() or len(v) != 4:
            raise ValueError("PIN must be exactly 4 numeric digits")
        return v

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: Optional[EmailStr]) -> Optional[str]:
        if v is None:
            return v
        return _normalize_email_value(str(v))

    @model_validator(mode="after")
    def validate_role_company(self):
        if self.role == UserRole.DEVELOPER:
            if self.company_id is not None:
                raise ValueError("DEVELOPER users must have company_id = NULL")
            raise ValueError("Cannot assign DEVELOPER role through tenant employee APIs")
        if self.role is not None and self.role != UserRole.DEVELOPER and self.company_id is None:
            # company_id optional on update body; only enforce when explicitly provided as null with role
            pass
        return self


class DeveloperCreate(BaseModel):
    """Create a platform DEVELOPER account (no company)."""
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=255)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: EmailStr) -> str:
        return _normalize_email_value(str(v))


class UserResponse(BaseModel):
    id: UUID
    company_id: Optional[UUID] = None
    name: str
    email: str
    role: UserRole
    status: UserStatus
    has_pin: bool
    pay_rate: Optional[float] = None
    created_at: datetime
    last_login_at: Optional[datetime] = None
    last_punch_at: Optional[datetime] = None
    is_clocked_in: Optional[bool] = None

    class Config:
        from_attributes = True


class UserMeResponse(BaseModel):
    id: UUID
    company_id: Optional[UUID] = None
    name: str
    email: str
    role: UserRole
    status: UserStatus
    company_name: str
    email_verified: bool
    verification_required: bool
    permissions: list[str]

    class Config:
        from_attributes = True


class DeveloperUserResponse(BaseModel):
    """User response for developer portal (includes verification fields)."""
    id: UUID
    company_id: Optional[UUID] = None
    company_name: str
    name: str
    email: str
    role: UserRole
    status: UserStatus
    email_verified: bool
    verification_required: bool
    created_at: datetime
    last_login_at: Optional[datetime] = None
    has_pin: bool = False
    pay_rate: Optional[float] = None

    class Config:
        from_attributes = True


class DeveloperUserUpdate(BaseModel):
    """Developer-only user update (includes verification and all important fields)."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    email: Optional[EmailStr] = None
    role: Optional[UserRole] = None
    status: Optional[UserStatus] = None
    email_verified: Optional[bool] = None
    verification_required: Optional[bool] = None
    pin: Optional[str] = Field(None, min_length=0, max_length=4)
    pay_rate: Optional[float] = Field(None, ge=0)

    @field_validator("pin")
    @classmethod
    def validate_pin(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return v
        if not v.isdigit() or len(v) != 4:
            raise ValueError("PIN must be exactly 4 numeric digits")
        return v

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: Optional[EmailStr]) -> Optional[str]:
        if v is None:
            return v
        return _normalize_email_value(str(v))


class UserRoleUpdate(BaseModel):
    role: UserRole
