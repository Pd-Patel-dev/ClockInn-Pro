"""Single round-trip data for the schedule UI (callers need ``schedule`` permission, not ``user_management``)."""
from datetime import date
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handling import parse_uuid
from app.models.user import User, UserRole
from app.schemas.schedule_context import SchedulePageContextResponse
from app.schemas.shift import ShiftResponse
from app.services.company_service import get_company_info, get_company_settings
from app.services.shift_service import list_shifts
from app.services.user_service import list_employee_user_responses


async def get_schedule_page_context(
    db: AsyncSession,
    current_user: User,
    start_date: date,
    end_date: date,
    employee_id: Optional[str] = None,
    shift_limit: int = 1000,
) -> SchedulePageContextResponse:
    """
    Employees (admin list), shifts in range, and schedule timeline hours — same semantics as
    separate GET /users/admin/employees, GET /shifts, and GET /company/info for settings.
    """
    employees = await list_employee_user_responses(
        db, current_user.company_id, skip=0, limit=1000
    )

    parsed_employee_id: Optional[UUID] = parse_uuid(employee_id, "Employee ID") if employee_id else None
    if current_user.role in (UserRole.MAINTENANCE, UserRole.FRONTDESK, UserRole.HOUSEKEEPING):
        parsed_employee_id = current_user.id

    shifts, _total = await list_shifts(
        db,
        current_user.company_id,
        employee_id=parsed_employee_id,
        start_date=start_date,
        end_date=end_date,
        status=None,
        skip=0,
        limit=shift_limit,
    )

    shift_responses = [
        ShiftResponse(
            id=s.id,
            company_id=s.company_id,
            employee_id=s.employee_id,
            employee_name=s.employee.name if s.employee else None,
            shift_date=s.shift_date,
            start_time=s.start_time,
            end_time=s.end_time,
            break_minutes=s.break_minutes,
            notes=s.notes,
            job_role=s.job_role,
            status=s.status.value,
            requires_approval=s.requires_approval,
            template_id=s.template_id,
            approved_by=s.approved_by,
            approved_at=s.approved_at,
            created_at=s.created_at,
            created_by=s.created_by,
            updated_at=s.updated_at,
        )
        for s in shifts
    ]

    company = await get_company_info(db, current_user.company_id)
    settings = get_company_settings(company)
    start_h = int(settings.get("schedule_day_start_hour", 7))
    end_h = int(settings.get("schedule_day_end_hour", 7))

    return SchedulePageContextResponse(
        employees=employees,
        shifts=shift_responses,
        schedule_day_start_hour=start_h,
        schedule_day_end_hour=end_h,
    )
