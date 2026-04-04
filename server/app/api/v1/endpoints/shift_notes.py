"""Shift Notepad / Common Log API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date
from typing import Optional

from app.core.database import get_db
from app.core.dependencies import get_current_verified_user, get_current_admin, require_permission
from app.core.error_handling import handle_endpoint_errors, parse_uuid
from app.models.user import User, UserRole
from app.schemas.shift_note import (
    ShiftNoteUpdateContent,
    ShiftNoteResponse,
    ShiftNoteListItem,
    ShiftNoteListResponse,
    ShiftNoteCommentCreate,
    ShiftNoteCommentResponse,
    ShiftNotePastListResponse,
    ShiftNotePastItem,
)
from app.services.shift_note_service import (
    get_company_shift_note_settings,
    get_current_shift_note,
    update_current_shift_note,
    list_my_shift_notes,
    list_past_shift_notes_for_employee,
    admin_list_shift_notes,
    admin_get_shift_note,
    admin_get_shift_note_by_time_entry,
    admin_review_shift_note,
    admin_add_comment,
)

router = APIRouter()


def _note_to_response(note, time_entry=None, employee_name=None, can_edit=None):
    return ShiftNoteResponse(
        id=str(note.id),
        company_id=str(note.company_id),
        time_entry_id=str(note.time_entry_id),
        employee_id=str(note.employee_id),
        employee_name=employee_name,
        content=note.content or "",
        beverage_sold=note.beverage_sold,
        status=note.status.value,
        last_edited_at=note.last_edited_at,
        last_edited_by=str(note.last_edited_by) if note.last_edited_by else None,
        reviewed_by=str(note.reviewed_by) if note.reviewed_by else None,
        reviewed_at=note.reviewed_at,
        created_at=note.created_at,
        updated_at=note.updated_at,
        clock_in_at=time_entry.clock_in_at if time_entry else None,
        clock_out_at=time_entry.clock_out_at if time_entry else None,
        is_shift_open=time_entry.clock_out_at is None if time_entry else None,
        can_edit=can_edit,
    )


@router.get("/shift-notes/current", response_model=ShiftNoteResponse)
@handle_endpoint_errors(operation_name="get_current_shift_note")
async def get_current_shift_note_endpoint(
    current_user: User = Depends(require_permission("shift_note:view:self")),
    db: AsyncSession = Depends(get_db),
):
    """Get the shift note for the employee's currently open time entry (creates if missing)."""
    settings = await get_company_shift_note_settings(db, current_user.company_id)
    if not settings.get("shift_notes_enabled", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Shift notepad is not enabled for your company.",
        )
    if current_user.role == UserRole.ADMIN or current_user.role == UserRole.DEVELOPER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only employees can use the shift notepad. Clock in as an employee first.",
        )
    note = await get_current_shift_note(db, current_user.company_id, current_user.id)
    if not note:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No open shift. Clock in first to use the shift notepad.",
        )
    from sqlalchemy import select
    from app.models.time_entry import TimeEntry
    result = await db.execute(select(TimeEntry).where(TimeEntry.id == note.time_entry_id))
    entry = result.scalar_one_or_none()
    allow_edit_after = settings.get("shift_notes_allow_edit_after_clock_out", False)
    can_edit = entry.clock_out_at is None or allow_edit_after
    return _note_to_response(note, time_entry=entry, employee_name=current_user.name, can_edit=can_edit)


@router.get("/shift-notes/active", response_model=ShiftNoteResponse)
@handle_endpoint_errors(operation_name="get_active_shift_note")
async def get_active_shift_note_endpoint(
    current_user: User = Depends(require_permission("shift_note:view:self")),
    db: AsyncSession = Depends(get_db),
):
    """Alias for GET /shift-notes/current — note for the open time entry."""
    return await get_current_shift_note_endpoint(current_user=current_user, db=db)


@router.get("/shift-notes/past", response_model=ShiftNotePastListResponse)
@handle_endpoint_errors(operation_name="list_past_shift_notes")
async def list_past_shift_notes_endpoint(
    limit: int = Query(10, ge=1, le=50),
    current_user: User = Depends(require_permission("shift_note:view:self")),
    db: AsyncSession = Depends(get_db),
):
    """Last N closed-shift notes for the employee (full content), newest first."""
    settings = await get_company_shift_note_settings(db, current_user.company_id)
    if not settings.get("shift_notes_enabled", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Shift notepad is not enabled for your company.",
        )
    if current_user.role in (UserRole.ADMIN, UserRole.DEVELOPER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only employees can view past shift notes.",
        )
    rows = await list_past_shift_notes_for_employee(
        db, current_user.company_id, current_user.id, limit=limit
    )
    return ShiftNotePastListResponse(items=[ShiftNotePastItem(**r) for r in rows])


@router.put("/shift-notes/current", response_model=ShiftNoteResponse)
@handle_endpoint_errors(operation_name="update_current_shift_note")
async def update_current_shift_note_endpoint(
    data: ShiftNoteUpdateContent,
    current_user: User = Depends(require_permission("shift_note:edit:self")),
    db: AsyncSession = Depends(get_db),
):
    """Update the current shift note content (autosave)."""
    settings = await get_company_shift_note_settings(db, current_user.company_id)
    if not settings.get("shift_notes_enabled", True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shift notepad is not enabled.")
    if current_user.role in (UserRole.ADMIN, UserRole.DEVELOPER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only employees can edit shift notes.")
    note = await update_current_shift_note(
        db, current_user.company_id, current_user.id, data.content, current_user.id, beverage_sold=data.beverage_sold
    )
    from sqlalchemy import select
    from app.models.time_entry import TimeEntry
    await db.commit()
    await db.refresh(note)
    result = await db.execute(select(TimeEntry).where(TimeEntry.id == note.time_entry_id))
    entry = result.scalar_one_or_none()
    allow_edit_after = settings.get("shift_notes_allow_edit_after_clock_out", False)
    can_edit = entry.clock_out_at is None or allow_edit_after
    return _note_to_response(note, time_entry=entry, employee_name=current_user.name, can_edit=can_edit)


@router.get("/shift-notes/my", response_model=ShiftNoteListResponse)
@handle_endpoint_errors(operation_name="list_my_shift_notes")
async def list_my_shift_notes_endpoint(
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(require_permission("shift_note:view:self")),
    db: AsyncSession = Depends(get_db),
):
    """List current user's shift notes."""
    settings = await get_company_shift_note_settings(db, current_user.company_id)
    if not settings.get("shift_notes_enabled", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Shift notepad is not enabled for your company.",
        )
    notes, total = await list_my_shift_notes(
        db, current_user.company_id, current_user.id, from_date, to_date, skip, limit
    )
    items = []
    for note in notes:
        preview_lines = (note.content or "").strip().split("\n")[:2]
        preview = "\n".join(preview_lines)[:200].strip() if preview_lines else ""
        items.append(
            ShiftNoteListItem(
                id=str(note.id),
                time_entry_id=str(note.time_entry_id),
                employee_id=str(note.employee_id),
                employee_name=current_user.name,
                clock_in_at=None,
                clock_out_at=None,
                preview=preview,
                content=None,
                latest_manager_comment=None,
                beverage_sold=note.beverage_sold,
                status=note.status.value,
                updated_at=note.updated_at,
                last_edited_at=note.last_edited_at,
                reviewed_at=note.reviewed_at,
                updated_since_review=False,
                cash_delta_cents=None,
            )
        )
    return ShiftNoteListResponse(items=items, total=total)


# ---- Common Log (all company users: see all employees' shift notes) ----

@router.get("/shift-notes/common", response_model=ShiftNoteListResponse)
@handle_endpoint_errors(operation_name="list_common_shift_notes")
async def list_common_shift_notes_endpoint(
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    sort_by: Optional[str] = Query("clock_in_at", description="Sort by clock_in_at or updated_at"),
    order: Optional[str] = Query("desc", description="asc or desc"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    current_user: User = Depends(get_current_verified_user),
    db: AsyncSession = Depends(get_db),
):
    """List all company shift notes so every employee can see what is going on (common log)."""
    settings = await get_company_shift_note_settings(db, current_user.company_id)
    if not settings.get("shift_notes_enabled", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Shift notes are not enabled for your company.",
        )
    items, total = await admin_list_shift_notes(
        db,
        current_user.company_id,
        from_date=from_date,
        to_date=to_date,
        employee_id=None,
        status_filter=None,
        search=None,
        skip=skip,
        limit=limit,
        sort_by=sort_by,
        order=order,
    )
    return ShiftNoteListResponse(
        items=[ShiftNoteListItem(**x) for x in items],
        total=total,
    )


# ---- Admin Common Log ----

@router.get("/admin/shift-notes", response_model=ShiftNoteListResponse)
@handle_endpoint_errors(operation_name="admin_list_shift_notes")
async def admin_list_shift_notes_endpoint(
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    employee_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort_by: Optional[str] = Query("clock_in_at", description="Sort by clock_in_at or updated_at"),
    order: Optional[str] = Query("desc", description="asc or desc"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """List shift notes for Common Log (admin), ordered by timestamp by default."""
    emp_uuid = parse_uuid(employee_id, "employee_id") if employee_id else None
    items, total = await admin_list_shift_notes(
        db,
        current_user.company_id,
        from_date=from_date,
        to_date=to_date,
        employee_id=emp_uuid,
        status_filter=status,
        search=search,
        skip=skip,
        limit=limit,
        sort_by=sort_by,
        order=order,
        include_full_content=True,
    )
    return ShiftNoteListResponse(
        items=[ShiftNoteListItem(**x) for x in items],
        total=total,
    )


@router.get("/admin/shift-notes/{note_id}")
@handle_endpoint_errors(operation_name="admin_get_shift_note")
async def admin_get_shift_note_endpoint(
    note_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get full shift note for Common Log viewer."""
    nid = parse_uuid(note_id, "note_id")
    return await admin_get_shift_note(db, current_user.company_id, nid)


@router.get("/admin/shift-notes/by-time-entry/{time_entry_id}")
@handle_endpoint_errors(operation_name="admin_get_shift_note_by_time_entry")
async def admin_get_shift_note_by_time_entry_endpoint(
    time_entry_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get shift note + cash drawer by time_entry_id for combined Shift Log view."""
    teid = parse_uuid(time_entry_id, "time_entry_id")
    return await admin_get_shift_note_by_time_entry(db, current_user.company_id, teid)


@router.post("/admin/shift-notes/{note_id}/review")
@handle_endpoint_errors(operation_name="admin_review_shift_note")
async def admin_review_shift_note_endpoint(
    note_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Mark shift note as reviewed."""
    nid = parse_uuid(note_id, "note_id")
    await admin_review_shift_note(db, current_user.company_id, nid, current_user.id)
    await db.commit()
    return {"message": "Shift note marked as reviewed"}


@router.post("/admin/shift-notes/{note_id}/comment", response_model=ShiftNoteCommentResponse)
@handle_endpoint_errors(operation_name="admin_add_shift_note_comment")
async def admin_add_shift_note_comment_endpoint(
    note_id: str,
    data: ShiftNoteCommentCreate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Add a manager comment to a shift note."""
    nid = parse_uuid(note_id, "note_id")
    comment = await admin_add_comment(
        db, current_user.company_id, nid, current_user.id, data.comment
    )
    await db.commit()
    await db.refresh(comment)
    return ShiftNoteCommentResponse(
        id=str(comment.id),
        shift_note_id=str(comment.shift_note_id),
        actor_user_id=str(comment.actor_user_id),
        actor_name=current_user.name,
        comment=comment.comment,
        created_at=comment.created_at,
    )


@router.patch("/admin/shift-notes/{note_id}/comment", response_model=ShiftNoteCommentResponse)
@handle_endpoint_errors(operation_name="admin_patch_shift_note_comment")
async def admin_patch_shift_note_comment_endpoint(
    note_id: str,
    data: ShiftNoteCommentCreate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Same as POST — appends a manager comment (no separate edit model)."""
    return await admin_add_shift_note_comment_endpoint(
        note_id=note_id, data=data, current_user=current_user, db=db
    )
