"""
Current-user profile endpoints at /api/v1/me.

Avatar storage: when no object-storage config is present, avatars are stored as
data URLs in `user_avatars` and served via GET /api/v1/me/avatar/raw.
"""
import base64
import io
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from passlib.context import CryptContext
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.error_handling import handle_endpoint_errors, parse_uuid
from app.core.permissions import ROLE_PERMISSIONS
from app.core.security import (
    create_access_token,
    get_password_hash,
    get_pin_hash,
    jwt_company_id_claim,
    normalize_email,
    verify_password,
)
from app.models.audit_log import AuditLog
from app.models.session import Session, UserAvatar
from app.models.user import User, UserRole
from app.schemas.user import (
    ChangeEmailRequest,
    ChangePasswordRequest,
    ChangePinRequest,
    MeUpdate,
    RemovePinRequest,
    RevokeOthersRequest,
    SessionOut,
    UserMeResponse,
)
from app.services.company_service import get_company_settings

logger = logging.getLogger(__name__)
router = APIRouter()
token_context = CryptContext(schemes=["argon2"], deprecated="auto")

SEQUENTIAL_PINS = {
    "0123",
    "1234",
    "2345",
    "3456",
    "4567",
    "5678",
    "6789",
    "9876",
    "8765",
    "7654",
    "6543",
    "5432",
    "4321",
    "3210",
}


def _build_me_response(user: User) -> UserMeResponse:
    company_name = user.company.name if user.company else ("Platform Developer" if user.role == UserRole.DEVELOPER else "")
    email_verified = user.email_verified
    verification_required = user.verification_required
    if user.company:
        csettings = get_company_settings(user.company)
        if not csettings.get("email_verification_required", True):
            email_verified = True
            verification_required = False
    return UserMeResponse(
        id=user.id,
        company_id=user.company_id,
        name=user.name,
        email=user.email,
        role=user.role,
        status=user.status,
        company_name=company_name,
        email_verified=email_verified,
        verification_required=verification_required,
        permissions=sorted(list(ROLE_PERMISSIONS.get(user.role, set()))),
        preferred_name=user.preferred_name,
        phone=user.phone,
        avatar_url=user.avatar_url,
        timezone=user.timezone or "America/Chicago",
        date_format=user.date_format or "MM/DD/YYYY",
        time_format=user.time_format or "12h",
        first_day_of_week=user.first_day_of_week if user.first_day_of_week is not None else 0,
        theme_preference=user.theme_preference or "system",
        created_at=user.created_at,
        last_verified_at=user.last_verified_at,
        has_pin=bool(user.pin_hash),
    )


async def _load_user(db: AsyncSession, user_id) -> User:
    result = await db.execute(
        select(User).options(selectinload(User.company)).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _validate_new_password(password: str) -> Optional[str]:
    if len(password) < 8:
        return "Password must be at least 8 characters"
    if not re.search(r"[A-Za-z]", password):
        return "Password must contain at least one letter"
    if not re.search(r"\d", password):
        return "Password must contain at least one number"
    return None


def _validate_pin_rules(pin: str) -> Optional[str]:
    if not pin.isdigit() or len(pin) != 4:
        return "PIN must be exactly 4 digits"
    if len(set(pin)) == 1:
        return "PIN cannot be all the same digit"
    if pin in SEQUENTIAL_PINS:
        return "PIN cannot be sequential"
    return None


async def _find_current_session(db: AsyncSession, user: User, refresh_token: Optional[str]) -> Optional[Session]:
    if not refresh_token:
        return None
    result = await db.execute(
        select(Session).where(
            Session.user_id == user.id,
            Session.revoked_at.is_(None),
            Session.expires_at > datetime.utcnow(),
        )
    )
    for session in result.scalars().all():
        try:
            if token_context.verify(refresh_token, session.refresh_token_hash):
                return session
        except Exception:
            continue
    return None


@router.get("", response_model=UserMeResponse)
@handle_endpoint_errors(operation_name="get_me_profile")
async def get_me_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _load_user(db, current_user.id)
    return _build_me_response(user)


@router.patch("", response_model=UserMeResponse)
@handle_endpoint_errors(operation_name="patch_me_profile")
async def patch_me_profile(
    body: MeUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _load_user(db, current_user.id)
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(user, field, value)
    db.add(user)
    await db.commit()
    user = await _load_user(db, current_user.id)
    return _build_me_response(user)


@router.post("/avatar")
@handle_endpoint_errors(operation_name="upload_me_avatar")
async def upload_me_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload avatar (jpg/png/webp, max 2MB), resize to 512×512.

    Fallback storage: when no object storage is configured, the image is stored
    as a data URL in `user_avatars` and `avatar_url` points at `/api/v1/me/avatar/raw`.
    """
    content_type = (file.content_type or "").lower()
    if content_type not in ("image/jpeg", "image/png", "image/webp", "image/jpg"):
        raise HTTPException(status_code=400, detail="Avatar must be jpg, png, or webp")
    raw = await file.read()
    if len(raw) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Avatar must be 2 MB or smaller")
    try:
        img = Image.open(io.BytesIO(raw))
        img = img.convert("RGB")
        img.thumbnail((512, 512))
        canvas = Image.new("RGB", (512, 512), (255, 255, 255))
        offset = ((512 - img.width) // 2, (512 - img.height) // 2)
        canvas.paste(img, offset)
        buf = io.BytesIO()
        canvas.save(buf, format="JPEG", quality=85)
        data_url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not process image")

    user = await _load_user(db, current_user.id)
    existing = await db.get(UserAvatar, user.id)
    if existing:
        existing.data_url = data_url
        existing.updated_at = datetime.now(timezone.utc)
        db.add(existing)
    else:
        db.add(UserAvatar(user_id=user.id, data_url=data_url))
    user.avatar_url = "/api/v1/me/avatar/raw"
    db.add(user)
    await db.commit()
    return {"avatar_url": user.avatar_url}


@router.get("/avatar/raw")
@handle_endpoint_errors(operation_name="get_me_avatar_raw")
async def get_me_avatar_raw(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(UserAvatar, current_user.id)
    if not row:
        raise HTTPException(status_code=404, detail="No avatar")
    # data URL → redirect-style inline response via HTML not needed; return JSON for simplicity
    # Clients that use img src with auth headers should use blob fetch; also support data URL return
    return Response(
        content=base64.b64decode(row.data_url.split(",", 1)[1]),
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.delete("/avatar")
@handle_endpoint_errors(operation_name="delete_me_avatar")
async def delete_me_avatar(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _load_user(db, current_user.id)
    row = await db.get(UserAvatar, user.id)
    if row:
        await db.delete(row)
    user.avatar_url = None
    db.add(user)
    await db.commit()
    return {"ok": True}


@router.post("/change-email")
@handle_endpoint_errors(operation_name="change_me_email")
async def change_me_email(
    body: ChangeEmailRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _load_user(db, current_user.id)
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    new_email = normalize_email(str(body.new_email))
    if new_email == user.email:
        raise HTTPException(status_code=400, detail="New email must be different from current email")
    existing = await db.execute(select(User).where(User.email == new_email).limit(1))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already in use on the platform.")
    user.email = new_email
    user.email_verified = False
    user.verification_required = True
    user.last_verified_at = None
    db.add(user)
    await db.commit()
    try:
        from app.services.verification_service import send_verification_pin
        await send_verification_pin(db, user)
    except Exception as e:
        logger.error("Failed to send verification after email change: %s", e)
    return {
        "message": f"Verification email sent to {new_email}. Click the link in the email to complete the change.",
    }


@router.post("/change-password")
@handle_endpoint_errors(operation_name="change_me_password")
async def change_me_password(
    body: ChangePasswordRequest,
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _load_user(db, current_user.id)
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    err = _validate_new_password(body.new_password)
    if err:
        raise HTTPException(status_code=400, detail=err)
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="New password must be different")

    user.password_hash = get_password_hash(body.new_password)
    db.add(user)

    refresh_token = request.cookies.get(settings.REFRESH_TOKEN_COOKIE_NAME)
    current_session = await _find_current_session(db, user, refresh_token)

    result = await db.execute(
        select(Session).where(Session.user_id == user.id, Session.revoked_at.is_(None))
    )
    now = datetime.utcnow()
    for session in result.scalars().all():
        if current_session and session.id == current_session.id:
            continue
        session.revoked_at = now
        db.add(session)

    if user.company_id:
        db.add(
            AuditLog(
                id=uuid.uuid4(),
                company_id=user.company_id,
                actor_user_id=user.id,
                action="auth.password_changed",
                entity_type="user",
                entity_id=user.id,
                metadata_json={"user_id": str(user.id)},
            )
        )
    await db.commit()

    access_token = create_access_token(
        {
            "sub": str(user.id),
            "company_id": jwt_company_id_claim(user.company_id),
            "role": user.role.value,
            "permissions": sorted(list(ROLE_PERMISSIONS.get(user.role, set()))),
        }
    )

    try:
        from app.services.email_service import email_service

        # Best-effort notice (reuse verification sender infrastructure)
        await email_service.send_verification_reminder(user.email)
    except Exception as e:
        logger.warning("Password-change notice email failed: %s", e)

    logger.info("auth.password_changed user=%s", user.email)
    return {
        "message": "Password updated. Other sessions were signed out.",
        "access_token": access_token,
    }


@router.post("/change-pin")
@handle_endpoint_errors(operation_name="change_me_pin")
async def change_me_pin(
    body: ChangePinRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == UserRole.DEVELOPER:
        raise HTTPException(status_code=400, detail="Developers do not use kiosk PINs")
    user = await _load_user(db, current_user.id)
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    err = _validate_pin_rules(body.new_pin)
    if err:
        raise HTTPException(status_code=400, detail=err)
    user.pin_hash = get_pin_hash(body.new_pin)
    db.add(user)
    if user.company_id:
        db.add(
            AuditLog(
                id=uuid.uuid4(),
                company_id=user.company_id,
                actor_user_id=user.id,
                action="auth.pin_changed",
                entity_type="user",
                entity_id=user.id,
                metadata_json={"user_id": str(user.id)},
            )
        )
    await db.commit()
    return {"message": "PIN updated"}


@router.delete("/pin")
@handle_endpoint_errors(operation_name="delete_me_pin")
async def delete_me_pin(
    body: RemovePinRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _load_user(db, current_user.id)
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.pin_hash = None
    db.add(user)
    await db.commit()
    return {"message": "PIN removed"}


@router.get("/sessions", response_model=List[SessionOut])
@handle_endpoint_errors(operation_name="list_me_sessions")
async def list_me_sessions(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    refresh_token = request.cookies.get(settings.REFRESH_TOKEN_COOKIE_NAME)
    current_session = await _find_current_session(db, current_user, refresh_token)
    result = await db.execute(
        select(Session)
        .where(
            Session.user_id == current_user.id,
            Session.revoked_at.is_(None),
            Session.expires_at > datetime.utcnow(),
        )
        .order_by(Session.last_used_at.desc().nullslast(), Session.created_at.desc())
    )
    out: List[SessionOut] = []
    for s in result.scalars().all():
        out.append(
            SessionOut(
                id=s.id,
                device_label=s.device_label or "Unknown device",
                ip_address=s.ip,
                created_at=s.created_at,
                last_used_at=s.last_used_at or s.created_at,
                is_current=bool(current_session and s.id == current_session.id),
            )
        )
    return out


@router.delete("/sessions/{session_id}")
@handle_endpoint_errors(operation_name="revoke_me_session")
async def revoke_me_session(
    session_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sid = parse_uuid(session_id, "Session ID")
    refresh_token = request.cookies.get(settings.REFRESH_TOKEN_COOKIE_NAME)
    current_session = await _find_current_session(db, current_user, refresh_token)
    if current_session and current_session.id == sid:
        raise HTTPException(
            status_code=400,
            detail="Use logout to end the current session.",
        )
    session = await db.get(Session, sid)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.revoked_at:
        return {"ok": True}
    session.revoked_at = datetime.utcnow()
    db.add(session)
    await db.commit()
    return {"ok": True}


@router.post("/sessions/revoke-others")
@handle_endpoint_errors(operation_name="revoke_other_me_sessions")
async def revoke_other_me_sessions(
    body: RevokeOthersRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _load_user(db, current_user.id)
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Password is incorrect")
    refresh_token = request.cookies.get(settings.REFRESH_TOKEN_COOKIE_NAME)
    current_session = await _find_current_session(db, user, refresh_token)
    result = await db.execute(
        select(Session).where(Session.user_id == user.id, Session.revoked_at.is_(None))
    )
    now = datetime.utcnow()
    count = 0
    for session in result.scalars().all():
        if current_session and session.id == current_session.id:
            continue
        session.revoked_at = now
        db.add(session)
        count += 1
    await db.commit()
    return {"revoked": count}
