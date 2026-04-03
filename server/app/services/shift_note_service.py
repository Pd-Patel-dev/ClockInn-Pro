"""Service for Shift Notepad / Common Log."""
from typing import Optional, List, Tuple
from uuid import UUID
from datetime import datetime, date, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from fastapi import HTTPException, status
import uuid

from app.models.shift_note import ShiftNote, ShiftNoteComment, ShiftNoteStatus
from app.models.time_entry import TimeEntry, TimeEntryStatus
from app.models.user import User
from app.models.company import Company
from app.models.audit_log import AuditLog
from app.services.company_service import get_company_settings, MIN_SHIFT_NOTE_LENGTH_REQUIRED


async def get_company_shift_note_settings(db: AsyncSession, company_id: UUID) -> dict:
    """Get company settings for shift notes."""
    result = await db.execute(select(Company).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    if not company:
        return {}
    return get_company_settings(company)


async def get_or_create_shift_note_for_entry(
    db: AsyncSession,
    company_id: UUID,
    time_entry_id: UUID,
    employee_id: UUID,
) -> ShiftNote:
    """Get existing ShiftNote for time_entry or create one (lazy create)."""
    result = await db.execute(
        select(ShiftNote).where(
            and_(
                ShiftNote.company_id == company_id,
                ShiftNote.time_entry_id == time_entry_id,
            )
        )
    )
    note = result.scalar_one_or_none()
    if note:
        return note
    note = ShiftNote(
        id=uuid.uuid4(),
        company_id=company_id,
        time_entry_id=time_entry_id,
        employee_id=employee_id,
        content="",
        status=ShiftNoteStatus.DRAFT,
    )
    db.add(note)
    await db.flush()
    audit = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
        actor_user_id=employee_id,
        action="SHIFT_NOTE_CREATED",
        entity_type="shift_note",
        entity_id=note.id,
        metadata_json={"time_entry_id": str(time_entry_id)},
    )
    db.add(audit)
    return note


async def get_current_shift_note(
    db: AsyncSession,
    company_id: UUID,
    employee_id: UUID,
) -> Optional[ShiftNote]:
    """Get the shift note for the employee's currently OPEN time entry. Creates if missing."""
    result = await db.execute(
        select(TimeEntry).where(
            and_(
                TimeEntry.company_id == company_id,
                TimeEntry.employee_id == employee_id,
                TimeEntry.clock_out_at.is_(None),
            )
        ).order_by(TimeEntry.clock_in_at.desc())
    )
    open_entry = result.scalar_one_or_none()
    if not open_entry:
        return None
    return await get_or_create_shift_note_for_entry(
        db, company_id, open_entry.id, employee_id
    )


async def update_current_shift_note(
    db: AsyncSession,
    company_id: UUID,
    employee_id: UUID,
    content: str,
    edited_by: UUID,
    beverage_sold: Optional[int] = None,
) -> ShiftNote:
    """Update content and optional beverage_sold of current (open) shift note. Enforces company settings for edit-after-clock-out."""
    note = await get_current_shift_note(db, company_id, employee_id)
    if not note:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No open shift found. Clock in first to use the shift notepad.",
        )
    result = await db.execute(
        select(TimeEntry).where(TimeEntry.id == note.time_entry_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time entry not found")
    settings = await get_company_shift_note_settings(db, company_id)
    allow_edit_after = settings.get("shift_notes_allow_edit_after_clock_out", False)
    if entry.clock_out_at is not None and not allow_edit_after:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This shift is closed. Editing the note is not allowed.",
        )
    note.content = content
    if beverage_sold is not None:
        note.beverage_sold = beverage_sold if beverage_sold >= 0 else None
    note.last_edited_at = datetime.utcnow()
    note.last_edited_by = edited_by
    if entry.clock_out_at is None:
        note.status = ShiftNoteStatus.DRAFT
    else:
        note.status = ShiftNoteStatus.SUBMITTED
    await db.flush()
    audit = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
        actor_user_id=edited_by,
        action="SHIFT_NOTE_UPDATED",
        entity_type="shift_note",
        entity_id=note.id,
        metadata_json={"time_entry_id": str(note.time_entry_id)},
    )
    db.add(audit)
    return note


async def list_my_shift_notes(
    db: AsyncSession,
    company_id: UUID,
    employee_id: UUID,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    skip: int = 0,
    limit: int = 50,
) -> Tuple[List[ShiftNote], int]:
    """List shift notes for the given employee."""
    q = (
        select(ShiftNote)
        .where(
            and_(
                ShiftNote.company_id == company_id,
                ShiftNote.employee_id == employee_id,
            )
        )
        .order_by(ShiftNote.updated_at.desc())
    )
    if from_date or to_date:
        q = q.join(TimeEntry, TimeEntry.id == ShiftNote.time_entry_id)
        if from_date:
            q = q.where(TimeEntry.clock_in_at >= datetime.combine(from_date, datetime.min.time()))
        if to_date:
            q = q.where(TimeEntry.clock_in_at < datetime.combine(to_date, datetime.min.time()) + timedelta(days=1))
    # Count with same filters (without order/offset/limit)
    count_q = select(func.count(ShiftNote.id)).select_from(ShiftNote).where(
        and_(
            ShiftNote.company_id == company_id,
            ShiftNote.employee_id == employee_id,
        )
    )
    if from_date or to_date:
        count_q = count_q.join(TimeEntry, TimeEntry.id == ShiftNote.time_entry_id)
        if from_date:
            count_q = count_q.where(TimeEntry.clock_in_at >= datetime.combine(from_date, datetime.min.time()))
        if to_date:
            count_q = count_q.where(TimeEntry.clock_in_at < datetime.combine(to_date, datetime.min.time()) + timedelta(days=1))
    total = (await db.execute(count_q)).scalar() or 0
    q = q.offset(skip).limit(limit)
    result = await db.execute(q)
    notes = list(result.scalars().unique().all())
    return notes, total


async def admin_list_shift_notes(
    db: AsyncSession,
    company_id: UUID,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    employee_id: Optional[UUID] = None,
    status_filter: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    sort_by: Optional[str] = "clock_in_at",
    order: Optional[str] = "desc",
) -> Tuple[List[dict], int]:
    """List shift notes for admin common log with filters and search."""
    from app.models.cash_drawer import CashDrawerSession

    q = (
        select(ShiftNote, TimeEntry, User.name.label("employee_name"))
        .join(TimeEntry, TimeEntry.id == ShiftNote.time_entry_id)
        .join(User, User.id == ShiftNote.employee_id)
        .where(ShiftNote.company_id == company_id)
    )
    if from_date:
        q = q.where(TimeEntry.clock_in_at >= datetime.combine(from_date, datetime.min.time()))
    if to_date:
        q = q.where(TimeEntry.clock_in_at < datetime.combine(to_date, datetime.min.time()) + timedelta(days=1))
    if employee_id:
        q = q.where(ShiftNote.employee_id == employee_id)
    if status_filter:
        try:
            status_enum = ShiftNoteStatus(status_filter.strip().upper())
            q = q.where(ShiftNote.status == status_enum)
        except ValueError:
            pass
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.where(ShiftNote.content.ilike(term))
    # Sort: by shift time (clock_in_at) or by note updated_at
    sort_by = (sort_by or "clock_in_at").lower()
    order_asc = (order or "desc").lower() == "asc"
    if sort_by == "clock_in_at":
        q = q.order_by(TimeEntry.clock_in_at.desc() if not order_asc else TimeEntry.clock_in_at.asc())
    else:
        q = q.order_by(ShiftNote.updated_at.desc() if not order_asc else ShiftNote.updated_at.asc())
    # Use a separate count query to avoid subquery/alias issues in some async drivers
    count_q = (
        select(func.count(ShiftNote.id))
        .select_from(ShiftNote)
        .join(TimeEntry, TimeEntry.id == ShiftNote.time_entry_id)
        .where(ShiftNote.company_id == company_id)
    )
    if from_date:
        count_q = count_q.where(TimeEntry.clock_in_at >= datetime.combine(from_date, datetime.min.time()))
    if to_date:
        count_q = count_q.where(TimeEntry.clock_in_at < datetime.combine(to_date, datetime.min.time()) + timedelta(days=1))
    if employee_id:
        count_q = count_q.where(ShiftNote.employee_id == employee_id)
    if status_filter:
        try:
            status_enum = ShiftNoteStatus(status_filter.strip().upper())
            count_q = count_q.where(ShiftNote.status == status_enum)
        except ValueError:
            pass
    if search and search.strip():
        term = f"%{search.strip()}%"
        count_q = count_q.where(ShiftNote.content.ilike(term))
    total = (await db.execute(count_q)).scalar() or 0
    q = q.offset(skip).limit(limit)
    result = await db.execute(q)
    rows = result.all()

    time_entry_ids = [r[1].id for r in rows]
    cash_result = await db.execute(
        select(CashDrawerSession.time_entry_id, CashDrawerSession.delta_cents).where(
            and_(
                CashDrawerSession.company_id == company_id,
                CashDrawerSession.time_entry_id.in_(time_entry_ids),
            )
        )
    )
    cash_map = {r[0]: r[1] for r in cash_result.all()}

    items = []
    for note, entry, employee_name in rows:
        preview_lines = (note.content or "").strip().split("\n")[:2]
        preview = "\n".join(preview_lines)[:200].strip() if preview_lines else ""
        if len((note.content or "").strip()) > 200:
            preview = preview[:197] + "..."
        updated_since_review = (
            note.reviewed_at is not None
            and note.last_edited_at is not None
            and note.last_edited_at > note.reviewed_at
        )
        cash_delta = cash_map.get(entry.id)
        if cash_delta is not None and not isinstance(cash_delta, int):
            try:
                cash_delta = int(cash_delta)
            except (TypeError, ValueError):
                cash_delta = None
        items.append({
            "id": str(note.id),
            "time_entry_id": str(note.time_entry_id),
            "employee_id": str(note.employee_id),
            "employee_name": employee_name,
            "clock_in_at": entry.clock_in_at,
            "clock_out_at": entry.clock_out_at,
            "preview": preview,
            "beverage_sold": getattr(note, "beverage_sold", None),
            "status": note.status.value,
            "updated_at": note.updated_at,
            "last_edited_at": note.last_edited_at,
            "reviewed_at": note.reviewed_at,
            "updated_since_review": updated_since_review,
            "cash_delta_cents": cash_delta,
        })
    return items, total


async def admin_get_shift_note(
    db: AsyncSession,
    company_id: UUID,
    shift_note_id: UUID,
) -> dict:
    """Get full shift note with metadata for admin viewer."""
    from app.models.cash_drawer import CashDrawerSession

    result = await db.execute(
        select(ShiftNote, TimeEntry, User.name.label("employee_name"))
        .join(TimeEntry, TimeEntry.id == ShiftNote.time_entry_id)
        .join(User, User.id == ShiftNote.employee_id)
        .where(
            and_(
                ShiftNote.id == shift_note_id,
                ShiftNote.company_id == company_id,
            )
        )
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift note not found")
    note, entry, employee_name = row
    cash_result = await db.execute(
        select(CashDrawerSession).where(
            and_(
                CashDrawerSession.company_id == company_id,
                CashDrawerSession.time_entry_id == entry.id,
            )
        )
    )
    cash_session = cash_result.scalar_one_or_none()
    return {
        "id": str(note.id),
        "company_id": str(note.company_id),
        "time_entry_id": str(note.time_entry_id),
        "employee_id": str(note.employee_id),
        "employee_name": employee_name,
        "content": note.content or "",
        "beverage_sold": getattr(note, "beverage_sold", None),
        "status": note.status.value,
        "last_edited_at": note.last_edited_at,
        "last_edited_by": str(note.last_edited_by) if note.last_edited_by else None,
        "reviewed_by": str(note.reviewed_by) if note.reviewed_by else None,
        "reviewed_at": note.reviewed_at,
        "created_at": note.created_at,
        "updated_at": note.updated_at,
        "clock_in_at": entry.clock_in_at,
        "clock_out_at": entry.clock_out_at,
        "is_shift_open": entry.clock_out_at is None,
        "cash_start_cents": cash_session.start_cash_cents if cash_session else None,
        "cash_end_cents": cash_session.end_cash_cents if cash_session else None,
        "cash_delta_cents": getattr(cash_session, "delta_cents", None) if cash_session else None,
        "collected_cash_cents": getattr(cash_session, "collected_cash_cents", None) if cash_session else None,
        "drop_amount_cents": getattr(cash_session, "drop_amount_cents", None) if cash_session else None,
        "beverages_cash_cents": getattr(cash_session, "beverages_cash_cents", None) if cash_session else None,
    }


async def admin_get_shift_note_by_time_entry(
    db: AsyncSession,
    company_id: UUID,
    time_entry_id: UUID,
) -> dict:
    """Get full shift note + cash drawer by time_entry_id for combined shift log view. Returns 404 if no note."""
    from app.models.cash_drawer import CashDrawerSession

    result = await db.execute(
        select(ShiftNote, TimeEntry, User.name.label("employee_name"))
        .join(TimeEntry, TimeEntry.id == ShiftNote.time_entry_id)
        .join(User, User.id == ShiftNote.employee_id)
        .where(
            and_(
                ShiftNote.time_entry_id == time_entry_id,
                ShiftNote.company_id == company_id,
            )
        )
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift note not found for this time entry")
    note, entry, employee_name = row
    cash_result = await db.execute(
        select(CashDrawerSession).where(
            and_(
                CashDrawerSession.company_id == company_id,
                CashDrawerSession.time_entry_id == entry.id,
            )
        )
    )
    cash_session = cash_result.scalar_one_or_none()
    return {
        "id": str(note.id),
        "company_id": str(note.company_id),
        "time_entry_id": str(note.time_entry_id),
        "employee_id": str(note.employee_id),
        "employee_name": employee_name,
        "content": note.content or "",
        "beverage_sold": getattr(note, "beverage_sold", None),
        "status": note.status.value,
        "last_edited_at": note.last_edited_at,
        "last_edited_by": str(note.last_edited_by) if note.last_edited_by else None,
        "reviewed_by": str(note.reviewed_by) if note.reviewed_by else None,
        "reviewed_at": note.reviewed_at,
        "created_at": note.created_at,
        "updated_at": note.updated_at,
        "clock_in_at": entry.clock_in_at,
        "clock_out_at": entry.clock_out_at,
        "is_shift_open": entry.clock_out_at is None,
        "cash_start_cents": cash_session.start_cash_cents if cash_session else None,
        "cash_end_cents": cash_session.end_cash_cents if cash_session else None,
        "cash_delta_cents": getattr(cash_session, "delta_cents", None) if cash_session else None,
        "collected_cash_cents": getattr(cash_session, "collected_cash_cents", None) if cash_session else None,
        "drop_amount_cents": getattr(cash_session, "drop_amount_cents", None) if cash_session else None,
        "beverages_cash_cents": getattr(cash_session, "beverages_cash_cents", None) if cash_session else None,
    }


async def admin_review_shift_note(
    db: AsyncSession,
    company_id: UUID,
    shift_note_id: UUID,
    reviewed_by: UUID,
) -> ShiftNote:
    """Mark shift note as reviewed."""
    result = await db.execute(
        select(ShiftNote).where(
            and_(
                ShiftNote.id == shift_note_id,
                ShiftNote.company_id == company_id,
            )
        )
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift note not found")
    note.status = ShiftNoteStatus.REVIEWED
    note.reviewed_by = reviewed_by
    note.reviewed_at = datetime.utcnow()
    await db.flush()
    audit = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
        actor_user_id=reviewed_by,
        action="SHIFT_NOTE_REVIEWED",
        entity_type="shift_note",
        entity_id=note.id,
        metadata_json={"time_entry_id": str(note.time_entry_id), "employee_id": str(note.employee_id)},
    )
    db.add(audit)
    return note


async def admin_add_comment(
    db: AsyncSession,
    company_id: UUID,
    shift_note_id: UUID,
    actor_user_id: UUID,
    comment: str,
) -> ShiftNoteComment:
    """Add a manager comment to a shift note."""
    result = await db.execute(
        select(ShiftNote).where(
            and_(
                ShiftNote.id == shift_note_id,
                ShiftNote.company_id == company_id,
            )
        )
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift note not found")
    comment_obj = ShiftNoteComment(
        id=uuid.uuid4(),
        company_id=company_id,
        shift_note_id=note.id,
        actor_user_id=actor_user_id,
        comment=comment.strip(),
    )
    db.add(comment_obj)
    await db.flush()
    audit = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
        actor_user_id=actor_user_id,
        action="SHIFT_NOTE_COMMENTED",
        entity_type="shift_note",
        entity_id=note.id,
        metadata_json={"comment_id": str(comment_obj.id)},
    )
    db.add(audit)
    return comment_obj


async def check_shift_note_required_for_clock_out(
    db: AsyncSession,
    company_id: UUID,
    time_entry_id: UUID,
) -> Optional[str]:
    """
    If company requires shift note on clock-out and note is empty/too short,
    return error message. Otherwise return None.
    """
    settings = await get_company_shift_note_settings(db, company_id)
    if not settings.get("shift_notes_enabled", True):
        return None
    if not settings.get("shift_notes_required_on_clock_out"):
        return None
    result = await db.execute(
        select(ShiftNote).where(
            and_(
                ShiftNote.company_id == company_id,
                ShiftNote.time_entry_id == time_entry_id,
            )
        )
    )
    note = result.scalar_one_or_none()
    content = (note.content or "").strip() if note else ""
    if len(content) < MIN_SHIFT_NOTE_LENGTH_REQUIRED:
        return "Please complete the Shift Notepad before clocking out."
    return None
