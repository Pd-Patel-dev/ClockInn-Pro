from pydantic import BaseModel, EmailStr, Field
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
    password: str = Field(..., min_length=8)
    role: UserRole = UserRole.EMPLOYEE
    pin: Optional[str] = Field(None, min_length=4, max_length=4)
    job_role: Optional[str] = Field(None, max_length=255)
    pay_rate: Optional[float] = Field(None, ge=0)


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    status: Optional[UserStatus] = None
    pin: Optional[str] = Field(None, min_length=4, max_length=4)
    job_role: Optional[str] = Field(None, max_length=255)
    pay_rate: Optional[float] = Field(None, ge=0)


class UserResponse(BaseModel):
    id: UUID
    company_id: UUID
    name: str
    email: str
    role: UserRole
    status: UserStatus
    has_pin: bool
    job_role: Optional[str] = None
    pay_rate: Optional[float] = None
    created_at: datetime
    last_login_at: Optional[datetime] = None
    last_punch_at: Optional[datetime] = None

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

    class Config:
        from_attributes = True

