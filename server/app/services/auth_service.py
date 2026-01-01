from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import HTTPException, status

from app.models.user import User, UserRole, UserStatus
from app.models.company import Company
from app.models.session import Session
from app.core.security import (
    get_password_hash,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    normalize_email,
    validate_password_strength,
    get_pin_hash,
)
from app.core.config import settings
from app.schemas.auth import RegisterCompanyRequest, LoginRequest
import uuid


async def register_company(
    db: AsyncSession,
    request: RegisterCompanyRequest,
) -> tuple[User, str, str]:
    """Register a new company and create the first admin user."""
    # Validate password strength
    is_valid, error_msg = validate_password_strength(request.admin_password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg,
        )
    
    # Normalize email
    normalized_email = normalize_email(request.admin_email)
    
    # Check if email already exists (globally unique per company, but we check globally for simplicity)
    result = await db.execute(
        select(User).where(User.email == normalized_email)
    )
    existing_user = result.scalar_one_or_none()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )
    
    # Create company
    company = Company(
        id=uuid.uuid4(),
        name=request.company_name,
        settings_json={},
    )
    db.add(company)
    await db.flush()
    
    # Create admin user
    user = User(
        id=uuid.uuid4(),
        company_id=company.id,
        role=UserRole.ADMIN,
        name=request.admin_name,
        email=normalized_email,
        password_hash=get_password_hash(request.admin_password),
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    
    # Create session with refresh token
    refresh_token = create_refresh_token({"sub": str(user.id), "company_id": str(company.id)})
    from passlib.context import CryptContext
    token_context = CryptContext(schemes=["argon2"], deprecated="auto")
    refresh_token_hash = token_context.hash(refresh_token)
    
    session = Session(
        id=uuid.uuid4(),
        user_id=user.id,
        company_id=company.id,
        refresh_token_hash=refresh_token_hash,
        expires_at=datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(session)
    
    await db.commit()
    await db.refresh(user)
    
    access_token = create_access_token({"sub": str(user.id), "company_id": str(company.id), "role": user.role.value})
    
    return user, access_token, refresh_token


async def login(
    db: AsyncSession,
    request: LoginRequest,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> tuple[User, str, str]:
    """Authenticate user and create session."""
    normalized_email = normalize_email(request.email)
    
    result = await db.execute(
        select(User).where(User.email == normalized_email)
    )
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    
    # Update last login
    user.last_login_at = datetime.utcnow()
    await db.flush()
    
    # Create session with refresh token
    refresh_token = create_refresh_token({"sub": str(user.id), "company_id": str(user.company_id)})
    from passlib.context import CryptContext
    token_context = CryptContext(schemes=["argon2"], deprecated="auto")
    refresh_token_hash = token_context.hash(refresh_token)
    
    session = Session(
        id=uuid.uuid4(),
        user_id=user.id,
        company_id=user.company_id,
        refresh_token_hash=refresh_token_hash,
        expires_at=datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        ip=ip,
        user_agent=user_agent,
    )
    db.add(session)
    
    await db.commit()
    await db.refresh(user)
    
    access_token = create_access_token({"sub": str(user.id), "company_id": str(user.company_id), "role": user.role.value})
    
    return user, access_token, refresh_token


async def refresh_access_token(
    db: AsyncSession,
    refresh_token: str,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> tuple[str, str]:
    """Refresh access token and rotate refresh token."""
    payload = decode_token(refresh_token)
    
    if payload is None or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )
    
    user_id = payload.get("sub")
    company_id = payload.get("company_id")
    
    if not user_id or not company_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )
    
    # Find session by refresh token hash
    from passlib.context import CryptContext
    token_context = CryptContext(schemes=["argon2"], deprecated="auto")
    
    # We need to check all sessions for this user and verify the token
    result = await db.execute(
        select(Session).where(
            Session.user_id == uuid.UUID(user_id),
            Session.company_id == uuid.UUID(company_id),
            Session.revoked_at.is_(None),
            Session.expires_at > datetime.utcnow(),
        )
    )
    sessions = result.scalars().all()
    
    matching_session = None
    for session in sessions:
        try:
            if token_context.verify(refresh_token, session.refresh_token_hash):
                matching_session = session
                break
        except:
            continue
    
    if not matching_session:
        # Token reuse detected - revoke all sessions
        for session in sessions:
            session.revoked_at = datetime.utcnow()
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or reused refresh token. All sessions revoked.",
        )
    
    # Revoke old session
    matching_session.revoked_at = datetime.utcnow()
    await db.flush()
    
    # Get user
    result = await db.execute(
        select(User).where(User.id == uuid.UUID(user_id))
    )
    user = result.scalar_one_or_none()
    
    if not user or user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    
    # Create new session with new refresh token
    new_refresh_token = create_refresh_token({"sub": str(user.id), "company_id": str(user.company_id)})
    new_refresh_token_hash = token_context.hash(new_refresh_token)
    
    new_session = Session(
        id=uuid.uuid4(),
        user_id=user.id,
        company_id=user.company_id,
        refresh_token_hash=new_refresh_token_hash,
        expires_at=datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        ip=ip,
        user_agent=user_agent,
    )
    db.add(new_session)
    
    await db.commit()
    
    access_token = create_access_token({"sub": str(user.id), "company_id": str(user.company_id), "role": user.role.value})
    
    return access_token, new_refresh_token


async def logout(
    db: AsyncSession,
    refresh_token: str,
) -> None:
    """Revoke a session."""
    payload = decode_token(refresh_token)
    
    if payload is None or payload.get("type") != "refresh":
        return
    
    user_id = payload.get("sub")
    company_id = payload.get("company_id")
    
    if not user_id or not company_id:
        return
    
    # Find and revoke session
    from passlib.context import CryptContext
    token_context = CryptContext(schemes=["argon2"], deprecated="auto")
    
    result = await db.execute(
        select(Session).where(
            Session.user_id == uuid.UUID(user_id),
            Session.company_id == uuid.UUID(company_id),
            Session.revoked_at.is_(None),
        )
    )
    sessions = result.scalars().all()
    
    for session in sessions:
        try:
            if token_context.verify(refresh_token, session.refresh_token_hash):
                session.revoked_at = datetime.utcnow()
                await db.commit()
                return
        except:
            continue

