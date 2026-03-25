import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User, UserRole, UserStatus
from app.models.company import Company
from app.core.security import get_password_hash
import uuid


@pytest.mark.asyncio
async def test_register_company(client: AsyncClient):
    """Test company registration."""
    response = await client.post(
        "/api/v1/auth/register-company",
        json={
            "company_name": "Test Company",
            "admin_name": "Test Admin",
            "admin_email": "admin@test.com",
            "admin_password": "Test123!",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data


@pytest.mark.asyncio
async def test_login(client: AsyncClient, test_user: User):
    """Test user login."""
    response = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "test@example.com",
            "password": "Test123!",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data


@pytest.mark.asyncio
async def test_refresh_token(client: AsyncClient, test_user: User):
    """Refresh with HttpOnly cookie returns access_token; cookie rotates for a second refresh."""
    login_response = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "test@example.com",
            "password": "Test123!",
        },
    )
    assert login_response.status_code == 200
    cookie_name = settings.REFRESH_TOKEN_COOKIE_NAME
    assert login_response.cookies.get(cookie_name), "login should set refresh HttpOnly cookie"

    refresh_response = await client.post("/api/v1/auth/refresh", json={})
    assert refresh_response.status_code == 200
    assert refresh_response.json().get("access_token")

    refresh_response2 = await client.post("/api/v1/auth/refresh", json={})
    assert refresh_response2.status_code == 200
    assert refresh_response2.json().get("access_token")


@pytest.mark.asyncio
async def test_login_invalid_credentials(client: AsyncClient):
    """Test login with invalid credentials."""
    response = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "wrong@example.com",
            "password": "Wrong123!",
        },
    )
    assert response.status_code == 401


@pytest.fixture
async def test_user(db: AsyncSession) -> User:
    """Create a test user."""
    company = Company(
        id=uuid.uuid4(),
        name="Test Company",
        slug=f"auth-{uuid.uuid4().hex[:12]}",
        settings_json={"email_verification_required": False},
    )
    db.add(company)
    await db.flush()
    
    user = User(
        id=uuid.uuid4(),
        company_id=company.id,
        role=UserRole.ADMIN,
        name="Test User",
        email="test@example.com",
        password_hash=get_password_hash("Test123!"),
        status=UserStatus.ACTIVE,
        email_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user

