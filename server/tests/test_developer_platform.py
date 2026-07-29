"""
Tests for platform DEVELOPER accounts (company_id=NULL) and globally unique emails.
"""
import pytest
import uuid
from datetime import datetime, timezone
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.user import User, UserRole, UserStatus
from app.models.company import Company
from app.core.security import get_password_hash, create_access_token, jwt_company_id_claim
from app.core.permissions import ROLE_PERMISSIONS
from app.schemas.user import UserCreate, DeveloperCreate
from pydantic import ValidationError


@pytest.fixture
async def company(db: AsyncSession) -> Company:
    c = Company(
        id=uuid.uuid4(),
        name="Test Co",
        slug=f"test-{uuid.uuid4().hex[:8]}",
        settings_json={"email_verification_required": False},
        kiosk_enabled=True,
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return c


@pytest.fixture
async def admin_user(db: AsyncSession, company: Company) -> User:
    now = datetime.now(timezone.utc)
    u = User(
        id=uuid.uuid4(),
        company_id=company.id,
        role=UserRole.ADMIN,
        name="Admin",
        email=f"admin-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=get_password_hash("Admin123!"),
        status=UserStatus.ACTIVE,
        email_verified=True,
        verification_required=False,
        last_verified_at=now,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


@pytest.fixture
async def developer_user(db: AsyncSession) -> User:
    now = datetime.now(timezone.utc)
    u = User(
        id=uuid.uuid4(),
        company_id=None,
        role=UserRole.DEVELOPER,
        name="Dev",
        email=f"dev-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=get_password_hash("Dev@2024ChangeMe!"),
        status=UserStatus.ACTIVE,
        email_verified=True,
        verification_required=False,
        last_verified_at=now,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


def _admin_headers(user: User) -> dict:
    token = create_access_token({
        "sub": str(user.id),
        "company_id": jwt_company_id_claim(user.company_id),
        "role": user.role.value,
        "permissions": sorted(list(ROLE_PERMISSIONS.get(user.role, set()))),
    })
    return {"Authorization": f"Bearer {token}"}


def _dev_headers(user: User) -> dict:
    token = create_access_token({
        "sub": str(user.id),
        "company_id": jwt_company_id_claim(user.company_id),
        "role": user.role.value,
        "permissions": sorted(list(ROLE_PERMISSIONS.get(user.role, set()))),
    })
    return {"Authorization": f"Bearer {token}"}


def test_user_create_rejects_developer_role():
    with pytest.raises(ValidationError):
        UserCreate(
            name="X",
            email="x@example.com",
            role=UserRole.DEVELOPER,
            password="Password1!",
        )


def test_developer_create_schema_has_no_company():
    d = DeveloperCreate(name="D", email="D@Example.COM", password="Password1!")
    assert d.email == "d@example.com"
    assert not hasattr(d, "company_id") or getattr(d, "company_id", None) is None


def test_model_rejects_developer_with_company():
    with pytest.raises(ValueError, match="company_id"):
        User(
            id=uuid.uuid4(),
            company_id=uuid.uuid4(),
            role=UserRole.DEVELOPER,
            name="Bad",
            email="bad-dev@example.com",
            password_hash="x",
            status=UserStatus.ACTIVE,
        )


def test_model_rejects_tenant_without_company():
    with pytest.raises(ValueError, match="company_id"):
        User(
            id=uuid.uuid4(),
            company_id=None,
            role=UserRole.ADMIN,
            name="Bad",
            email="bad-admin@example.com",
            password_hash="x",
            status=UserStatus.ACTIVE,
        )


@pytest.mark.asyncio
async def test_jwt_company_id_null_for_developer(developer_user: User):
    claim = jwt_company_id_claim(developer_user.company_id)
    assert claim is None
    token = create_access_token({
        "sub": str(developer_user.id),
        "company_id": claim,
        "role": "DEVELOPER",
        "permissions": [],
    })
    from app.core.security import decode_token
    payload = decode_token(token)
    assert payload is not None
    assert "company_id" in payload
    assert payload["company_id"] is None


@pytest.mark.asyncio
async def test_create_developer_account_null_company(
    client: AsyncClient, developer_user: User, db: AsyncSession
):
    email = f"newdev-{uuid.uuid4().hex[:8]}@example.com"
    res = await client.post(
        "/api/v1/developer/accounts",
        json={"name": "New Dev", "email": email, "password": "Password1!"},
        headers=_dev_headers(developer_user),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["company_id"] is None
    result = await db.execute(select(User).where(User.email == email.lower()))
    created = result.scalar_one()
    assert created.company_id is None
    assert created.role == UserRole.DEVELOPER


@pytest.mark.asyncio
async def test_admin_endpoints_reject_developer_jwt(
    client: AsyncClient, developer_user: User
):
    res = await client.get(
        "/api/v1/users/admin/employees",
        headers=_dev_headers(developer_user),
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_developer_endpoints_accept_null_company_jwt(
    client: AsyncClient, developer_user: User
):
    res = await client.get(
        "/api/v1/developer/companies",
        headers=_dev_headers(developer_user),
    )
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_global_email_conflict_employee_vs_developer(
    client: AsyncClient, admin_user: User, developer_user: User, db: AsyncSession
):
    # Try to create employee with developer's email
    res = await client.post(
        "/api/v1/users/admin/employees",
        json={
            "name": "Clash",
            "email": developer_user.email,
            "password": "Password1!",
            "role": "FRONTDESK",
        },
        headers=_admin_headers(admin_user),
    )
    assert res.status_code == 409
    assert "platform" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_global_email_conflict_case_insensitive(
    client: AsyncClient, admin_user: User, company: Company, db: AsyncSession
):
    email = f"unique-{uuid.uuid4().hex[:8]}@example.com"
    first = await client.post(
        "/api/v1/users/admin/employees",
        json={
            "name": "One",
            "email": email,
            "password": "Password1!",
            "role": "FRONTDESK",
        },
        headers=_admin_headers(admin_user),
    )
    assert first.status_code == 201, first.text

    second = await client.post(
        "/api/v1/users/admin/employees",
        json={
            "name": "Two",
            "email": email.upper(),
            "password": "Password1!",
            "role": "HOUSEKEEPING",
        },
        headers=_admin_headers(admin_user),
    )
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_developer_create_conflict_with_tenant_email(
    client: AsyncClient, developer_user: User, admin_user: User
):
    res = await client.post(
        "/api/v1/developer/accounts",
        json={
            "name": "Clash Dev",
            "email": admin_user.email,
            "password": "Password1!",
        },
        headers=_dev_headers(developer_user),
    )
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_delete_company_does_not_affect_developers(
    client: AsyncClient, developer_user: User, company: Company, db: AsyncSession
):
    # Create a disposable company with one employee
    disposable = Company(
        id=uuid.uuid4(),
        name="Disposable",
        slug=f"disp-{uuid.uuid4().hex[:8]}",
        settings_json={},
        kiosk_enabled=True,
    )
    db.add(disposable)
    await db.flush()
    emp = User(
        id=uuid.uuid4(),
        company_id=disposable.id,
        role=UserRole.FRONTDESK,
        name="Temp",
        email=f"temp-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=get_password_hash("Password1!"),
        status=UserStatus.ACTIVE,
        email_verified=True,
        verification_required=False,
        last_verified_at=datetime.now(timezone.utc),
    )
    db.add(emp)
    await db.commit()

    res = await client.delete(
        f"/api/v1/developer/companies/{disposable.id}",
        headers=_dev_headers(developer_user),
    )
    assert res.status_code == 204, res.text

    await db.refresh(developer_user)
    assert developer_user.company_id is None
    still = await db.execute(select(User).where(User.id == developer_user.id))
    assert still.scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_company_users_list_excludes_developers(
    client: AsyncClient, developer_user: User, company: Company, admin_user: User
):
    res = await client.get(
        f"/api/v1/developer/companies/{company.id}/users",
        headers=_dev_headers(developer_user),
    )
    assert res.status_code == 200
    roles = [u["role"] for u in res.json()]
    assert "DEVELOPER" not in roles
