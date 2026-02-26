"""
Seed script to create sample company, admin, and employees.
Run with: python -m scripts.seed_data
"""
import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from app.core.config import settings
from app.core.security import get_password_hash, get_pin_hash
from app.models.company import Company
from app.models.user import User, UserRole, UserStatus, PayRateType
import uuid
from decimal import Decimal


async def seed_data():
    """Seed the database with sample data."""
    # Create async engine
    database_url = settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
    engine = create_async_engine(database_url, echo=False)
    AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with AsyncSessionLocal() as db:
        # Check if company already exists
        from sqlalchemy import select
        result = await db.execute(select(Company).where(Company.name == "Demo Company"))
        existing_company = result.scalar_one_or_none()
        
        if existing_company:
            print("Demo company already exists. Skipping seed.")
            return
        
        # Create company
        company = Company(
            id=uuid.uuid4(),
            name="Demo Company",
            settings_json={
                "timezone": "America/New_York",
                "payroll_week_start_day": 0,  # Monday (0=Mon, 6=Sun)
                "overtime_enabled": True,
                "overtime_threshold_hours_per_week": 40,
                "overtime_multiplier_default": 1.5,
                "rounding_policy": "none",  # none, 5, 10, 15
            },
        )
        db.add(company)
        await db.flush()
        
        # Create admin user
        admin = User(
            id=uuid.uuid4(),
            company_id=company.id,
            role=UserRole.ADMIN,
            name="Admin User",
            email="admin@demo.com",
            password_hash=get_password_hash("Admin123!"),
            status=UserStatus.ACTIVE,
        )
        db.add(admin)
        await db.flush()
        
        # Create employees
        employees_data = [
            {
                "name": "John Doe",
                "email": "john@demo.com",
                "password": "Employee123!",
                "pin": "1234",
                "job_role": "Manager",
                "pay_rate": 25.50,
            },
            {
                "name": "Jane Smith",
                "email": "jane@demo.com",
                "password": "Employee123!",
                "pin": "5678",
                "job_role": "Developer",
                "pay_rate": 30.00,
            },
            {
                "name": "Bob Johnson",
                "email": "bob@demo.com",
                "password": "Employee123!",
                "pin": "9012",
                "job_role": "Sales Associate",
                "pay_rate": 18.75,
            },
        ]
        
        for emp_data in employees_data:
            pay_rate = emp_data.get("pay_rate", 0)
            pay_rate_cents = int(Decimal(str(pay_rate)) * 100) if pay_rate else 0
            
            employee = User(
                id=uuid.uuid4(),
                company_id=company.id,
                role=UserRole.FRONTDESK,
                name=emp_data["name"],
                email=emp_data["email"],
                password_hash=get_password_hash(emp_data["password"]),
                pin_hash=get_pin_hash(emp_data["pin"]),
                status=UserStatus.ACTIVE,
                job_role=emp_data.get("job_role"),
                pay_rate=pay_rate,  # Legacy field
                pay_rate_cents=pay_rate_cents,
                pay_rate_type=PayRateType.HOURLY,
                overtime_multiplier=None,  # Use company default
            )
            db.add(employee)
        
        await db.commit()
        print("Seed data created successfully!")
        print("\nLogin credentials:")
        print("Admin: admin@demo.com / Admin123!")
        print("\nEmployees:")
        for emp_data in employees_data:
            print(f"  {emp_data['email']} / {emp_data['password']} (PIN: {emp_data['pin']})")
    
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed_data())

