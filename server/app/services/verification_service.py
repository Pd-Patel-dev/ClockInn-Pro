"""
Email verification service for generating and validating 6-digit PINs.
"""
import secrets
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import HTTPException, status

from app.models.user import User
from app.core.security import get_pin_hash, verify_pin
from app.services.email_service import email_service

logger = logging.getLogger(__name__)

VERIFICATION_PIN_EXPIRY_MINUTES = 15
VERIFICATION_RESEND_COOLDOWN_SECONDS = 60
MAX_VERIFICATION_ATTEMPTS = 5
VERIFICATION_EXPIRY_DAYS = 30


def generate_verification_pin() -> str:
    """Generate a cryptographically secure 6-digit PIN."""
    return f"{secrets.randbelow(1000000):06d}"


async def send_verification_pin(
    db: AsyncSession,
    user: User,
    force_resend: bool = False
) -> Tuple[bool, Optional[str]]:
    """
    Generate and send a verification PIN to the user.
    
    Uses database-level locking (SELECT FOR UPDATE) to prevent race conditions
    when multiple concurrent requests try to generate PINs for the same user.
    
    Args:
        db: Database session
        user: User to send verification PIN to
        force_resend: If True, bypass cooldown check
        
    Returns:
        Tuple of (success: bool, error_message: Optional[str])
    """
    now = datetime.now(timezone.utc)
    
    # Reload user with SELECT FOR UPDATE lock to prevent race conditions
    # This ensures only one request can generate a PIN at a time for the same user
    try:
        locked_result = await db.execute(
            select(User)
            .where(User.id == user.id)
            .with_for_update()
        )
        user = locked_result.scalar_one()
    except Exception as e:
        logger.error(f"Failed to lock user record for PIN generation: {e}")
        return False, "Unable to process verification request. Please try again in a moment."
    
    # Check if user is already verified and doesn't need re-verification
    if not check_verification_required(user):
        logger.info(
            f"Verification PIN send requested for already verified user",
            extra={
                "user_id": str(user.id),
                "email": user.email,
                "action": "send_pin_skipped_already_verified",
                "timestamp": now.isoformat()
            }
        )
        return False, "Email is already verified."
    
    # Check cooldown period (60 seconds between sends)
    if not force_resend and user.last_verification_sent_at:
        # Ensure both datetimes are timezone-aware for comparison
        last_sent = user.last_verification_sent_at
        if last_sent.tzinfo is None:
            last_sent = last_sent.replace(tzinfo=timezone.utc)
        time_since_last_send = (now - last_sent).total_seconds()
        if time_since_last_send < VERIFICATION_RESEND_COOLDOWN_SECONDS:
            remaining = int(VERIFICATION_RESEND_COOLDOWN_SECONDS - time_since_last_send)
            logger.warning(
                f"Verification PIN send requested during cooldown period",
                extra={
                    "user_id": str(user.id),
                    "email": user.email,
                    "action": "send_pin_cooldown_violation",
                    "seconds_since_last": time_since_last_send,
                    "remaining_seconds": remaining,
                    "timestamp": now.isoformat()
                }
            )
            return False, f"Please wait {remaining} seconds before requesting a new code."
    
    # Check if too many attempts (lockout after 5 failed attempts)
    if user.verification_attempts >= MAX_VERIFICATION_ATTEMPTS:
        # Clear old PIN when max attempts reached
        user.verification_pin_hash = None
        user.verification_expires_at = None
        try:
            db.add(user)
            await db.commit()
        except Exception as e:
            logger.error(f"Failed to clear PIN after max attempts: {e}")
            await db.rollback()
        logger.warning(
            f"Verification PIN send blocked - max attempts reached",
            extra={
                "user_id": str(user.id),
                "email": user.email,
                "action": "send_pin_blocked_max_attempts",
                "attempts": user.verification_attempts,
                "timestamp": now.isoformat()
            }
        )
        return False, "Too many verification attempts. Please request a new code."
    
    # Clear any existing unexpired PIN before generating new one (prevent multiple PINs)
    if user.verification_pin_hash and user.verification_expires_at:
        expires_at = user.verification_expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at > now:
            # Existing PIN is still valid, clear it before generating new one
            user.verification_pin_hash = None
            user.verification_expires_at = None
    
    # Generate new PIN
    pin = generate_verification_pin()
    pin_hash = get_pin_hash(pin)
    expires_at = now + timedelta(minutes=VERIFICATION_PIN_EXPIRY_MINUTES)
    
    # Update user record
    user.verification_pin_hash = pin_hash
    user.verification_expires_at = expires_at
    user.verification_attempts = 0  # Reset attempts on new PIN
    user.last_verification_sent_at = now
    
    try:
        db.add(user)
        await db.commit()
        await db.refresh(user)
    except Exception as e:
        logger.error(f"Failed to save verification PIN: {e}")
        await db.rollback()
        return False, "Failed to generate verification code. Please try again."
    
    # Send email
    email_sent = await email_service.send_verification_email(user.email, pin)
    
    if not email_sent:
        logger.error(
            f"Failed to send verification email",
            extra={
                "user_id": str(user.id),
                "email": user.email,
                "action": "send_pin_email_failed",
                "timestamp": now.isoformat()
            }
        )
        # Clear PIN since email failed - user needs to request new one
        user.verification_pin_hash = None
        user.verification_expires_at = None
        user.verification_attempts = 0
        try:
            db.add(user)
            await db.commit()
        except Exception as e:
            logger.error(f"Failed to clear PIN after email failure: {e}")
            await db.rollback()
        return False, "Verification code could not be sent. Please try again."
    
    logger.info(
        f"Verification PIN sent successfully",
        extra={
            "user_id": str(user.id),
            "email": user.email,
            "action": "send_pin_success",
            "expires_at": expires_at.isoformat(),
            "timestamp": now.isoformat()
        }
    )
    return True, None


async def verify_email_pin(
    db: AsyncSession,
    user: User,
    pin: str
) -> Tuple[bool, Optional[str]]:
    """
    Verify the email verification PIN.
    
    Args:
        db: Database session
        user: User to verify
        pin: 6-digit verification PIN
        
    Returns:
        Tuple of (success: bool, error_message: Optional[str])
    """
    now = datetime.now(timezone.utc)
    
    # Check if PIN exists
    if not user.verification_pin_hash:
        logger.warning(
            f"Verification attempt with no PIN",
            extra={
                "user_id": str(user.id),
                "email": user.email,
                "action": "verify_pin_no_pin",
                "timestamp": now.isoformat()
            }
        )
        return False, "No verification code found. Please request a new code."
    
    # Check if PIN expired
    expires_at = user.verification_expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    
    if not expires_at or expires_at < now:
        # Clear expired PIN from database
        user.verification_pin_hash = None
        user.verification_expires_at = None
        user.verification_attempts = 0
        try:
            db.add(user)
            await db.commit()
        except Exception as e:
            logger.error(f"Failed to clear expired PIN: {e}")
            await db.rollback()
        logger.warning(
            f"Verification attempt with expired PIN",
            extra={
                "user_id": str(user.id),
                "email": user.email,
                "action": "verify_pin_expired",
                "expired_at": expires_at.isoformat() if expires_at else None,
                "timestamp": now.isoformat()
            }
        )
        return False, "Verification code has expired. Please request a new code."
    
    # Check attempts
    if user.verification_attempts >= MAX_VERIFICATION_ATTEMPTS:
        # Clear PIN since max attempts reached - user needs to request new one
        user.verification_pin_hash = None
        user.verification_expires_at = None
        user.verification_attempts = 0
        try:
            db.add(user)
            await db.commit()
        except Exception as e:
            logger.error(f"Failed to clear PIN after max attempts: {e}")
            await db.rollback()
        logger.warning(
            f"Verification attempt blocked - max attempts already reached",
            extra={
                "user_id": str(user.id),
                "email": user.email,
                "action": "verify_pin_blocked_max_attempts",
                "attempts": user.verification_attempts,
                "timestamp": now.isoformat()
            }
        )
        return False, "Too many verification attempts. Please request a new code."
    
    # Verify PIN
    pin_valid = verify_pin(pin, user.verification_pin_hash)
    if not pin_valid:
        # Increment attempts
        user.verification_attempts += 1
        try:
            db.add(user)
            await db.commit()
        except Exception as e:
            logger.error(f"Failed to update verification attempts: {e}")
            await db.rollback()
        
        remaining_attempts = MAX_VERIFICATION_ATTEMPTS - user.verification_attempts
        logger.warning(
            f"Invalid verification PIN provided",
            extra={
                "user_id": str(user.id),
                "email": user.email,
                "action": "verify_pin_invalid",
                "attempts": user.verification_attempts,
                "remaining_attempts": remaining_attempts,
                "timestamp": now.isoformat()
            }
        )
        if remaining_attempts > 0:
            return False, f"Invalid verification code. {remaining_attempts} attempt(s) remaining."
        else:
            # Last attempt failed - clear PIN and reset attempts
            user.verification_pin_hash = None
            user.verification_expires_at = None
            user.verification_attempts = 0
            try:
                db.add(user)
                await db.commit()
            except Exception as e:
                logger.error(f"Failed to clear PIN after max attempts reached: {e}")
                await db.rollback()
            logger.warning(
                f"Max verification attempts reached - PIN cleared",
                extra={
                    "user_id": str(user.id),
                    "email": user.email,
                    "action": "verify_pin_max_attempts_reached",
                    "final_attempts": user.verification_attempts,
                    "timestamp": now.isoformat()
                }
            )
            return False, "Too many failed attempts. Please request a new code."
    
    # PIN is valid - mark as verified
    user.email_verified = True
    user.verification_required = False
    user.last_verified_at = now
    user.verification_pin_hash = None  # Clear PIN
    user.verification_expires_at = None
    user.verification_attempts = 0
    
    try:
        db.add(user)
        await db.commit()
        await db.refresh(user)
        logger.info(
            f"Email verification successful",
            extra={
                "user_id": str(user.id),
                "email": user.email,
                "action": "verify_pin_success",
                "verification_date": now.isoformat(),
                "last_verified_at": user.last_verified_at.isoformat() if user.last_verified_at else None,
                "timestamp": now.isoformat()
            }
        )
        return True, None
    except Exception as e:
        logger.error(f"Failed to mark email as verified: {e}")
        await db.rollback()
        return False, "Failed to verify email. Please try again."


def check_verification_required(user: User) -> bool:
    """
    Check if user requires email verification.
    
    This is a pure function that does NOT modify the user object.
    Callers should set user.verification_required = True and commit if this returns True.
    
    Returns True if:
    - email_verified is False, OR
    - last_verified_at + 30 days < now
    
    Note: This function does NOT modify the user object or commit to the database.
    Callers are responsible for updating user.verification_required and committing changes.
    """
    if not user.email_verified:
        return True
    
    if not user.last_verified_at:
        return True
    
    last_verified = user.last_verified_at
    if last_verified and last_verified.tzinfo is None:
        last_verified = last_verified.replace(tzinfo=timezone.utc)
    
    expiry_date = last_verified + timedelta(days=VERIFICATION_EXPIRY_DAYS)
    if expiry_date < datetime.now(timezone.utc):
        # Verification is required, but we don't modify the user object here
        # Callers should set user.verification_required = True and commit
        return True
    
    return False


async def cleanup_expired_verification_data(
    db: AsyncSession,
    older_than_hours: int = 24
) -> dict:
    """
    Clean up expired verification PINs and old verification data.
    
    This function should be called periodically (e.g., daily via cron job)
    to remove orphaned verification data that wasn't cleaned up during normal operations.
    
    Args:
        db: Database session
        older_than_hours: Clean up PINs expired more than this many hours ago (default 24)
        
    Returns:
        Dictionary with cleanup statistics
    """
    now = datetime.now(timezone.utc)
    cutoff_time = now - timedelta(hours=older_than_hours)
    
    from sqlalchemy import and_, or_
    
    # Find users with expired PINs that are older than cutoff
    result = await db.execute(
        select(User).where(
            and_(
                User.verification_pin_hash.isnot(None),
                or_(
                    User.verification_expires_at.is_(None),
                    User.verification_expires_at < cutoff_time
                )
            )
        )
    )
    users_with_expired_pins = result.scalars().all()
    
    cleaned_count = 0
    for user in users_with_expired_pins:
        try:
            # Clear expired verification data
            user.verification_pin_hash = None
            user.verification_expires_at = None
            user.verification_attempts = 0
            db.add(user)
            cleaned_count += 1
        except Exception as e:
            logger.error(f"Failed to clean verification data for user {user.id}: {e}")
    
    try:
        await db.commit()
        logger.info(
            f"Cleanup completed: {cleaned_count} users with expired verification data cleaned",
            extra={
                "action": "cleanup_expired_verification_data",
                "cleaned_count": cleaned_count,
                "cutoff_time": cutoff_time.isoformat(),
                "timestamp": now.isoformat()
            }
        )
    except Exception as e:
        logger.error(f"Failed to commit cleanup: {e}")
        await db.rollback()
        return {
            "success": False,
            "cleaned_count": 0,
            "error": str(e)
        }
    
    return {
        "success": True,
        "cleaned_count": cleaned_count,
        "cutoff_time": cutoff_time.isoformat(),
        "timestamp": now.isoformat()
    }

