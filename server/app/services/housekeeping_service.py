"""Housekeeping rooms and assignment sheets."""
from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import List, Optional, Tuple
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.room import (
    HousekeepingSheet,
    HousekeepingSheetItem,
    HousekeepingSheetKind,
    Room,
    RoomCleaningStatus,
    RoomOccupancyStatus,
)
from app.models.user import User, UserRole, UserStatus
from app.schemas.housekeeping import (
    HousekeepingFinalizeRequest,
    HousekeepingSheetCreate,
    RoomAssignRequest,
    RoomBulkUpdate,
    RoomCreate,
    RoomUnassignRequest,
    RoomUpdate,
)


def _norm_number(value: str) -> str:
    return (value or "").strip()


def _norm_type(value: str) -> str:
    t = (value or "").strip()
    return t or "Standard"


async def list_rooms(
    db: AsyncSession,
    company_id: UUID,
    *,
    include_inactive: bool = False,
) -> List[Room]:
    q = select(Room).where(Room.company_id == company_id)
    if not include_inactive:
        q = q.where(Room.is_active.is_(True))
    q = q.order_by(Room.number.asc())
    return list((await db.execute(q)).scalars().all())


async def create_room(db: AsyncSession, company_id: UUID, data: RoomCreate) -> Room:
    number = _norm_number(data.number)
    if not number:
        raise HTTPException(status_code=400, detail="Room number is required")
    existing = (
        await db.execute(
            select(Room).where(and_(Room.company_id == company_id, Room.number == number))
        )
    ).scalar_one_or_none()
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=409, detail=f"Room {number} already exists")
        # Leftover soft-deleted rows from older behavior — free the number
        await db.delete(existing)
        await db.flush()

    room = Room(
        id=uuid4(),
        company_id=company_id,
        number=number,
        room_type=_norm_type(data.room_type),
        occupancy_status=RoomOccupancyStatus.DEPARTING.value,
        cleaning_status=RoomCleaningStatus.CLEAN.value,
        is_active=True,
    )
    db.add(room)
    await db.commit()
    await db.refresh(room)
    return room


async def get_room(db: AsyncSession, company_id: UUID, room_id: UUID) -> Room:
    result = await db.execute(
        select(Room).where(and_(Room.id == room_id, Room.company_id == company_id))
    )
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


async def update_room(
    db: AsyncSession,
    company_id: UUID,
    room_id: UUID,
    data: RoomUpdate,
) -> Room:
    room = await get_room(db, company_id, room_id)
    payload = data.model_dump(exclude_unset=True)

    if "number" in payload and payload["number"] is not None:
        number = _norm_number(payload["number"])
        if not number:
            raise HTTPException(status_code=400, detail="Room number is required")
        dup = await db.execute(
            select(Room).where(
                and_(
                    Room.company_id == company_id,
                    Room.number == number,
                    Room.id != room.id,
                )
            )
        )
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Room {number} already exists")
        room.number = number

    if "room_type" in payload and payload["room_type"] is not None:
        room.room_type = _norm_type(payload["room_type"])

    if "is_active" in payload and payload["is_active"] is not None:
        room.is_active = bool(payload["is_active"])

    prev_occ = room.occupancy_status
    if "occupancy_status" in payload and payload["occupancy_status"] is not None:
        occ = payload["occupancy_status"]
        if occ not in (RoomOccupancyStatus.DEPARTING.value, RoomOccupancyStatus.STAYOVER.value):
            raise HTTPException(status_code=400, detail="Invalid occupancy status")
        room.occupancy_status = occ
        # Auto dirty when guest departs: stayover → departing
        if (
            prev_occ == RoomOccupancyStatus.STAYOVER.value
            and occ == RoomOccupancyStatus.DEPARTING.value
            and "cleaning_status" not in payload
        ):
            room.cleaning_status = RoomCleaningStatus.DIRTY.value

    if "cleaning_status" in payload and payload["cleaning_status"] is not None:
        clean = payload["cleaning_status"]
        if clean not in (RoomCleaningStatus.CLEAN.value, RoomCleaningStatus.DIRTY.value):
            raise HTTPException(status_code=400, detail="Invalid cleaning status")
        room.cleaning_status = clean

    if "assigned_housekeeper_id" in payload:
        hk_id = payload["assigned_housekeeper_id"]
        if hk_id is None:
            room.assigned_housekeeper_id = None
        else:
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
            if not hk.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="Select an active housekeeping employee")
            room.assigned_housekeeper_id = hk_id

    await db.commit()
    await db.refresh(room)
    return room


async def assign_rooms(
    db: AsyncSession,
    company_id: UUID,
    data: RoomAssignRequest,
) -> List[Room]:
    hk = await db.execute(
        select(User).where(
            and_(
                User.id == data.housekeeper_id,
                User.company_id == company_id,
                User.role == UserRole.HOUSEKEEPING,
                User.status == UserStatus.ACTIVE,
            )
        )
    )
    if not hk.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Select an active housekeeping employee")

    room_ids = list(dict.fromkeys(data.room_ids))
    result = await db.execute(
        select(Room).where(
            and_(
                Room.company_id == company_id,
                Room.id.in_(room_ids),
                Room.is_active.is_(True),
            )
        )
    )
    rooms = list(result.scalars().all())
    if len(rooms) != len(room_ids):
        raise HTTPException(status_code=400, detail="One or more rooms were not found")

    for room in rooms:
        room.assigned_housekeeper_id = data.housekeeper_id

    await db.commit()
    for room in rooms:
        await db.refresh(room)
    return rooms


async def unassign_rooms(
    db: AsyncSession,
    company_id: UUID,
    data: RoomUnassignRequest,
) -> List[Room]:
    room_ids = list(dict.fromkeys(data.room_ids))
    result = await db.execute(
        select(Room).where(
            and_(
                Room.company_id == company_id,
                Room.id.in_(room_ids),
                Room.is_active.is_(True),
            )
        )
    )
    rooms = list(result.scalars().all())
    if len(rooms) != len(room_ids):
        raise HTTPException(status_code=400, detail="One or more rooms were not found")

    for room in rooms:
        room.assigned_housekeeper_id = None

    await db.commit()
    for room in rooms:
        await db.refresh(room)
    return rooms


async def bulk_update_rooms(
    db: AsyncSession,
    company_id: UUID,
    data: RoomBulkUpdate,
) -> List[Room]:
    payload = data.model_dump(exclude_unset=True)
    room_ids = list(dict.fromkeys(data.room_ids))  # preserve order, unique
    status_payload = {
        k: payload[k]
        for k in ("occupancy_status", "cleaning_status")
        if k in payload and payload[k] is not None
    }
    if not status_payload:
        raise HTTPException(status_code=400, detail="Provide occupancy and/or cleaning status")

    result = await db.execute(
        select(Room).where(
            and_(
                Room.company_id == company_id,
                Room.id.in_(room_ids),
                Room.is_active.is_(True),
            )
        )
    )
    rooms = list(result.scalars().all())
    if len(rooms) != len(room_ids):
        raise HTTPException(status_code=400, detail="One or more rooms were not found")

    by_id = {r.id: r for r in rooms}
    updated: List[Room] = []
    for rid in room_ids:
        room = by_id[rid]
        prev_occ = room.occupancy_status
        if "occupancy_status" in status_payload:
            occ = status_payload["occupancy_status"]
            room.occupancy_status = occ
            if (
                prev_occ == RoomOccupancyStatus.STAYOVER.value
                and occ == RoomOccupancyStatus.DEPARTING.value
                and "cleaning_status" not in status_payload
            ):
                room.cleaning_status = RoomCleaningStatus.DIRTY.value
        if "cleaning_status" in status_payload:
            room.cleaning_status = status_payload["cleaning_status"]
        updated.append(room)

    await db.commit()
    for room in updated:
        await db.refresh(room)
    return updated


async def delete_room(db: AsyncSession, company_id: UUID, room_id: UUID) -> None:
    room = await get_room(db, company_id, room_id)
    await db.delete(room)
    await db.commit()


async def list_housekeepers(db: AsyncSession, company_id: UUID) -> List[User]:
    result = await db.execute(
        select(User)
        .where(
            and_(
                User.company_id == company_id,
                User.role == UserRole.HOUSEKEEPING,
                User.status == UserStatus.ACTIVE,
            )
        )
        .order_by(User.name.asc())
    )
    return list(result.scalars().all())


async def create_sheet(
    db: AsyncSession,
    company_id: UUID,
    actor: User,
    data: HousekeepingSheetCreate,
) -> HousekeepingSheet:
    hk = await db.execute(
        select(User).where(
            and_(
                User.id == data.housekeeper_id,
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
                Room.id.in_(data.room_ids),
                Room.is_active.is_(True),
            )
        )
    )
    rooms = list(rooms_result.scalars().all())
    if len(rooms) != len(set(data.room_ids)):
        raise HTTPException(status_code=400, detail="One or more rooms were not found")

    sheet = HousekeepingSheet(
        id=uuid4(),
        company_id=company_id,
        housekeeper_id=housekeeper.id,
        housekeeper_name=housekeeper.name,
        created_by=actor.id,
        created_by_name=actor.name,
        notes=(data.notes or "").strip() or None,
        kind=HousekeepingSheetKind.ASSIGNMENT.value,
    )
    db.add(sheet)
    await db.flush()

    for room in sorted(rooms, key=lambda r: r.number):
        db.add(
            HousekeepingSheetItem(
                id=uuid4(),
                sheet_id=sheet.id,
                room_id=room.id,
                room_number=room.number,
                room_type=room.room_type,
                occupancy_status=room.occupancy_status,
                cleaning_status=room.cleaning_status,
            )
        )

    await db.commit()
    return await get_sheet(db, company_id, sheet.id)


async def finalize_cleaning(
    db: AsyncSession,
    company_id: UUID,
    actor: User,
    data: HousekeepingFinalizeRequest,
) -> HousekeepingSheet:
    """Snapshot assigned rooms into an immutable past sheet, then clear the board."""
    hk = await db.execute(
        select(User).where(
            and_(
                User.id == data.housekeeper_id,
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
        raise HTTPException(status_code=400, detail="No rooms assigned to finalize")

    sheet = HousekeepingSheet(
        id=uuid4(),
        company_id=company_id,
        housekeeper_id=housekeeper.id,
        housekeeper_name=housekeeper.name,
        created_by=actor.id,
        created_by_name=actor.name,
        notes=(data.notes or "").strip() or "Cleaning done — finalized board",
        kind=HousekeepingSheetKind.FINALIZE.value,
    )
    db.add(sheet)
    await db.flush()

    for room in sorted(rooms, key=lambda r: r.number):
        db.add(
            HousekeepingSheetItem(
                id=uuid4(),
                sheet_id=sheet.id,
                room_id=room.id,
                room_number=room.number,
                room_type=room.room_type,
                occupancy_status=room.occupancy_status,
                cleaning_status=room.cleaning_status,
            )
        )
        room.assigned_housekeeper_id = None
        room.cleaning_status = RoomCleaningStatus.CLEAN.value

    await db.commit()
    return await get_sheet(db, company_id, sheet.id)


async def list_sheets(
    db: AsyncSession,
    company_id: UUID,
    *,
    housekeeper_id: Optional[UUID] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    skip: int = 0,
    limit: int = 50,
) -> Tuple[List[HousekeepingSheet], int, int]:
    filters = [HousekeepingSheet.company_id == company_id]
    if housekeeper_id is not None:
        filters.append(HousekeepingSheet.housekeeper_id == housekeeper_id)
    if start_date is not None:
        start_dt = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
        filters.append(HousekeepingSheet.created_at >= start_dt)
    if end_date is not None:
        end_dt = datetime.combine(end_date, time.max, tzinfo=timezone.utc)
        filters.append(HousekeepingSheet.created_at <= end_dt)

    where_clause = and_(*filters)

    total = (
        await db.execute(
            select(func.count()).select_from(HousekeepingSheet).where(where_clause)
        )
    ).scalar_one()

    total_rooms = (
        await db.execute(
            select(func.count(HousekeepingSheetItem.id))
            .select_from(HousekeepingSheetItem)
            .join(HousekeepingSheet, HousekeepingSheetItem.sheet_id == HousekeepingSheet.id)
            .where(where_clause)
        )
    ).scalar_one()

    result = await db.execute(
        select(HousekeepingSheet)
        .where(where_clause)
        .options(selectinload(HousekeepingSheet.items))
        .order_by(HousekeepingSheet.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return (
        list(result.scalars().unique().all()),
        int(total or 0),
        int(total_rooms or 0),
    )


async def get_sheet(db: AsyncSession, company_id: UUID, sheet_id: UUID) -> HousekeepingSheet:
    result = await db.execute(
        select(HousekeepingSheet)
        .where(
            and_(
                HousekeepingSheet.id == sheet_id,
                HousekeepingSheet.company_id == company_id,
            )
        )
        .options(selectinload(HousekeepingSheet.items))
    )
    sheet = result.scalar_one_or_none()
    if not sheet:
        raise HTTPException(status_code=404, detail="Assignment sheet not found")
    return sheet
