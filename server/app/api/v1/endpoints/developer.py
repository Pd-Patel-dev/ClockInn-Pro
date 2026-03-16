"""
Developer-only endpoints for system monitoring and administration.
All routes require DEVELOPER role (get_current_developer).
Responses must not expose details that could help attackers (e.g. secret names,
token expiry, file paths, CORS origins, or database host/port).
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, date as date_type
from uuid import UUID
import uuid
import logging

from app.core.dependencies import get_current_developer
from app.core.database import get_db
from app.core.error_handling import handle_endpoint_errors, parse_uuid
from app.core.security import get_password_hash, normalize_email, validate_password_strength
from app.models.user import User, UserRole, UserStatus
from app.models.company import Company
from app.models.session import Session
from app.models.time_entry import TimeEntry
from app.services.email_service import email_service
from app.services.company_service import get_company_info, get_company_settings, update_company_settings
from app.services.user_service import get_user_by_id_any, update_user_developer
from app.schemas.company import (
    CompanyInfoResponse,
    CompanySettingsResponse,
    CompanySettingsUpdate,
    AdminInfo,
)
from app.schemas.user import DeveloperUserResponse, DeveloperUserUpdate
from app.core.config import settings
from pydantic import BaseModel, EmailStr, Field

logger = logging.getLogger(__name__)

router = APIRouter()


class DeveloperAccountCreate(BaseModel):
    """Request body for creating a new developer account (developer-only)."""
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=255)


@router.get("/stats")
@handle_endpoint_errors(operation_name="get_developer_stats")
async def get_developer_stats(
    current_user: User = Depends(get_current_developer),
    db: AsyncSession = Depends(get_db),
):
    """
    Get comprehensive system statistics for developers.
    Includes user counts, company counts, database stats, etc.
    """
    stats = {}
    
    try:
        # User statistics
        total_users_result = await db.execute(select(func.count(User.id)))
        stats["total_users"] = total_users_result.scalar_one() or 0
        
        active_users_result = await db.execute(
            select(func.count(User.id)).where(User.status == UserStatus.ACTIVE)
        )
        stats["active_users"] = active_users_result.scalar_one() or 0
        
        admin_users_result = await db.execute(
            select(func.count(User.id)).where(User.role == UserRole.ADMIN)
        )
        stats["admin_users"] = admin_users_result.scalar_one() or 0
        
        employee_users_result = await db.execute(
            select(func.count(User.id)).where(
                User.role.in_([UserRole.MAINTENANCE, UserRole.FRONTDESK, UserRole.HOUSEKEEPING])
            )
        )
        stats["employee_users"] = employee_users_result.scalar_one() or 0
        
        developer_users_result = await db.execute(
            select(func.count(User.id)).where(User.role == UserRole.DEVELOPER)
        )
        stats["developer_users"] = developer_users_result.scalar_one() or 0
        
        # Verified users count
        verified_users_result = await db.execute(
            select(func.count(User.id)).where(User.email_verified == True)
        )
        stats["verified_users"] = verified_users_result.scalar_one() or 0
        
        # Company statistics
        total_companies_result = await db.execute(select(func.count(Company.id)))
        stats["total_companies"] = total_companies_result.scalar_one() or 0
        
        # Active sessions
        active_sessions_result = await db.execute(
            select(func.count(Session.id)).where(
                Session.revoked_at.is_(None),
                Session.expires_at > datetime.now(timezone.utc)
            )
        )
        stats["active_sessions"] = active_sessions_result.scalar_one() or 0
        
        # Time entries statistics
        total_time_entries_result = await db.execute(select(func.count(TimeEntry.id)))
        stats["total_time_entries"] = total_time_entries_result.scalar_one() or 0
        
        # Today's time entries
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        today_entries_result = await db.execute(
            select(func.count(TimeEntry.id)).where(
                TimeEntry.created_at >= today_start
            )
        )
        stats["today_time_entries"] = today_entries_result.scalar_one() or 0
        
        # Database connection test (do not expose error details to response)
        try:
            await db.execute(text("SELECT 1"))
            stats["database_status"] = "connected"
        except Exception as e:
            logger.debug(f"Database check failed: {e}")
            stats["database_status"] = "disconnected"
        
        # Email service status - match frontend Email tab (initialized, has_credentials, gmail_credentials_configured, etc.)
        try:
            from pathlib import Path
            server_root = Path(__file__).parent.parent.parent.parent.parent
            gmail_creds_file = server_root / 'gmail_credentials.json'
            gmail_token_file = server_root / 'gmail_token.json'
            gmail_credentials_configured = (
                bool(settings.GMAIL_CREDENTIALS_JSON) or gmail_creds_file.exists()
            )
            gmail_token_configured = (
                bool(settings.GMAIL_TOKEN_JSON) or gmail_token_file.exists()
            )
            configured = email_service.service is not None and email_service.creds is not None
            operational = False
            if email_service.creds:
                try:
                    operational = getattr(email_service.creds, "valid", True) and not getattr(email_service.creds, "expired", False)
                except Exception:
                    pass
            stats["email_service"] = {
                "initialized": configured,
                "has_credentials": configured,
                "sender_email": "N/A",
                "configured": configured,
                "operational": operational,
            }
            stats["configuration"] = {
                "database_configured": bool(settings.DATABASE_URL),
                "auth_configured": bool(settings.SECRET_KEY),
                "email_configured": gmail_credentials_configured and gmail_token_configured,
                "cors_configured": bool(settings.CORS_ORIGINS),
                "gmail_credentials_configured": gmail_credentials_configured,
                "gmail_token_configured": gmail_token_configured,
            }
        except Exception as e:
            logger.warning(f"Error getting email service info: {e}")
            stats["email_service"] = {
                "initialized": False,
                "has_credentials": False,
                "sender_email": "N/A",
                "configured": False,
                "operational": False,
            }
            stats["configuration"] = {
                "database_configured": False,
                "auth_configured": False,
                "email_configured": False,
                "cors_configured": False,
                "gmail_credentials_configured": False,
                "gmail_token_configured": False,
            }
        
    except Exception as e:
        logger.error(f"Error fetching developer stats: {e}", exc_info=True)
        # Ensure email_service and configuration are always set even on error
        if "email_service" not in stats:
            stats["email_service"] = {"configured": False, "operational": False}
        if "configuration" not in stats:
            stats["configuration"] = {
                "database_configured": False,
                "auth_configured": False,
                "email_configured": False,
                "cors_configured": False,
            }
        stats["error"] = str(e)
    
    return stats


@router.get("/system-info")
@handle_endpoint_errors(operation_name="get_system_info")
async def get_system_info(
    current_user: User = Depends(get_current_developer),
    db: AsyncSession = Depends(get_db),
):
    """
    Get minimal system information for developers.
    Only high-level status booleans; no secret names, token details, or paths.
    """
    import platform
    import sys
    from pathlib import Path

    server_root_info = Path(__file__).parent.parent.parent.parent.parent
    gmail_creds_file_info = server_root_info / 'gmail_credentials.json'
    gmail_token_file_info = server_root_info / 'gmail_token.json'

    email_configured = (
        (bool(settings.GMAIL_CREDENTIALS_JSON) or gmail_creds_file_info.exists())
        and (bool(settings.GMAIL_TOKEN_JSON) or gmail_token_file_info.exists())
    )
    email_operational = False
    if email_service.creds:
        try:
            email_operational = getattr(email_service.creds, "valid", True) and not getattr(email_service.creds, "expired", False)
        except Exception:
            pass

    info = {
        "api_version": "1.0.0",
        "environment": {
            "database_configured": bool(settings.DATABASE_URL),
            "auth_configured": bool(settings.SECRET_KEY),
            "email_configured": email_configured,
            "email_operational": email_operational,
            "cors_configured": bool(settings.CORS_ORIGINS),
        },
        "runtime": {
            "python_version": sys.version.split()[0],
            "platform": platform.system(),
        },
    }

    return info


@router.get("/recent-activity")
@handle_endpoint_errors(operation_name="get_recent_activity")
async def get_recent_activity(
    limit: int = 50,
    current_user: User = Depends(get_current_developer),
    db: AsyncSession = Depends(get_db),
):
    """
    Get recent system activity for developers.
    Includes recent registrations, logins, etc.
    """
    from datetime import timedelta
    
    activity = []
    
    try:
        # Recent user registrations (last 7 days)
        week_ago = datetime.now(timezone.utc) - timedelta(days=7)
        recent_users_result = await db.execute(
            select(User).where(
                User.created_at >= week_ago
            ).order_by(User.created_at.desc()).limit(limit)
        )
        recent_users = recent_users_result.scalars().all()
        
        for user in recent_users:
            activity.append({
                "type": "user_registered",
                "timestamp": user.created_at.isoformat() if user.created_at else None,
                "details": {
                    "email": user.email,
                    "role": user.role.value,
                    "status": user.status.value,
                }
            })
        
        # Recent logins (users with last_login_at in last 7 days)
        recent_logins_result = await db.execute(
            select(User).where(
                User.last_login_at.isnot(None),
                User.last_login_at >= week_ago
            ).order_by(User.last_login_at.desc()).limit(limit)
        )
        recent_logins = recent_logins_result.scalars().all()
        
        for user in recent_logins:
            activity.append({
                "type": "user_login",
                "timestamp": user.last_login_at.isoformat() if user.last_login_at else None,
                "details": {
                    "email": user.email,
                    "role": user.role.value,
                }
            })
        
        # Sort by timestamp descending
        activity.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
        
    except Exception as e:
        logger.error(f"Error fetching recent activity: {e}", exc_info=True)
    
    return {
        "activity": activity[:limit],
        "count": len(activity),
    }


def _build_company_info_response(company: Company, settings: Dict, admin_user: Optional[User]) -> CompanyInfoResponse:
    """Build CompanyInfoResponse from company, settings dict, and optional admin user."""
    biweekly_anchor = None
    if settings.get("biweekly_anchor_date"):
        try:
            biweekly_anchor = date_type.fromisoformat(settings["biweekly_anchor_date"])
        except (ValueError, TypeError):
            pass
    admin_info = None
    if admin_user:
        admin_info = AdminInfo(
            id=str(admin_user.id),
            name=admin_user.name,
            email=admin_user.email,
            created_at=admin_user.created_at.isoformat(),
            last_login_at=admin_user.last_login_at.isoformat() if admin_user.last_login_at else None,
        )
    return CompanyInfoResponse(
        id=str(company.id),
        name=company.name,
        slug=company.slug,
        kiosk_enabled=company.kiosk_enabled,
        created_at=company.created_at.isoformat(),
        settings=CompanySettingsResponse(
            timezone=settings["timezone"],
            payroll_week_start_day=settings["payroll_week_start_day"],
            biweekly_anchor_date=biweekly_anchor,
            overtime_enabled=settings["overtime_enabled"],
            overtime_threshold_hours_per_week=settings["overtime_threshold_hours_per_week"],
            overtime_multiplier_default=settings["overtime_multiplier_default"],
            rounding_policy=settings["rounding_policy"],
            breaks_paid=settings["breaks_paid"],
            cash_drawer_enabled=settings.get("cash_drawer_enabled", False),
            cash_drawer_required_for_all=settings.get("cash_drawer_required_for_all", False),
            cash_drawer_required_roles=settings.get("cash_drawer_required_roles", []),
            cash_drawer_currency=settings.get("cash_drawer_currency", "USD"),
            cash_drawer_starting_amount_cents=settings.get("cash_drawer_starting_amount_cents", 0),
            cash_drawer_variance_threshold_cents=settings.get("cash_drawer_variance_threshold_cents", 2000),
            cash_drawer_allow_edit=settings.get("cash_drawer_allow_edit", True),
            cash_drawer_require_manager_review=settings.get("cash_drawer_require_manager_review", False),
            schedule_day_start_hour=settings.get("schedule_day_start_hour", 7),
            schedule_day_end_hour=settings.get("schedule_day_end_hour", 7),
            shift_notes_enabled=settings.get("shift_notes_enabled", True),
            shift_notes_required_on_clock_out=settings.get("shift_notes_required_on_clock_out", False),
            shift_notes_allow_edit_after_clock_out=settings.get("shift_notes_allow_edit_after_clock_out", False),
            email_verification_required=settings.get("email_verification_required", True),
            geofence_enabled=settings.get("geofence_enabled", False),
            office_latitude=settings.get("office_latitude"),
            office_longitude=settings.get("office_longitude"),
            geofence_radius_meters=settings.get("geofence_radius_meters", 100),
            kiosk_network_restriction_enabled=settings.get("kiosk_network_restriction_enabled", False),
            kiosk_allowed_ips=settings.get("kiosk_allowed_ips") or [],
        ),
        admin=admin_info,
    )


@router.get("/companies")
@handle_endpoint_errors(operation_name="list_companies_developer")
async def list_companies_developer(
    current_user: User = Depends(get_current_developer),
    db: AsyncSession = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """List all companies (developer only). Click company to view details."""
    result = await db.execute(
        select(Company).order_by(Company.name.asc()).offset(skip).limit(limit)
    )
    companies = result.scalars().all()
    company_ids = [c.id for c in companies]
    counts = {}
    if company_ids:
        count_result = await db.execute(
            select(User.company_id, func.count(User.id)).where(
                User.company_id.in_(company_ids)
            ).group_by(User.company_id)
        )
        for cid, cnt in count_result.all():
            counts[cid] = cnt
    return [
        {
            "id": str(c.id),
            "name": c.name,
            "slug": c.slug,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "user_count": counts.get(c.id, 0),
        }
        for c in companies
    ]


@router.post("/accounts", status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="create_developer_account")
async def create_developer_account(
    data: DeveloperAccountCreate,
    current_user: User = Depends(get_current_developer),
    db: AsyncSession = Depends(get_db),
):
    """Create a new developer account (developer only). New account is in the same company as the creating developer (super account)."""
    is_valid, error_msg = validate_password_strength(data.password)
    if not is_valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)
    normalized_email = normalize_email(data.email)
    result = await db.execute(
        select(User).where(
            User.company_id == current_user.company_id,
            User.email == normalized_email,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists in this company.",
        )
    password_hash = get_password_hash(data.password)
    now = datetime.now(timezone.utc)
    new_user = User(
        id=uuid.uuid4(),
        company_id=current_user.company_id,
        role=UserRole.DEVELOPER,
        name=data.name.strip(),
        email=normalized_email,
        password_hash=password_hash,
        status=UserStatus.ACTIVE,
        email_verified=True,
        verification_required=False,
        last_verified_at=now,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return {
        "id": str(new_user.id),
        "name": new_user.name,
        "email": new_user.email,
        "role": new_user.role.value,
        "message": "Developer account created. They can log in with the email and password you set.",
    }


@router.get("/companies/{company_id}", response_model=CompanyInfoResponse)
@handle_endpoint_errors(operation_name="get_company_developer")
async def get_company_developer(
    company_id: str,
    current_user: User = Depends(get_current_developer),
    db: AsyncSession = Depends(get_db),
):
    """Get full company info by ID (developer only). Access by clicking company name."""
    cid = parse_uuid(company_id, "Company ID")
    company = await get_company_info(db, cid)
    settings = get_company_settings(company)
    admin_result = await db.execute(
        select(User).where(
            User.company_id == cid,
            User.role == UserRole.ADMIN,
        ).order_by(User.created_at.asc()).limit(1)
    )
    admin_user = admin_result.scalar_one_or_none()
    return _build_company_info_response(company, settings, admin_user)


@router.put("/companies/{company_id}/settings", response_model=CompanyInfoResponse)
@handle_endpoint_errors(operation_name="update_company_settings_developer")
async def update_company_settings_developer(
    company_id: str,
    data: CompanySettingsUpdate,
    current_user: User = Depends(get_current_developer),
    db: AsyncSession = Depends(get_db),
):
    """Update company settings (developer only). Use to e.g. disable email verification for a company."""
    cid = parse_uuid(company_id, "Company ID")
    await get_company_info(db, cid)  # 404 if not found
    company = await update_company_settings(db, cid, data, updated_by=current_user.id)
    settings = get_company_settings(company)
    admin_result = await db.execute(
        select(User).where(
            User.company_id == cid,
            User.role == UserRole.ADMIN,
        ).order_by(User.created_at.asc()).limit(1)
    )
    admin_user = admin_result.scalar_one_or_none()
    return _build_company_info_response(company, settings, admin_user)


@router.get("/companies/{company_id}/users")
@handle_endpoint_errors(operation_name="list_company_users_developer")
async def list_company_users_developer(
    company_id: str,
    current_user: User = Depends(get_current_developer),
    db: AsyncSession = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=500),
):
    """List all users for a company (developer only)."""
    cid = parse_uuid(company_id, "Company ID")
    company = await get_company_info(db, cid)
    result = await db.execute(
        select(User).where(User.company_id == cid).order_by(User.name.asc()).offset(skip).limit(limit)
    )
    users = result.scalars().all()
    company_name = company.name
    return [
        DeveloperUserResponse(
            id=u.id,
            company_id=u.company_id,
            company_name=company_name,
            name=u.name,
            email=u.email,
            role=u.role,
            status=u.status,
            email_verified=u.email_verified,
            verification_required=u.verification_required,
            created_at=u.created_at,
            last_login_at=u.last_login_at,
            has_pin=u.pin_hash is not None,
            pay_rate=float(u.pay_rate) if u.pay_rate is not None else None,
        )
        for u in users
    ]


@router.get("/users/{user_id}", response_model=DeveloperUserResponse)
@handle_endpoint_errors(operation_name="get_user_developer")
async def get_user_developer(
    user_id: str,
    current_user: User = Depends(get_current_developer),
    db: AsyncSession = Depends(get_db),
):
    """Get any user by ID (developer only)."""
    uid = parse_uuid(user_id, "User ID")
    user = await get_user_by_id_any(db, uid)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    company_name = user.company.name if user.company else ""
    return DeveloperUserResponse(
        id=user.id,
        company_id=user.company_id,
        company_name=company_name,
        name=user.name,
        email=user.email,
        role=user.role,
        status=user.status,
        email_verified=user.email_verified,
        verification_required=user.verification_required,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
        has_pin=user.pin_hash is not None,
        pay_rate=float(user.pay_rate) if user.pay_rate is not None else None,
    )


@router.put("/users/{user_id}", response_model=DeveloperUserResponse)
@handle_endpoint_errors(operation_name="update_user_developer")
async def update_user_developer_endpoint(
    user_id: str,
    data: DeveloperUserUpdate,
    current_user: User = Depends(get_current_developer),
    db: AsyncSession = Depends(get_db),
):
    """Update any user (developer only). Includes verification and all important fields."""
    uid = parse_uuid(user_id, "User ID")
    user = await update_user_developer(db, uid, data, actor_user_id=current_user.id)
    await db.refresh(user)
    company_name = user.company.name if user.company else ""
    return DeveloperUserResponse(
        id=user.id,
        company_id=user.company_id,
        company_name=company_name,
        name=user.name,
        email=user.email,
        role=user.role,
        status=user.status,
        email_verified=user.email_verified,
        verification_required=user.verification_required,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
        has_pin=user.pin_hash is not None,
        pay_rate=float(user.pay_rate) if user.pay_rate is not None else None,
    )
