"""Batch schedule page context endpoint."""
import pytest
from uuid import uuid4
from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole, UserStatus
from app.models.company import Company


@pytest.fixture
async def svc_company(db: AsyncSession):
    company = Company(
        id=uuid4(),
        name="Schedule Ctx Co",
        slug=f"svc-{uuid4().hex[:12]}",
        settings_json={
            "timezone": "America/Chicago",
            "email_verification_required": False,
            "schedule_day_start_hour": 6,
            "schedule_day_end_hour": 22,
        },
    )
    db.add(company)
    await db.commit()
    await db.refresh(company)
    return company


@pytest.fixture
async def svc_admin(db: AsyncSession, svc_company: Company):
    from passlib.context import CryptContext

    pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
    tag = svc_company.id.hex[:12]
    admin = User(
        id=uuid4(),
        company_id=svc_company.id,
        role=UserRole.ADMIN,
        name="Admin",
        email=f"svc-adm-{tag}@test.com",
        password_hash=pwd_context.hash("password123"),
        status=UserStatus.ACTIVE,
    )
    db.add(admin)
    await db.commit()
    await db.refresh(admin)
    return admin


@pytest.fixture
async def svc_employee(db: AsyncSession, svc_company: Company):
    from passlib.context import CryptContext

    pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
    tag = svc_company.id.hex[:12]
    u = User(
        id=uuid4(),
        company_id=svc_company.id,
        role=UserRole.FRONTDESK,
        name="Desk",
        email=f"svc-emp-{tag}@test.com",
        password_hash=pwd_context.hash("password123"),
        status=UserStatus.ACTIVE,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


@pytest.fixture
async def svc_frontdesk(db: AsyncSession, svc_company: Company):
    """FRONTDESK has ``schedule`` but not ``user_management``."""
    from passlib.context import CryptContext

    pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
    tag = svc_company.id.hex[:12]
    u = User(
        id=uuid4(),
        company_id=svc_company.id,
        role=UserRole.FRONTDESK,
        name="Viewer",
        email=f"svc-fd-{tag}@test.com",
        password_hash=pwd_context.hash("password123"),
        status=UserStatus.ACTIVE,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


@pytest.mark.asyncio
async def test_schedules_view_context_ok(
    client: AsyncClient,
    svc_admin: User,
    svc_employee: User,
):
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": svc_admin.email, "password": "password123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    start = date.today() - timedelta(days=3)
    end = date.today() + timedelta(days=10)
    r = await client.get(
        "/api/v1/schedules/view-context",
        params={"start_date": start.isoformat(), "end_date": end.isoformat(), "limit": 1000},
        headers=headers,
    )
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data["employees"], list)
    assert len(data["employees"]) >= 1
    assert isinstance(data["shifts"], list)
    assert data["schedule_day_start_hour"] == 6
    assert data["schedule_day_end_hour"] == 22
    ids = {e["id"] for e in data["employees"]}
    assert str(svc_employee.id) in ids


@pytest.mark.asyncio
async def test_schedules_employees_schedule_permission(
    client: AsyncClient,
    svc_frontdesk: User,
    svc_employee: User,
):
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": svc_frontdesk.email, "password": "password123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    r = await client.get("/api/v1/schedules/employees", headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    ids = {e["id"] for e in data}
    assert str(svc_frontdesk.id) in ids
    assert str(svc_employee.id) in ids


@pytest.mark.asyncio
async def test_schedules_view_context_schedule_permission_not_user_management(
    client: AsyncClient,
    svc_frontdesk: User,
):
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": svc_frontdesk.email, "password": "password123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    start = date.today() - timedelta(days=3)
    end = date.today() + timedelta(days=10)
    r = await client.get(
        "/api/v1/schedules/view-context",
        params={"start_date": start.isoformat(), "end_date": end.isoformat(), "limit": 1000},
        headers=headers,
    )
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data["shifts"], list)
    for s in data["shifts"]:
        assert s["employee_id"] == str(svc_frontdesk.id)
