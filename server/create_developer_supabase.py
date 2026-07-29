#!/usr/bin/env python3
"""
Script to create a platform developer account in Supabase (company_id=NULL).

Usage:
    python create_developer_supabase.py

Environment Variables:
    DATABASE_URL: PostgreSQL connection string (Supabase format) [required]
    DEVELOPER_INITIAL_PASSWORD: Optional. If set, use this as the new account password;
        otherwise a random password is generated and printed once.

Example:
    export DATABASE_URL="postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres"
    python create_developer_supabase.py
"""
import asyncio
import logging
import secrets
import sys
import os
from pathlib import Path

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
import uuid
from datetime import datetime, timezone
import ssl

from app.models.user import User, UserRole, UserStatus
from app.core.security import get_password_hash, normalize_email
from app.core.config import settings


async def create_developer_account_supabase():
    """Create a platform developer account with company_id=NULL."""
    print("=" * 60)
    print("Creating Platform Developer Account")
    print("=" * 60)

    database_url = settings.DATABASE_URL
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    connect_args = {}
    is_supabase = (
        "supabase.co" in database_url
        or "supabase" in database_url.lower()
        or "pooler.supabase.com" in database_url
    )

    if is_supabase:
        print("✓ Detected Supabase connection - configuring SSL...")
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        connect_args = {"ssl": ssl_context}
    else:
        print("ℹ Using standard PostgreSQL connection...")

    print("✓ Connecting to database...")
    engine = create_async_engine(database_url, echo=False, connect_args=connect_args)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        try:
            developer_email = "pd.dev267@gmail.com"
            normalized_email = normalize_email(developer_email)

            print(f"\n📧 Checking for existing user: {developer_email}")

            result = await db.execute(select(User).where(User.email == normalized_email))
            existing_user = result.scalar_one_or_none()

            if existing_user:
                if existing_user.role == UserRole.DEVELOPER:
                    if existing_user.company_id is not None:
                        existing_user.company_id = None
                        db.add(existing_user)
                        await db.commit()
                        await db.refresh(existing_user)
                        print("\n✓ Cleared company_id on existing developer (now platform-level).")
                    else:
                        print("\n✓ Developer account already exists!")
                    print(f"  📧 Email: {developer_email}")
                    print(f"  🆔 User ID: {existing_user.id}")
                    print(f"  👤 Role: {existing_user.role.value}")
                    print(f"  🏢 Company ID: {existing_user.company_id}")
                    return
                else:
                    print(f"\n⚠️  User exists with role: {existing_user.role.value}")
                    print("   Updating to DEVELOPER role (company_id=NULL)...")
                    existing_user.role = UserRole.DEVELOPER
                    existing_user.company_id = None
                    existing_user.email_verified = True
                    existing_user.verification_required = False
                    existing_user.last_verified_at = datetime.now(timezone.utc)
                    db.add(existing_user)
                    await db.commit()
                    await db.refresh(existing_user)
                    print("\n✓ Updated existing user to platform DEVELOPER!")
                    print(f"  📧 Email: {developer_email}")
                    print(f"  🆔 User ID: {existing_user.id}")
                    return

            print("✓ No existing user found. Creating new platform developer account...")

            initial_password = os.getenv("DEVELOPER_INITIAL_PASSWORD") or secrets.token_urlsafe(16)
            password_hash = get_password_hash(initial_password)

            developer_user = User(
                id=uuid.uuid4(),
                company_id=None,
                role=UserRole.DEVELOPER,
                name="Developer Account",
                email=normalized_email,
                password_hash=password_hash,
                status=UserStatus.ACTIVE,
                email_verified=True,
                verification_required=False,
                last_verified_at=datetime.now(timezone.utc),
            )

            db.add(developer_user)
            await db.commit()
            await db.refresh(developer_user)

            print("\n" + "=" * 60)
            print("✓ Developer account created successfully!")
            print("=" * 60)
            print(f"  📧 Email: {developer_email}")
            print(f"  🔑 Password: {initial_password}")
            print(f"  🆔 User ID: {developer_user.id}")
            print("  🏢 Company ID: None (platform developer)")
            print(f"  👤 Role: {developer_user.role.value}")
            print("\n⚠️  IMPORTANT: Save the password above; it is not stored anywhere else.")
            print("=" * 60)

        except Exception:
            logger.exception("Error creating developer account")
            print("\n✗ Error creating developer account. Details were logged above.")
            await db.rollback()
            sys.exit(1)
        finally:
            await engine.dispose()


if __name__ == "__main__":
    if not os.getenv("DATABASE_URL"):
        print("✗ ERROR: DATABASE_URL environment variable is not set!")
        sys.exit(1)

    print("\n🚀 Starting developer account creation...\n")
    asyncio.run(create_developer_account_supabase())
