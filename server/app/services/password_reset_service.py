"""
Password reset service: send OTP and verify OTP + set new password.
Security: user lookup uses parameterized queries (no SQL injection);
responses are generic to prevent user enumeration; constant-time when user not found.
"""
import asyncio
import secrets
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.user import User
from app.core.security import get_pin_hash, verify_pin, get_password_hash, validate_password_strength
from app.services.email_service import email_service

logger = logging.getLogger(__name__)

PASSWORD_RESET_OTP_EXPIRY_MINUTES = 15
PASSWORD_RESET_RESEND_COOLDOWN_SECONDS = 60
MAX_PASSWORD_RESET_ATTEMPTS = 5
# Minimize timing difference between "user not found" and "user found" paths
CONSTANT_TIME_DELAY_SECONDS = 0.3


def _generate_otp() -> str:
    """Generate a cryptographically secure 6-digit OTP."""
    return f"{secrets.randbelow(1000000):06d}"


async def send_password_reset_otp(db: AsyncSession, email_normalized: str) -> Tuple[bool, Optional[str]]:
    """
    Find user by email (parameterized query), generate 6-digit OTP, store hash, send email.
    Returns (success, error_message). Caller must not expose error_message to clients
    to avoid user enumeration. When user not found, we delay to reduce timing leakage.
    """
    result = await db.execute(select(User).where(User.email == email_normalized))
    user = result.scalar_one_or_none()
    if not user:
        await asyncio.sleep(CONSTANT_TIME_DELAY_SECONDS)
        return True, None  # Don't reveal whether email exists

    now = datetime.now(timezone.utc)
    try:
        locked_result = await db.execute(
            select(User).where(User.id == user.id).with_for_update()
        )
        user = locked_result.scalar_one()
    except Exception as e:
        logger.error(f"Failed to lock user for password reset OTP: {e}")
        return False, "Please try again in a moment."

    # Cooldown: do not expose to client (would leak user existence)
    if user.last_password_reset_sent_at:
        last = user.last_password_reset_sent_at
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if (now - last).total_seconds() < PASSWORD_RESET_RESEND_COOLDOWN_SECONDS:
            return True, None  # Same as "user not found" - generic success

    # Max attempts: do not expose to client
    if user.password_reset_attempts >= MAX_PASSWORD_RESET_ATTEMPTS:
        user.password_reset_otp_hash = None
        user.password_reset_otp_expires_at = None
        user.password_reset_attempts = 0
        db.add(user)
        await db.commit()
        return True, None  # Generic success, no leak

    # Clear any existing valid OTP before generating new one
    if user.password_reset_otp_hash and user.password_reset_otp_expires_at:
        exp = user.password_reset_otp_expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp > now:
            user.password_reset_otp_hash = None
            user.password_reset_otp_expires_at = None

    otp = _generate_otp()
    otp_hash = get_pin_hash(otp)
    expires_at = now + timedelta(minutes=PASSWORD_RESET_OTP_EXPIRY_MINUTES)

    user.password_reset_otp_hash = otp_hash
    user.password_reset_otp_expires_at = expires_at
    user.password_reset_attempts = 0
    user.last_password_reset_sent_at = now
    db.add(user)
    await db.commit()
    await db.refresh(user)

    sent = await email_service.send_password_reset_otp(user.email, otp)
    if not sent:
        user.password_reset_otp_hash = None
        user.password_reset_otp_expires_at = None
        user.password_reset_attempts = 0
        db.add(user)
        await db.commit()
        logger.warning("Password reset email send failed for user_id=%s", user.id)
        # Return success anyway so we don't leak that the account exists
        return True, None

    return True, None


async def verify_otp_and_reset_password(
    db: AsyncSession,
    email_normalized: str,
    otp: str,
    new_password: str,
) -> Tuple[bool, Optional[str]]:
    """
    Verify OTP for the user and set new password. Returns (success, error_message).
    """
    result = await db.execute(select(User).where(User.email == email_normalized))
    user = result.scalar_one_or_none()
    if not user:
        return False, "Invalid email or verification code."

    now = datetime.now(timezone.utc)

    if not user.password_reset_otp_hash:
        return False, "Invalid email or verification code."

    exp = user.password_reset_otp_expires_at
    if exp and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if not exp or exp < now:
        user.password_reset_otp_hash = None
        user.password_reset_otp_expires_at = None
        user.password_reset_attempts = 0
        db.add(user)
        await db.commit()
        return False, "Verification code has expired. Please request a new code."

    if user.password_reset_attempts >= MAX_PASSWORD_RESET_ATTEMPTS:
        user.password_reset_otp_hash = None
        user.password_reset_otp_expires_at = None
        user.password_reset_attempts = 0
        db.add(user)
        await db.commit()
        return False, "Too many failed attempts. Please request a new code."

    if not verify_pin(otp, user.password_reset_otp_hash):
        user.password_reset_attempts += 1
        db.add(user)
        await db.commit()
        remaining = MAX_PASSWORD_RESET_ATTEMPTS - user.password_reset_attempts
        if remaining > 0:
            return False, f"Invalid code. {remaining} attempt(s) remaining."
        user.password_reset_otp_hash = None
        user.password_reset_otp_expires_at = None
        user.password_reset_attempts = 0
        db.add(user)
        await db.commit()
        return False, "Too many failed attempts. Please request a new code."

    is_valid, err_msg = validate_password_strength(new_password)
    if not is_valid:
        return False, err_msg or "Invalid password."

    user.password_hash = get_password_hash(new_password)
    user.password_reset_otp_hash = None
    user.password_reset_otp_expires_at = None
    user.password_reset_attempts = 0
    db.add(user)
    await db.commit()
    logger.info(f"Password reset successful for user {user.id} ({user.email})")
    return True, None
