"""
Developer-only endpoints for system monitoring and administration.
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
            select(func.count(User.id)).where(User.role == UserRole.EMPLOYEE)
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
        
        # Database connection test
        try:
            await db.execute(text("SELECT 1"))
            stats["database_status"] = "connected"
        except Exception as e:
            stats["database_status"] = "disconnected"
            stats["database_error"] = str(e)
        
        # Email service status - detailed
        email_info = {
            "initialized": email_service.service is not None,
            "has_credentials": email_service.creds is not None,
            "sender_email": settings.GMAIL_SENDER_EMAIL,
        }
        
        # Add token expiration info if credentials exist
        if email_service.creds:
            email_info["token_valid"] = email_service.creds.valid
            email_info["token_expired"] = email_service.creds.expired
            email_info["has_refresh_token"] = bool(email_service.creds.refresh_token)
            if email_service.creds.expiry:
                email_info["token_expires_at"] = email_service.creds.expiry.isoformat()
                now = datetime.now(timezone.utc)
                if email_service.creds.expiry > now:
                    time_until_expiry = (email_service.creds.expiry - now).total_seconds()
                    email_info["token_expires_in_seconds"] = int(time_until_expiry)
                    email_info["token_expires_in_hours"] = round(time_until_expiry / 3600, 2)
        
        stats["email_service"] = email_info
        
        # Configuration status (non-sensitive)
        # Check for Gmail credentials - can be in env vars or files
        from pathlib import Path
        # Path from server/app/api/v1/endpoints/developer.py to server/ directory
        server_root = Path(__file__).parent.parent.parent.parent.parent
        gmail_creds_file = server_root / 'gmail_credentials.json'
        gmail_token_file = server_root / 'gmail_token.json'
        
        gmail_credentials_configured = (
            bool(settings.GMAIL_CREDENTIALS_JSON) or 
            gmail_creds_file.exists()
        )
        gmail_token_configured = (
            bool(settings.GMAIL_TOKEN_JSON) or 
            gmail_token_file.exists()
        )
        
        # Parse CORS origins for display
        cors_origins_list = []
        if settings.CORS_ORIGINS:
            if isinstance(settings.CORS_ORIGINS, list):
                cors_origins_list = settings.CORS_ORIGINS
            elif isinstance(settings.CORS_ORIGINS, str):
                cors_origins_list = [origin.strip() for origin in settings.CORS_ORIGINS.split(',')]
        
        # Database URL info (non-sensitive parts only)
        database_info = {}
        if settings.DATABASE_URL:
            db_url = settings.DATABASE_URL
            # Extract non-sensitive parts
            if '@' in db_url:
                # Format: postgresql://user:pass@host:port/db
                parts = db_url.split('@')
                if len(parts) == 2:
                    # Extract host and database
                    after_at = parts[1]
                    if '/' in after_at:
                        host_port = after_at.split('/')[0]
                        database = after_at.split('/')[1].split('?')[0] if '/' in after_at else None
                        database_info["host"] = host_port.split(':')[0] if ':' in host_port else host_port
                        database_info["port"] = host_port.split(':')[1] if ':' in host_port else "5432"
                        database_info["database"] = database
                    database_info["provider"] = "postgresql"
                    if "supabase" in db_url.lower():
                        database_info["provider"] = "supabase"
        
        stats["configuration"] = {
            "database_configured": bool(settings.DATABASE_URL),
            "database_info": database_info,
            "secret_key_configured": bool(settings.SECRET_KEY),
            "gmail_credentials_configured": gmail_credentials_configured,
            "gmail_token_configured": gmail_token_configured,
            "gmail_credentials_source": "env_var" if settings.GMAIL_CREDENTIALS_JSON else ("file" if gmail_creds_file.exists() else "none"),
            "gmail_token_source": "env_var" if settings.GMAIL_TOKEN_JSON else ("file" if gmail_token_file.exists() else "none"),
            "cors_origins_configured": bool(settings.CORS_ORIGINS),
            "cors_origins": cors_origins_list,
            "frontend_url": settings.FRONTEND_URL,
            "refresh_token_expire_days": settings.REFRESH_TOKEN_EXPIRE_DAYS,
            "access_token_expire_minutes": settings.ACCESS_TOKEN_EXPIRE_MINUTES,
            "rate_limit_enabled": settings.RATE_LIMIT_ENABLED,
            "rate_limit_per_minute": settings.RATE_LIMIT_PER_MINUTE,
        }
        
    except Exception as e:
        logger.error(f"Error fetching developer stats: {e}", exc_info=True)
        stats["error"] = str(e)
    
    return stats


@router.get("/system-info")
@handle_endpoint_errors(operation_name="get_system_info")
async def get_system_info(
    current_user: User = Depends(get_current_developer),
    db: AsyncSession = Depends(get_db),
):
    """
    Get system information for developers.
    Includes environment details, configuration status, etc.
    """
    import platform
    import sys
    from pathlib import Path
    
    # Check for Gmail files
    server_root_info = Path(__file__).parent.parent.parent.parent.parent
    gmail_creds_file_info = server_root_info / 'gmail_credentials.json'
    gmail_token_file_info = server_root_info / 'gmail_token.json'
    
    info = {
        "python_version": sys.version,
        "platform": platform.platform(),
        "system": platform.system(),
        "processor": platform.processor(),
        "server_time": datetime.now(timezone.utc).isoformat(),
        "timezone": "UTC",
        "environment": {
            "api_version": "1.0.0",
            "database_url_configured": bool(settings.DATABASE_URL),
            "secret_key_configured": bool(settings.SECRET_KEY),
            "cors_enabled": bool(settings.CORS_ORIGINS),
        },
        "email_service": {
            "sender_email": settings.GMAIL_SENDER_EMAIL,
            "credentials_configured": bool(settings.GMAIL_CREDENTIALS_JSON) or gmail_creds_file_info.exists(),
            "token_configured": bool(settings.GMAIL_TOKEN_JSON) or gmail_token_file_info.exists(),
            "initialized": email_service.service is not None,
            "has_credentials": email_service.creds is not None,
            "token_valid": email_service.creds.valid if email_service.creds else False,
        },
        "security": {
            "refresh_token_expire_days": settings.REFRESH_TOKEN_EXPIRE_DAYS,
            "access_token_expire_minutes": settings.ACCESS_TOKEN_EXPIRE_MINUTES,
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

