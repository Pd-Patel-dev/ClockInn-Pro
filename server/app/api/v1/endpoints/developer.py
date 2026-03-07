"""
Developer-only endpoints for system monitoring and administration.
All routes require DEVELOPER role (get_current_developer).
Responses must not expose details that could help attackers (e.g. secret names,
token expiry, file paths, CORS origins, or database host/port).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
import logging

from app.core.dependencies import get_current_developer
from app.core.database import get_db
from app.models.user import User, UserRole, UserStatus
from app.models.company import Company
from app.models.session import Session
from app.models.time_entry import TimeEntry
from app.services.email_service import email_service
from app.core.config import settings
from app.core.error_handling import handle_endpoint_errors

logger = logging.getLogger(__name__)

router = APIRouter()


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
        
        # Email service status - minimal to avoid helping attackers (no token expiry, paths, or sender)
        try:
            email_info = {
                "configured": email_service.service is not None and email_service.creds is not None,
                "operational": False,
            }
            if email_service.creds:
                try:
                    email_info["operational"] = getattr(email_service.creds, "valid", True) and not getattr(email_service.creds, "expired", False)
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"Error getting email service info: {e}")
            email_info = {"configured": False, "operational": False}
        
        stats["email_service"] = email_info
        
        # Configuration status - minimal booleans only; no secret names, paths, origins, or token settings
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
            stats["configuration"] = {
                "database_configured": bool(settings.DATABASE_URL),
                "auth_configured": bool(settings.SECRET_KEY),
                "email_configured": gmail_credentials_configured and gmail_token_configured,
                "cors_configured": bool(settings.CORS_ORIGINS),
            }
        except Exception as e:
            logger.warning(f"Error getting configuration info: {e}")
            stats["configuration"] = {
                "database_configured": False,
                "auth_configured": False,
                "email_configured": False,
                "cors_configured": False,
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

