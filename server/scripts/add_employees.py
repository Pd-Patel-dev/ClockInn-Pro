"""
Script to add 5 random employees to the database.
Run with: python -m scripts.add_employees
"""
import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select
from app.core.config import settings
from app.core.security import get_password_hash, get_pin_hash
from app.models.company import Company
from app.models.user import User, UserRole, UserStatus, PayRateType
import uuid
from decimal import Decimal
import random

# Sample data for random employees
EMPLOYEE_NAMES = [
    "Alice Williams",
    "Michael Chen",
    "Sarah Johnson",
    "David Martinez",
    "Emily Brown",
    "James Wilson",
    "Olivia Davis",
    "Robert Taylor",
    "Sophia Anderson",
    "William Thomas",
]

JOB_ROLES = [
    "Software Developer",
    "Project Manager",
    "Sales Representative",
    "Customer Support",
    "Marketing Specialist",
    "HR Coordinator",
    "Accountant",
    "Designer",
    "Operations Manager",
    "Quality Assurance",
]

PAY_RATES = [18.00, 20.00, 22.50, 25.00, 27.50, 30.00, 32.50, 35.00, 40.00, 45.00]


async def add_employees():
    """Add 5 random employees to the first company in the database."""
    # Create async engine
    database_url = settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
    engine = create_async_engine(database_url, echo=False)
    AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with AsyncSessionLocal() as db:
        # Get the first company (or Demo Company if it exists)
        result = await db.execute(select(Company).order_by(Company.created_at))
        company = result.scalar_one_or_none()
        
        if not company:
            print("No company found. Please run seed_data.py first to create a company.")
            return
        
        print(f"Adding employees to company: {company.name}")
        
        # Get existing employee emails to avoid duplicates
        result = await db.execute(
            select(User.email).where(User.company_id == company.id)
        )
        existing_emails = {email for email in result.scalars().all()}
        
        # Select 5 random names that don't have existing emails
        available_names = [name for name in EMPLOYEE_NAMES if f"{name.split()[0].lower()}@{company.name.lower().replace(' ', '')}.com" not in existing_emails]
        
        if len(available_names) < 5:
            print(f"Warning: Only {len(available_names)} unique names available. Adding {len(available_names)} employees.")
        
        selected_names = random.sample(available_names, min(5, len(available_names)))
        
        employees_added = []
        
        for name in selected_names:
            # Generate email from name
            first_name = name.split()[0].lower()
            company_domain = company.name.lower().replace(' ', '').replace('company', '')
            email = f"{first_name}@{company_domain}.com"
            
            # Skip if email already exists
            if email in existing_emails:
                print(f"Skipping {name} - email {email} already exists")
                continue
            
            # Random job role and pay rate
            job_role = random.choice(JOB_ROLES)
            pay_rate = random.choice(PAY_RATES)
            pay_rate_cents = int(Decimal(str(pay_rate)) * 100)
            
            # Generate random 4-digit PIN
            pin = f"{random.randint(1000, 9999)}"
            
            # Create employee
            employee = User(
                id=uuid.uuid4(),
                company_id=company.id,
                role=UserRole.EMPLOYEE,
                name=name,
                email=email,
                password_hash=get_password_hash("Employee123!"),
                pin_hash=get_pin_hash(pin),
                status=UserStatus.ACTIVE,
                job_role=job_role,
                pay_rate=pay_rate,  # Legacy field
                pay_rate_cents=pay_rate_cents,
                pay_rate_type=PayRateType.HOURLY,
                overtime_multiplier=None,  # Use company default
            )
            db.add(employee)
            employees_added.append({
                "name": name,
                "email": email,
                "pin": pin,
                "job_role": job_role,
                "pay_rate": pay_rate,
            })
            existing_emails.add(email)
        
        await db.commit()
        
        print(f"\n✓ Successfully added {len(employees_added)} employees!")
        print("\nEmployee details:")
        for emp in employees_added:
            print(f"  Name: {emp['name']}")
            print(f"  Email: {emp['email']}")
            print(f"  Password: Employee123!")
            print(f"  PIN: {emp['pin']}")
            print(f"  Job Role: {emp['job_role']}")
            print(f"  Pay Rate: ${emp['pay_rate']:.2f}/hour")
            print()
    
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(add_employees())

