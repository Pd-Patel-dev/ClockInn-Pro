"""Housekeeping / rooms API."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from uuid import UUID

from app.core.database import get_db
from app.core.dependencies import get_current_tenant_company_id, require_permission
from app.core.error_handling import handle_endpoint_errors, parse_uuid
from app.models.user import User, UserRole
from app.schemas.housekeeping import (
    HousekeeperOption,
    HousekeepingFinalizeRequest,
    HousekeepingSheetCreate,
    HousekeepingSheetListResponse,
    HousekeepingSheetResponse,
    RoomAssignRequest,
    RoomBulkUpdate,
    RoomCreate,
    RoomResponse,
    RoomUnassignRequest,
    RoomUpdate,
)
from app.services import housekeeping_service as svc
from fastapi import HTTPException, status

router = APIRouter()


def _require_room_admin(user: User) -> None:
    if user.role not in (UserRole.ADMIN, UserRole.MANAGER, UserRole.DEVELOPER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin or Manager can manage room setup",
        )


@router.get("/rooms", response_model=List[RoomResponse])
@handle_endpoint_errors(operation_name="list_rooms")
async def list_rooms(
    include_inactive: bool = Query(False),
    current_user: User = Depends(require_permission("housekeeping")),
    company_id: UUID = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    if include_inactive:
        _require_room_admin(current_user)
    return await svc.list_rooms(db, company_id, include_inactive=include_inactive)


@router.post("/rooms", response_model=RoomResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="create_room")
async def create_room(
    data: RoomCreate,
    current_user: User = Depends(require_permission("housekeeping")),
    company_id: UUID = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    _require_room_admin(current_user)
    return await svc.create_room(db, company_id, data)


@router.post("/rooms/bulk", response_model=List[RoomResponse])
@handle_endpoint_errors(operation_name="bulk_update_rooms")
async def bulk_update_rooms(
    data: RoomBulkUpdate,
    current_user: User = Depends(require_permission("housekeeping")),
    company_id: UUID = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    return await svc.bulk_update_rooms(db, company_id, data)


@router.post("/rooms/assign", response_model=List[RoomResponse])
@handle_endpoint_errors(operation_name="assign_rooms")
async def assign_rooms(
    data: RoomAssignRequest,
    current_user: User = Depends(require_permission("housekeeping")),
    company_id: UUID = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    return await svc.assign_rooms(db, company_id, data)


@router.post("/rooms/unassign", response_model=List[RoomResponse])
@handle_endpoint_errors(operation_name="unassign_rooms")
async def unassign_rooms(
    data: RoomUnassignRequest,
    current_user: User = Depends(require_permission("housekeeping")),
    company_id: UUID = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    return await svc.unassign_rooms(db, company_id, data)


@router.patch("/rooms/{room_id}", response_model=RoomResponse)
@handle_endpoint_errors(operation_name="update_room")
async def update_room(
    room_id: str,
    data: RoomUpdate,
    current_user: User = Depends(require_permission("housekeeping")),
    company_id: UUID = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    rid = parse_uuid(room_id, "Room ID")
    payload = data.model_dump(exclude_unset=True)
    setup_keys = {"number", "room_type", "is_active"}
    # Status updates: any user with housekeeping permission (incl. granted housekeepers)
    if setup_keys & payload.keys():
        _require_room_admin(current_user)
    if not payload:
        raise HTTPException(status_code=400, detail="No changes provided")
    return await svc.update_room(db, company_id, rid, data)


@router.delete("/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
@handle_endpoint_errors(operation_name="delete_room")
async def delete_room(
    room_id: str,
    current_user: User = Depends(require_permission("housekeeping")),
    company_id: UUID = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    _require_room_admin(current_user)
    rid = parse_uuid(room_id, "Room ID")
    await svc.delete_room(db, company_id, rid)
    return None


@router.get("/housekeepers", response_model=List[HousekeeperOption])
@handle_endpoint_errors(operation_name="list_housekeepers")
async def list_housekeepers(
    current_user: User = Depends(require_permission("housekeeping")),
    company_id: UUID = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    users = await svc.list_housekeepers(db, company_id)
    return [HousekeeperOption(id=u.id, name=u.name, email=u.email) for u in users]


@router.get("/housekeepers/{housekeeper_id}/pdf")
@handle_endpoint_errors(operation_name="print_housekeeper_pdf")
async def print_housekeeper_pdf(
    housekeeper_id: str,
    current_user: User = Depends(require_permission("housekeeping")),
    company_id: UUID = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    """Fill HK Excel template, convert to PDF for Chrome print — does not save Past sheets."""
    from datetime import datetime, timezone
    from fastapi.responses import StreamingResponse
    from sqlalchemy import and_, select
    from app.excel_templates.hk_assignment_sheet import generate_hk_assignment_excel
    from app.excel_templates.excel_to_pdf import convert_xlsx_to_pdf
    from app.models.room import Room
    from app.models.user import UserStatus

    hk_id = parse_uuid(housekeeper_id, "Housekeeper ID")
    hk = await db.execute(
        select(User).where(
            and_(
                User.id == hk_id,
                User.company_id == company_id,
                User.role == UserRole.HOUSEKEEPING,
                User.status == UserStatus.ACTIVE,
            )
        )
    )
    housekeeper = hk.scalar_one_or_none()
    if not housekeeper:
        raise HTTPException(status_code=400, detail="Select an active housekeeping employee")

    rooms_result = await db.execute(
        select(Room).where(
            and_(
                Room.company_id == company_id,
                Room.assigned_housekeeper_id == housekeeper.id,
                Room.is_active.is_(True),
            )
        )
    )
    rooms = list(rooms_result.scalars().all())
    if not rooms:
        raise HTTPException(status_code=400, detail="Assign at least one room before printing")

    xlsx = generate_hk_assignment_excel(
        housekeeper_name=housekeeper.name,
        created_at=datetime.now(timezone.utc),
        items=[
            {
                "room_number": r.number,
                "occupancy_status": r.occupancy_status,
                "cleaning_status": r.cleaning_status,
            }
            for r in rooms
        ],
    )
    try:
        buffer = convert_xlsx_to_pdf(xlsx)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    safe_name = "".join(
        ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in (housekeeper.name or "housekeeper")
    )
    filename = f"HK_{safe_name}_{datetime.now(timezone.utc).strftime('%Y%m%d')}.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.post("/sheets", response_model=HousekeepingSheetResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="create_housekeeping_sheet")
async def create_sheet(
    data: HousekeepingSheetCreate,
    current_user: User = Depends(require_permission("housekeeping")),
    company_id: UUID = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_sheet(db, company_id, current_user, data)


@router.post(
    "/sheets/finalize",
    response_model=HousekeepingSheetResponse,
    status_code=status.HTTP_201_CREATED,
)
@handle_endpoint_errors(operation_name="finalize_housekeeping_cleaning")
async def finalize_cleaning(
    data: HousekeepingFinalizeRequest,
    current_user: User = Depends(require_permission("housekeeping")),
    company_id: UUID = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    return await svc.finalize_cleaning(db, company_id, current_user, data)


@router.get("/sheets", response_model=HousekeepingSheetListResponse)
@handle_endpoint_errors(operation_name="list_housekeeping_sheets")
async def list_sheets(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    housekeeper_id: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    current_user: User = Depends(require_permission("housekeeping")),
    company_id: UUID = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    from datetime import date as date_cls

    hk_id = parse_uuid(housekeeper_id, "Housekeeper ID") if housekeeper_id else None
    start = None
    end = None
    if start_date:
        try:
            start = date_cls.fromisoformat(start_date)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid start_date (use YYYY-MM-DD)") from exc
    if end_date:
        try:
            end = date_cls.fromisoformat(end_date)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid end_date (use YYYY-MM-DD)") from exc
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")

    sheets, total, total_rooms = await svc.list_sheets(
        db,
        company_id,
        housekeeper_id=hk_id,
        start_date=start,
        end_date=end,
        skip=skip,
        limit=limit,
    )
    return HousekeepingSheetListResponse(sheets=sheets, total=total, total_rooms=total_rooms)


@router.get("/sheets/{sheet_id}", response_model=HousekeepingSheetResponse)
@handle_endpoint_errors(operation_name="get_housekeeping_sheet")
async def get_sheet(
    sheet_id: str,
    current_user: User = Depends(require_permission("housekeeping")),
    company_id: UUID = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    sid = parse_uuid(sheet_id, "Sheet ID")
    return await svc.get_sheet(db, company_id, sid)


@router.get("/sheets/{sheet_id}/pdf")
@handle_endpoint_errors(operation_name="download_housekeeping_sheet_pdf")
async def download_sheet_pdf(
    sheet_id: str,
    current_user: User = Depends(require_permission("housekeeping")),
    company_id: UUID = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    from fastapi.responses import StreamingResponse
    from app.excel_templates.hk_assignment_sheet import generate_hk_assignment_excel
    from app.excel_templates.excel_to_pdf import convert_xlsx_to_pdf

    sid = parse_uuid(sheet_id, "Sheet ID")
    sheet = await svc.get_sheet(db, company_id, sid)
    xlsx = generate_hk_assignment_excel(
        housekeeper_name=sheet.housekeeper_name,
        created_at=sheet.created_at,
        items=[
            {
                "room_number": item.room_number,
                "occupancy_status": item.occupancy_status,
                "cleaning_status": item.cleaning_status,
            }
            for item in (sheet.items or [])
        ],
    )
    try:
        buffer = convert_xlsx_to_pdf(xlsx)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    safe_name = "".join(
        ch if ch.isalnum() or ch in ("-", "_") else "_"
        for ch in (sheet.housekeeper_name or "housekeeper")
    )
    date_part = sheet.created_at.strftime("%Y%m%d") if sheet.created_at else "sheet"
    filename = f"HK_{safe_name}_{date_part}.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
