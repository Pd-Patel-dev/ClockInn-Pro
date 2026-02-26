from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional
from datetime import datetime
from uuid import UUID
from app.models.user import UserRole, UserStatus


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


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    status: Optional[UserStatus] = None
    role: Optional[UserRole] = None
    pin: Optional[str] = Field(None, min_length=0, max_length=4)
    pay_rate: Optional[float] = Field(None, ge=0)
    
    @field_validator('pin')
    @classmethod
    def validate_pin(cls, v: Optional[str]) -> Optional[str]:
        """Validate PIN is either empty string or exactly 4 numeric digits."""
        if v is None or v == "":
            return v
        if not v.isdigit() or len(v) != 4:
            raise ValueError("PIN must be exactly 4 numeric digits")
        return v


class UserResponse(BaseModel):
    id: UUID
    company_id: UUID
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
    company_id: UUID
    name: str
    email: str
    role: UserRole
    status: UserStatus
    company_name: str
    email_verified: bool
    verification_required: bool

    class Config:
        from_attributes = True

