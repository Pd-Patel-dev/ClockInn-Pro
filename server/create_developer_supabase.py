#!/usr/bin/env python3
"""
Script to create developer account in Supabase production database.
This script is optimized for Supabase connections with SSL support.

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
import secrets
import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
import uuid
from datetime import datetime, timezone
import ssl

from app.core.database import Base
from app.models.user import User, UserRole, UserStatus
from app.models.company import Company
from app.core.security import get_password_hash, normalize_email
from app.core.config import settings


async def create_developer_account_supabase():
    """Create a developer account in Supabase."""
    print("=" * 60)
    print("Creating Developer Account in Supabase")
    print("=" * 60)
    
    # Convert postgresql:// to postgresql+asyncpg:// for async operations
    database_url = settings.DATABASE_URL
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    
    # Configure SSL for Supabase connections
    connect_args = {}
    is_supabase = (
        "supabase.co" in database_url or 
        "supabase" in database_url.lower() or 
        "pooler.supabase.com" in database_url
    )
    
    if is_supabase:
        print("✓ Detected Supabase connection - configuring SSL...")
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        connect_args = {
            "ssl": ssl_context
        }
    else:
        print("ℹ Using standard PostgreSQL connection...")
    
    # Create database engine
    print(f"✓ Connecting to database...")
    engine = create_async_engine(
        database_url,
        echo=False,
        connect_args=connect_args,
    )
    
    async_session = sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    
    async with async_session() as db:
        try:
            developer_email = "pd.dev267@gmail.com"
            normalized_email = normalize_email(developer_email)
            
            print(f"\n📧 Checking for existing user: {developer_email}")
            
            # Check if developer already exists
            result = await db.execute(
                select(User).where(User.email == normalized_email)
            )
            existing_user = result.scalar_one_or_none()
            
            if existing_user:
                if existing_user.role == UserRole.DEVELOPER:
                    print(f"\n✓ Developer account already exists!")
                    print(f"  📧 Email: {developer_email}")
                    print(f"  🆔 User ID: {existing_user.id}")
                    print(f"  👤 Role: {existing_user.role.value}")
                    print(f"  ✅ Email Verified: {existing_user.email_verified}")
                    print(f"\n💡 Login with this email; use your existing password (or reset via the app).")
                    return
                else:
                    # Update existing user to developer
                    print(f"\n⚠️  User exists with role: {existing_user.role.value}")
                    print(f"   Updating to DEVELOPER role...")
                    existing_user.role = UserRole.DEVELOPER
                    existing_user.email_verified = True
                    existing_user.verification_required = False
                    existing_user.last_verified_at = datetime.now(timezone.utc)
                    db.add(existing_user)
                    await db.commit()
                    await db.refresh(existing_user)
                    print(f"\n✓ Updated existing user to DEVELOPER role!")
                    print(f"  📧 Email: {developer_email}")
                    print(f"  🆔 User ID: {existing_user.id}")
                    print(f"  👤 Role: {existing_user.role.value}")
                    return
            
            print(f"✓ No existing user found. Creating new developer account...")
            
            # Check if any company exists (we need at least one company)
            result = await db.execute(select(Company).limit(1))
            company = result.scalar_one_or_none()
            
            if not company:
                print("\n✗ ERROR: No company found in database!")
                print("  Please create a company first through the registration endpoint.")
                print("  The developer account must be associated with a company.")
                return
            
            print(f"✓ Found company: {company.name} (ID: {company.id})")
            
            # Use DEVELOPER_INITIAL_PASSWORD if set; otherwise generate a one-time random password
            initial_password = os.getenv("DEVELOPER_INITIAL_PASSWORD") or secrets.token_urlsafe(16)
            password_hash = get_password_hash(initial_password)
            
            # Create developer user
            developer_user = User(
                id=uuid.uuid4(),
                company_id=company.id,
                role=UserRole.DEVELOPER,
                name="Developer Account",
                email=normalized_email,
                password_hash=password_hash,
                status=UserStatus.ACTIVE,
                email_verified=True,  # Auto-verify developer account
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
            print(f"  🏢 Company ID: {company.id}")
            print(f"  👤 Role: {developer_user.role.value}")
            print(f"  ✅ Email Verified: {developer_user.email_verified}")
            print("\n⚠️  IMPORTANT: Save the password above; it is not stored anywhere else.")
            print("   Change the password after first login.")
            print("\n💡 Next steps:")
            print("   1. Login at: https://your-frontend-url.com/login")
            print("   2. You will be redirected to: /developer")
            print("   3. Change your password in settings")
            print("   4. Configure Gmail API in Developer Portal")
            print("=" * 60)
            
        except Exception as e:
            print(f"\n✗ Error creating developer account: {e}")
            print(f"   Error type: {type(e).__name__}")
            await db.rollback()
            raise
        finally:
            await engine.dispose()


if __name__ == "__main__":
    # Check if DATABASE_URL is set
    if not os.getenv("DATABASE_URL"):
        print("✗ ERROR: DATABASE_URL environment variable is not set!")
        print("\nPlease set it before running this script:")
        print('  export DATABASE_URL="postgresql://user:password@host:port/database"')
        print("\nFor Supabase:")
        print('  export DATABASE_URL="postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres"')
        sys.exit(1)
    
    print("\n🚀 Starting developer account creation...\n")
    asyncio.run(create_developer_account_supabase())

