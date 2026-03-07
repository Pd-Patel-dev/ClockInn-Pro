"""Tests for Shift Notepad / Common Log."""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timezone
import uuid

from app.models.user import User, UserRole, UserStatus
from app.models.company import Company
from app.models.time_entry import TimeEntry, TimeEntryStatus, TimeEntrySource
from app.models.shift_note import ShiftNote, ShiftNoteStatus
from app.models.audit_log import AuditLog
from app.core.security import get_password_hash, get_pin_hash


@pytest.fixture
async def company(db: AsyncSession) -> Company:
    c = Company(
        id=uuid.uuid4(),
        name="Test Company",
        slug="test-company-shift-notes",
        settings_json={},
        kiosk_enabled=True,
    )
    db.add(c)
    await db.flush()
    return c


@pytest.fixture
async def admin_user(db: AsyncSession, company: Company) -> User:
    u = User(
        id=uuid.uuid4(),
        company_id=company.id,
        role=UserRole.ADMIN,
        name="Admin",
        email="admin-sn@test.com",
        password_hash=get_password_hash("Admin123!@#"),
        status=UserStatus.ACTIVE,
        email_verified=True,
        verification_required=False,
    )
    db.add(u)
    await db.flush()
    return u


@pytest.fixture
async def employee_user(db: AsyncSession, company: Company) -> User:
    u = User(
        id=uuid.uuid4(),
        company_id=company.id,
        role=UserRole.FRONTDESK,
        name="Employee One",
        email="emp1-sn@test.com",
        password_hash=get_password_hash("Emp123!@#"),
        pin_hash=get_pin_hash("1234"),
        status=UserStatus.ACTIVE,
        email_verified=True,
        verification_required=False,
    )
    db.add(u)
    await db.flush()
    return u


@pytest.fixture
async def employee_user2(db: AsyncSession, company: Company) -> User:
    u = User(
        id=uuid.uuid4(),
        company_id=company.id,
        role=UserRole.FRONTDESK,
        name="Employee Two",
        email="emp2-sn@test.com",
        password_hash=get_password_hash("Emp123!@#"),
        pin_hash=get_pin_hash("5678"),
        status=UserStatus.ACTIVE,
        email_verified=True,
        verification_required=False,
    )
    db.add(u)
    await db.flush()
    return u


async def get_token(client: AsyncClient, email: str, password: str) -> str:
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert r.status_code == 200
    return r.json()["access_token"]


@pytest.mark.asyncio
async def test_employee_get_create_current_shift_note(
    client: AsyncClient,
    db: AsyncSession,
    company: Company,
    admin_user: User,
    employee_user: User,
):
    """Employee can get/create current shift note only for their open shift."""
    await db.commit()
    token = await get_token(client, "emp1-sn@test.com", "Emp123!@#")
    # No open shift -> 404
    r = await client.get(
        "/api/v1/shift-notes/current",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404
    # Create open time entry
    entry = TimeEntry(
        id=uuid.uuid4(),
        company_id=company.id,
        employee_id=employee_user.id,
        clock_in_at=datetime.now(timezone.utc),
        clock_out_at=None,
        source=TimeEntrySource.WEB,
        status=TimeEntryStatus.OPEN,
    )
    db.add(entry)
    await db.commit()
    # Now GET current -> 200 and note created
    r = await client.get(
        "/api/v1/shift-notes/current",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["content"] == ""
    assert data["status"] == "DRAFT"
    assert data["time_entry_id"] == str(entry.id)
    assert data["can_edit"] is True


@pytest.mark.asyncio
async def test_employee_cannot_access_another_employee_note(
    client: AsyncClient,
    db: AsyncSession,
    company: Company,
    employee_user: User,
    employee_user2: User,
):
    """Employee cannot access another employee's note (no open shift for emp2)."""
    await db.commit()
    # Emp1 has open shift and a note
    entry = TimeEntry(
        id=uuid.uuid4(),
        company_id=company.id,
        employee_id=employee_user.id,
        clock_in_at=datetime.now(timezone.utc),
        clock_out_at=None,
        source=TimeEntrySource.WEB,
        status=TimeEntryStatus.OPEN,
    )
    db.add(entry)
    await db.commit()
    token2 = await get_token(client, "emp2-sn@test.com", "Emp123!@#")
    # Emp2 GET current -> 404 (no open shift for emp2)
    r = await client.get(
        "/api/v1/shift-notes/current",
        headers={"Authorization": f"Bearer {token2}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_required_note_blocks_clock_out(
    client: AsyncClient,
    db: AsyncSession,
    company: Company,
    employee_user: User,
):
    """When shift_notes_required_on_clock_out is True and note is empty, punch out returns 400."""
    company.settings_json = {"shift_notes_required_on_clock_out": True}
    db.add(company)
    await db.flush()
    entry = TimeEntry(
        id=uuid.uuid4(),
        company_id=company.id,
        employee_id=employee_user.id,
        clock_in_at=datetime.now(timezone.utc),
        clock_out_at=None,
        source=TimeEntrySource.WEB,
        status=TimeEntryStatus.OPEN,
    )
    db.add(entry)
    await db.commit()
    # Punch out without writing note
    r = await client.post(
        "/api/v1/time/punch",
        json={
            "employee_email": "emp1-sn@test.com",
            "pin": "1234",
            "source": "kiosk",
        },
    )
    assert r.status_code == 400
    assert "Shift Notepad" in (r.json().get("detail") or "")


@pytest.mark.asyncio
async def test_admin_list_search_notes(
    client: AsyncClient,
    db: AsyncSession,
    company: Company,
    admin_user: User,
    employee_user: User,
):
    """Admin can list and search shift notes within company."""
    await db.commit()
    token = await get_token(client, "admin-sn@test.com", "Admin123!@#")
    entry = TimeEntry(
        id=uuid.uuid4(),
        company_id=company.id,
        employee_id=employee_user.id,
        clock_in_at=datetime.now(timezone.utc),
        clock_out_at=None,
        source=TimeEntrySource.WEB,
        status=TimeEntryStatus.OPEN,
    )
    db.add(entry)
    note = ShiftNote(
        id=uuid.uuid4(),
        company_id=company.id,
        time_entry_id=entry.id,
        employee_id=employee_user.id,
        content="Some note content",
        status=ShiftNoteStatus.SUBMITTED,
    )
    db.add(note)
    await db.commit()
    r = await client.get(
        "/api/v1/admin/shift-notes",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["total"] >= 1
    assert any(n["employee_name"] == "Employee One" for n in data["items"])
    r2 = await client.get(
        "/api/v1/admin/shift-notes?search=Some+note",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r2.status_code == 200
    assert r2.json()["total"] >= 1


@pytest.mark.asyncio
async def test_review_action_sets_status_and_audit(
    client: AsyncClient,
    db: AsyncSession,
    company: Company,
    admin_user: User,
    employee_user: User,
):
    """Mark as reviewed changes status and writes audit log."""
    await db.commit()
    admin_token = await get_token(client, "admin-sn@test.com", "Admin123!@#")
    entry = TimeEntry(
        id=uuid.uuid4(),
        company_id=company.id,
        employee_id=employee_user.id,
        clock_in_at=datetime.now(timezone.utc),
        clock_out_at=datetime.now(timezone.utc),
        source=TimeEntrySource.WEB,
        status=TimeEntryStatus.CLOSED,
    )
    db.add(entry)
    note = ShiftNote(
        id=uuid.uuid4(),
        company_id=company.id,
        time_entry_id=entry.id,
        employee_id=employee_user.id,
        content="Done",
        status=ShiftNoteStatus.SUBMITTED,
    )
    db.add(note)
    await db.commit()
    r = await client.post(
        f"/api/v1/admin/shift-notes/{note.id}/review",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200
    await db.refresh(note)
    assert note.status == ShiftNoteStatus.REVIEWED
    assert note.reviewed_by == admin_user.id
    assert note.reviewed_at is not None
    from sqlalchemy import select
    result = await db.execute(
        select(AuditLog).where(
            AuditLog.action == "SHIFT_NOTE_REVIEWED",
            AuditLog.entity_id == note.id,
        )
    )
    audit = result.scalar_one_or_none()
    assert audit is not None
