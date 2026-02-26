"""
Tests for bulk week shift creation feature.
"""
import pytest
from uuid import uuid4
from datetime import date, time, timedelta
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models.user import User, UserRole, UserStatus
from app.models.company import Company
from app.models.shift import Shift, ShiftStatus


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
async def test_company(db: AsyncSession):
    """Create a test company."""
    company = Company(
        id=uuid4(),
        name="Test Company",
        settings_json={"timezone": "America/Chicago"},
    )
    db.add(company)
    await db.commit()
    await db.refresh(company)
    return company


@pytest.fixture
async def admin_user(db: AsyncSession, test_company: Company):
    """Create an admin user."""
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
    
    admin = User(
        id=uuid4(),
        company_id=test_company.id,
        role=UserRole.ADMIN,
        name="Admin User",
        email="admin@test.com",
        password_hash=pwd_context.hash("password123"),
        status=UserStatus.ACTIVE,
    )
    db.add(admin)
    await db.commit()
    await db.refresh(admin)
    return admin


@pytest.fixture
async def employees(db: AsyncSession, test_company: Company):
    """Create test employees."""
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
    
    emps = []
    for i in range(2):
        emp = User(
            id=uuid4(),
            company_id=test_company.id,
            role=UserRole.FRONTDESK,
            name=f"Employee {i+1}",
            email=f"emp{i+1}@test.com",
            password_hash=pwd_context.hash("password123"),
            status=UserStatus.ACTIVE,
        )
        db.add(emp)
        emps.append(emp)
    
    await db.commit()
    for emp in emps:
        await db.refresh(emp)
    return emps


@pytest.mark.asyncio
async def test_bulk_week_shift_basic_creation(
    db: AsyncSession,
    client: TestClient,
    test_company: Company,
    admin_user: User,
    employees: list[User],
):
    """Test basic bulk week shift creation for 2 employees Mon-Fri."""
    # Login as admin
    login_response = client.post("/api/v1/auth/login", json={
        "email": admin_user.email,
        "password": "password123",
    })
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Calculate Monday of current week
    today = date.today()
    days_since_monday = today.weekday()
    monday = today - timedelta(days=days_since_monday)
    
    # Create shifts for Mon-Fri
    payload = {
        "week_start_date": monday.isoformat(),
        "timezone": "America/Chicago",
        "employee_ids": [str(emp.id) for emp in employees],
        "mode": "same_each_day",
        "template": {
            "start_time": "09:00",
            "end_time": "17:00",
            "break_minutes": 30,
            "status": "DRAFT",
        },
        "days": {
            "mon": {"enabled": True},
            "tue": {"enabled": True},
            "wed": {"enabled": True},
            "thu": {"enabled": True},
            "fri": {"enabled": True},
            "sat": {"enabled": False},
            "sun": {"enabled": False},
        },
        "conflict_policy": "skip",
    }
    
    # Preview first
    preview_response = client.post(
        "/api/v1/shifts/bulk/week/preview",
        json=payload,
        headers=headers,
    )
    assert preview_response.status_code == 200
    preview_data = preview_response.json()
    assert preview_data["total_shifts"] == 10  # 2 employees * 5 days
    assert preview_data["total_conflicts"] == 0
    
    # Create shifts
    create_response = client.post(
        "/api/v1/shifts/bulk/week",
        json=payload,
        headers=headers,
    )
    assert create_response.status_code == 201
    create_data = create_response.json()
    assert create_data["created_count"] == 10
    assert create_data["skipped_count"] == 0
    assert create_data["series_id"] is not None
    
    # Verify shifts were created
    result = await db.execute(
        "SELECT COUNT(*) FROM shifts WHERE company_id = :company_id",
        {"company_id": test_company.id}
    )
    count = result.scalar()
    assert count == 10


@pytest.mark.asyncio
async def test_bulk_week_shift_overnight(
    db: AsyncSession,
    client: TestClient,
    test_company: Company,
    admin_user: User,
    employees: list[User],
):
    """Test overnight shift creation (PM to AM next day)."""
    # Login as admin
    login_response = client.post("/api/v1/auth/login", json={
        "email": admin_user.email,
        "password": "password123",
    })
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Calculate Monday
    today = date.today()
    days_since_monday = today.weekday()
    monday = today - timedelta(days=days_since_monday)
    
    # Create overnight shift (10 PM to 6 AM)
    payload = {
        "week_start_date": monday.isoformat(),
        "timezone": "America/Chicago",
        "employee_ids": [str(employees[0].id)],
        "mode": "same_each_day",
        "template": {
            "start_time": "22:00",
            "end_time": "06:00",  # Overnight shift
            "break_minutes": 0,
            "status": "DRAFT",
        },
        "days": {
            "mon": {"enabled": True},
            "tue": {"enabled": False},
            "wed": {"enabled": False},
            "thu": {"enabled": False},
            "fri": {"enabled": False},
            "sat": {"enabled": False},
            "sun": {"enabled": False},
        },
        "conflict_policy": "skip",
    }
    
    response = client.post(
        "/api/v1/shifts/bulk/week",
        json=payload,
        headers=headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["created_count"] == 1
    
    # Verify shift was created with overnight times
    from sqlalchemy import select
    result = await db.execute(
        select(Shift).where(Shift.company_id == test_company.id)
    )
    shift = result.scalar_one()
    assert shift.start_time == time(22, 0)
    assert shift.end_time == time(6, 0)  # End time is earlier (overnight)


@pytest.mark.asyncio
async def test_bulk_week_shift_conflict_detection_skip(
    db: AsyncSession,
    client: TestClient,
    test_company: Company,
    admin_user: User,
    employees: list[User],
):
    """Test conflict detection with skip policy."""
    # Login as admin
    login_response = client.post("/api/v1/auth/login", json={
        "email": admin_user.email,
        "password": "password123",
    })
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Calculate Monday
    today = date.today()
    days_since_monday = today.weekday()
    monday = today - timedelta(days=days_since_monday)
    
    # Create an existing shift
    existing_shift = Shift(
        id=uuid4(),
        company_id=test_company.id,
        employee_id=employees[0].id,
        shift_date=monday,
        start_time=time(9, 0),
        end_time=time(17, 0),
        break_minutes=30,
        status=ShiftStatus.DRAFT,
    )
    db.add(existing_shift)
    await db.commit()
    
    # Try to create overlapping shift with skip policy
    payload = {
        "week_start_date": monday.isoformat(),
        "timezone": "America/Chicago",
        "employee_ids": [str(employees[0].id)],
        "mode": "same_each_day",
        "template": {
            "start_time": "09:00",
            "end_time": "17:00",
            "break_minutes": 30,
            "status": "DRAFT",
        },
        "days": {
            "mon": {"enabled": True},
            "tue": {"enabled": False},
            "wed": {"enabled": False},
            "thu": {"enabled": False},
            "fri": {"enabled": False},
            "sat": {"enabled": False},
            "sun": {"enabled": False},
        },
        "conflict_policy": "skip",
    }
    
    response = client.post(
        "/api/v1/shifts/bulk/week",
        json=payload,
        headers=headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["created_count"] == 0  # Skipped due to conflict
    assert data["skipped_count"] == 1
    
    # Verify only original shift exists
    from sqlalchemy import select, func
    result = await db.execute(
        select(func.count()).select_from(Shift).where(Shift.company_id == test_company.id)
    )
    count = result.scalar()
    assert count == 1  # Only the original shift


@pytest.mark.asyncio
async def test_bulk_week_shift_conflict_detection_error(
    db: AsyncSession,
    client: TestClient,
    test_company: Company,
    admin_user: User,
    employees: list[User],
):
    """Test conflict detection with error policy returns 409."""
    # Login as admin
    login_response = client.post("/api/v1/auth/login", json={
        "email": admin_user.email,
        "password": "password123",
    })
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Calculate Monday
    today = date.today()
    days_since_monday = today.weekday()
    monday = today - timedelta(days=days_since_monday)
    
    # Create an existing shift
    existing_shift = Shift(
        id=uuid4(),
        company_id=test_company.id,
        employee_id=employees[0].id,
        shift_date=monday,
        start_time=time(9, 0),
        end_time=time(17, 0),
        break_minutes=30,
        status=ShiftStatus.DRAFT,
    )
    db.add(existing_shift)
    await db.commit()
    
    # Try to create overlapping shift with error policy
    payload = {
        "week_start_date": monday.isoformat(),
        "timezone": "America/Chicago",
        "employee_ids": [str(employees[0].id)],
        "mode": "same_each_day",
        "template": {
            "start_time": "09:00",
            "end_time": "17:00",
            "break_minutes": 30,
            "status": "DRAFT",
        },
        "days": {
            "mon": {"enabled": True},
            "tue": {"enabled": False},
            "wed": {"enabled": False},
            "thu": {"enabled": False},
            "fri": {"enabled": False},
            "sat": {"enabled": False},
            "sun": {"enabled": False},
        },
        "conflict_policy": "error",
    }
    
    response = client.post(
        "/api/v1/shifts/bulk/week",
        json=payload,
        headers=headers,
    )
    assert response.status_code == 409
    data = response.json()
    assert "conflicts" in data["detail"]
    assert len(data["detail"]["conflicts"]) > 0

