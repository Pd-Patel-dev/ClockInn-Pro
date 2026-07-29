"""
Script to create a platform developer account (company_id=NULL).
Email: pd.dev267@gmail.com

Usage:
    python create_developer_account.py

Environment:
    DEVELOPER_INITIAL_PASSWORD: Optional. If set, use this as the new account password;
        otherwise a random password is generated and printed once.
"""
import asyncio
import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
import uuid
from datetime import datetime, timezone

from app.models.user import User, UserRole, UserStatus
from app.core.security import get_password_hash, normalize_email
from app.core.config import settings


async def create_developer_account():
    """Create a platform developer account with company_id=NULL."""
    database_url = settings.DATABASE_URL
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    connect_args = {}
    if "supabase.co" in database_url or "supabase" in database_url.lower() or "pooler.supabase.com" in database_url:
        import ssl
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        connect_args = {"ssl": ssl_context}

    engine = create_async_engine(database_url, echo=False, connect_args=connect_args)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        try:
            developer_email = "pd.dev267@gmail.com"
            normalized_email = normalize_email(developer_email)

            result = await db.execute(select(User).where(User.email == normalized_email))
            existing_user = result.scalar_one_or_none()

            if existing_user:
                if existing_user.role == UserRole.DEVELOPER:
                    if existing_user.company_id is not None:
                        existing_user.company_id = None
                        db.add(existing_user)
                        await db.commit()
                        print(f"✓ Cleared company_id on existing developer: {developer_email}")
                    else:
                        print(f"✓ Developer account already exists: {developer_email}")
                    print(f"  User ID: {existing_user.id}")
                    print(f"  Role: {existing_user.role.value}")
                    print(f"  Company ID: {existing_user.company_id}")
                    return
                else:
                    existing_user.role = UserRole.DEVELOPER
                    existing_user.company_id = None
                    existing_user.email_verified = True
                    existing_user.verification_required = False
                    existing_user.last_verified_at = datetime.now(timezone.utc)
                    db.add(existing_user)
                    await db.commit()
                    print(f"✓ Updated existing user to DEVELOPER (no company): {developer_email}")
                    print(f"  User ID: {existing_user.id}")
                    return

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

            print("✓ Developer account created successfully!")
            print(f"  Email: {developer_email}")
            print(f"  Password: {initial_password}")
            print(f"  User ID: {developer_user.id}")
            print(f"  Company ID: None (platform developer)")
            print(f"  Role: {developer_user.role.value}")
            print("\n⚠️  IMPORTANT: Save the password above; change it after first login.")

        except Exception as e:
            print(f"✗ Error creating developer account: {e}")
            await db.rollback()
            raise
        finally:
            await engine.dispose()


if __name__ == "__main__":
    print("Creating platform developer account...")
    asyncio.run(create_developer_account())
