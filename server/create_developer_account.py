"""
Script to create a developer account.
Run this script to create a developer account with email pd.dev267@gmail.com

Usage:
    python create_developer_account.py
"""
import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
import uuid
from datetime import datetime, timedelta, timezone

from app.core.database import Base
from app.models.user import User, UserRole, UserStatus
from app.models.company import Company
from app.core.security import get_password_hash, normalize_email
from app.core.config import settings
from app.services.verification_service import send_verification_pin


async def create_developer_account():
    """Create a developer account."""
    # Convert postgresql:// to postgresql+asyncpg:// for async operations
    database_url = settings.DATABASE_URL
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    
    # Configure SSL for Supabase connections
    connect_args = {}
    if "supabase.co" in database_url or "supabase" in database_url.lower() or "pooler.supabase.com" in database_url:
        import ssl
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        connect_args = {
            "ssl": ssl_context
        }
    
    # Create database engine
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
            
            # Check if developer already exists
            result = await db.execute(
                select(User).where(User.email == normalized_email)
            )
            existing_user = result.scalar_one_or_none()
            
            if existing_user:
                if existing_user.role == UserRole.DEVELOPER:
                    print(f"✓ Developer account already exists: {developer_email}")
                    print(f"  User ID: {existing_user.id}")
                    print(f"  Role: {existing_user.role.value}")
                    return
                else:
                    # Update existing user to developer
                    existing_user.role = UserRole.DEVELOPER
                    db.add(existing_user)
                    await db.commit()
                    print(f"✓ Updated existing user to DEVELOPER: {developer_email}")
                    print(f"  User ID: {existing_user.id}")
                    return
            
            # Check if any company exists (we need at least one company)
            result = await db.execute(select(Company).limit(1))
            company = result.scalar_one_or_none()
            
            if not company:
                print("✗ No company found in database. Please create a company first.")
                print("  You can register a company through the registration endpoint.")
                return
            
            # Generate a secure password (user will need to reset it)
            # For development, use a default password that should be changed
            default_password = "Dev@2024ChangeMe!"
            password_hash = get_password_hash(default_password)
            
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
            
            print(f"✓ Developer account created successfully!")
            print(f"  Email: {developer_email}")
            print(f"  Password: {default_password}")
            print(f"  User ID: {developer_user.id}")
            print(f"  Company ID: {company.id}")
            print(f"  Role: {developer_user.role.value}")
            print(f"\n⚠️  IMPORTANT: Please change the password after first login!")
            print(f"   The default password is: {default_password}")
            
        except Exception as e:
            print(f"✗ Error creating developer account: {e}")
            await db.rollback()
            raise
        finally:
            await engine.dispose()


if __name__ == "__main__":
    print("Creating developer account...")
    asyncio.run(create_developer_account())

