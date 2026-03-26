import secrets
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole, UserStatus
from app.models.company import Company
from app.core.security import get_password_hash, get_pin_hash

# Kiosk punch uses PIN only; password is never used in these tests (random per fixture).
_TEST_PIN_OK = "1234"
_TEST_PIN_BAD = "9999"


@pytest.mark.asyncio
async def test_punch_in(client: AsyncClient, test_employee: User):
    """Test clock in (kiosk punch is a public endpoint)."""
    response = await client.post(
        "/api/v1/time/punch",
        json={
            "employee_email": test_employee.email,
            "pin": _TEST_PIN_OK,
            "source": "kiosk",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["clock_in_at"] is not None
    assert data["clock_out_at"] is None
    assert data["status"] == "open"


@pytest.mark.asyncio
async def test_punch_out(client: AsyncClient, test_employee: User):
    """Test clock out."""
    await client.post(
        "/api/v1/time/punch",
        json={
            "employee_email": test_employee.email,
            "pin": _TEST_PIN_OK,
            "source": "kiosk",
        },
    )

    response = await client.post(
        "/api/v1/time/punch",
        json={
            "employee_email": test_employee.email,
            "pin": _TEST_PIN_OK,
            "source": "kiosk",
        },
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
            "employee_email": test_employee.email,
            "pin": _TEST_PIN_BAD,
            "source": "kiosk",
        },
    )
    assert response.status_code == 401


@pytest.fixture
async def test_employee(db: AsyncSession) -> User:
    """Create a test employee with PIN."""
    company = Company(
        id=uuid.uuid4(),
        name="Test Company",
        slug=f"punch-{uuid.uuid4().hex[:12]}",
        settings_json={"email_verification_required": False},
    )
    db.add(company)
    await db.flush()

    employee = User(
        id=uuid.uuid4(),
        company_id=company.id,
        role=UserRole.FRONTDESK,
        name="Test Employee",
        email=f"punch-{uuid.uuid4().hex[:12]}@test.com",
        password_hash=get_password_hash(secrets.token_urlsafe(32)),
        pin_hash=get_pin_hash(_TEST_PIN_OK),
        status=UserStatus.ACTIVE,
    )
    db.add(employee)
    await db.commit()
    await db.refresh(employee)
    return employee
