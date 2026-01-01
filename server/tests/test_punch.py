import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole, UserStatus
from app.models.company import Company
from app.core.security import get_password_hash, get_pin_hash
import uuid


@pytest.mark.asyncio
async def test_punch_in(client: AsyncClient, test_employee: User):
    """Test clock in."""
    response = await client.post(
        "/api/v1/time/punch",
        json={
            "employee_email": "employee@test.com",
            "pin": "1234",
            "source": "kiosk",
        },
        headers={"Authorization": f"Bearer {await get_test_token(client)}"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["clock_in_at"] is not None
    assert data["clock_out_at"] is None
    assert data["status"] == "open"


@pytest.mark.asyncio
async def test_punch_out(client: AsyncClient, test_employee: User):
    """Test clock out."""
    # First clock in
    await client.post(
        "/api/v1/time/punch",
        json={
            "employee_email": "employee@test.com",
            "pin": "1234",
            "source": "kiosk",
        },
        headers={"Authorization": f"Bearer {await get_test_token(client)}"},
    )
    
    # Then clock out
    response = await client.post(
        "/api/v1/time/punch",
        json={
            "employee_email": "employee@test.com",
            "pin": "1234",
            "source": "kiosk",
        },
        headers={"Authorization": f"Bearer {await get_test_token(client)}"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["clock_out_at"] is not None
    assert data["status"] == "closed"


@pytest.mark.asyncio
async def test_punch_invalid_pin(client: AsyncClient, test_employee: User):
    """Test punch with invalid PIN."""
    response = await client.post(
        "/api/v1/time/punch",
        json={
            "employee_email": "employee@test.com",
            "pin": "9999",
            "source": "kiosk",
        },
        headers={"Authorization": f"Bearer {await get_test_token(client)}"},
    )
    assert response.status_code == 401


@pytest.fixture
async def test_employee(db: AsyncSession) -> User:
    """Create a test employee with PIN."""
    company = Company(
        id=uuid.uuid4(),
        name="Test Company",
        settings_json={},
    )
    db.add(company)
    await db.flush()
    
    employee = User(
        id=uuid.uuid4(),
        company_id=company.id,
        role=UserRole.EMPLOYEE,
        name="Test Employee",
        email="employee@test.com",
        password_hash=get_password_hash("Employee123!"),
        pin_hash=get_pin_hash("1234"),
        status=UserStatus.ACTIVE,
    )
    db.add(employee)
    await db.commit()
    await db.refresh(employee)
    return employee


async def get_test_token(client: AsyncClient) -> str:
    """Get a test access token."""
    # Create admin user first
    from app.models.user import User, UserRole, UserStatus
    from app.models.company import Company
    from app.core.security import get_password_hash
    from app.core.database import AsyncSessionLocal
    
    async with AsyncSessionLocal() as db:
        company = Company(
            id=uuid.uuid4(),
            name="Test Company",
            settings_json={},
        )
        db.add(company)
        await db.flush()
        
        admin = User(
            id=uuid.uuid4(),
            company_id=company.id,
            role=UserRole.ADMIN,
            name="Test Admin",
            email="admin@test.com",
            password_hash=get_password_hash("Admin123!"),
            status=UserStatus.ACTIVE,
        )
        db.add(admin)
        await db.commit()
    
    # Login
    response = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "admin@test.com",
            "password": "Admin123!",
        },
    )
    return response.json()["access_token"]

