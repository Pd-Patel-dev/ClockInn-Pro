from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import List

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_current_admin, get_current_verified_user
from app.core.error_handling import handle_endpoint_errors, parse_uuid
from app.models.user import User, UserRole
from app.schemas.user import (
    UserCreate,
    UserUpdate,
    UserResponse,
    UserMeResponse,
)
from app.services.user_service import (
    get_user_me,
    get_user_by_id,
    list_employees,
    create_employee,
    update_employee,
    reset_password,
    delete_employee,
)
from app.models.audit_log import AuditLog
import uuid

router = APIRouter()


@router.get("/me", response_model=UserMeResponse)
@handle_endpoint_errors(operation_name="get_current_user")
async def get_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current user information."""
    user = await get_user_me(db, current_user.id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    
    # Safely get company name
    company_name = ""
    if user.company:
        company_name = user.company.name
    
    return UserMeResponse(
        id=user.id,
        company_id=user.company_id,
        name=user.name,
        email=user.email,
        role=user.role,
        status=user.status,
        company_name=company_name,
        email_verified=user.email_verified,
        verification_required=user.verification_required,
    )


@router.post("/admin/employees", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="create_employee")
async def create_employee_endpoint(
    data: UserCreate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new employee (admin only)."""
    employee = await create_employee(db, current_user.company_id, data)
    
    # Create audit log
    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=current_user.company_id,
        actor_user_id=current_user.id,
        action="employee_created",
        entity_type="user",
        entity_id=employee.id,
        metadata_json={"email": employee.email, "name": employee.name},
    )
    db.add(audit_log)
    await db.commit()
    
    return UserResponse(
        id=employee.id,
        company_id=employee.company_id,
        name=employee.name,
        email=employee.email,
        role=employee.role,
        status=employee.status,
        has_pin=employee.pin_hash is not None,
        pay_rate=float(employee.pay_rate) if employee.pay_rate is not None else None,
        created_at=employee.created_at,
        last_login_at=employee.last_login_at,
    )


@router.get("/admin/employees", response_model=List[UserResponse])
@handle_endpoint_errors(operation_name="list_employees")
async def list_employees_endpoint(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all employees (admin only)."""
    from app.models.time_entry import TimeEntry
    from sqlalchemy import select, func, case
    
    employees, total = await list_employees(db, current_user.company_id, skip, limit)
    
    # Get last punch time and clock status for each employee efficiently
    employee_ids = [emp.id for emp in employees]
    last_punches = {}
    clock_status = {emp_id: False for emp_id in employee_ids}  # Initialize all as clocked out
    
    if employee_ids:
        # First, check for open entries (clocked in) - these are the most important
        open_entries_result = await db.execute(
            select(TimeEntry)
            .where(
                TimeEntry.employee_id.in_(employee_ids),
                TimeEntry.company_id == current_user.company_id,
                TimeEntry.clock_out_at.is_(None)
            )
        )
        open_entries = open_entries_result.scalars().all()
        for entry in open_entries:
            clock_status[entry.employee_id] = True  # Employee is clocked in
        
        # Get all time entries for these employees, ordered by clock_in_at desc
        # We'll process them to get the latest punch per employee
        result = await db.execute(
            select(TimeEntry)
            .where(
                TimeEntry.employee_id.in_(employee_ids),
                TimeEntry.company_id == current_user.company_id
            )
            .order_by(TimeEntry.employee_id, TimeEntry.clock_in_at.desc())
        )
        entries = result.scalars().all()
        
        # Process entries to get the latest punch per employee
        seen_employees = set()
        for entry in entries:
            if entry.employee_id not in seen_employees:
                # Use clock_out_at if it exists, otherwise clock_in_at
                last_punches[entry.employee_id] = entry.clock_out_at if entry.clock_out_at else entry.clock_in_at
                seen_employees.add(entry.employee_id)
    
    return [
        UserResponse(
            id=emp.id,
            company_id=emp.company_id,
            name=emp.name,
            email=emp.email,
            role=emp.role,
            status=emp.status,
            has_pin=emp.pin_hash is not None,
            pay_rate=float(emp.pay_rate) if emp.pay_rate is not None else None,
            created_at=emp.created_at,
            last_login_at=emp.last_login_at,
            last_punch_at=last_punches.get(emp.id),
            is_clocked_in=clock_status.get(emp.id, False),
        )
        for emp in employees
    ]


@router.get("/admin/employees/{employee_id}", response_model=UserResponse)
@handle_endpoint_errors(operation_name="get_employee")
async def get_employee_endpoint(
    employee_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get a single employee by ID (admin only)."""
    from app.models.time_entry import TimeEntry
    from sqlalchemy import select, and_
    
    emp_id = parse_uuid(employee_id, "Employee ID")
    
    employee = await get_user_by_id(db, emp_id, current_user.company_id)
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found",
        )
    
    # Allow all non-admin, non-developer roles (MAINTENANCE, FRONTDESK, HOUSEKEEPING)
    if employee.role in [UserRole.ADMIN, UserRole.DEVELOPER]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot view admin or developer accounts through this endpoint",
        )
    
    # Get last punch time and clock status
    last_punch = None
    is_clocked_in = False
    
    # Check for open entry
    open_entry_result = await db.execute(
        select(TimeEntry)
        .where(
            and_(
                TimeEntry.employee_id == emp_id,
                TimeEntry.company_id == current_user.company_id,
                TimeEntry.clock_out_at.is_(None)
            )
        )
        .order_by(TimeEntry.clock_in_at.desc())
    )
    open_entry = open_entry_result.scalar_one_or_none()
    if open_entry:
        is_clocked_in = True
        last_punch = open_entry.clock_in_at
    else:
        # Get latest entry
        latest_result = await db.execute(
            select(TimeEntry)
            .where(
                and_(
                    TimeEntry.employee_id == emp_id,
                    TimeEntry.company_id == current_user.company_id
                )
            )
            .order_by(TimeEntry.clock_in_at.desc())
            .limit(1)
        )
        latest_entry = latest_result.scalar_one_or_none()
        if latest_entry:
            last_punch = latest_entry.clock_out_at if latest_entry.clock_out_at else latest_entry.clock_in_at
    
    return UserResponse(
        id=employee.id,
        company_id=employee.company_id,
        name=employee.name,
        email=employee.email,
        role=employee.role,
        status=employee.status,
        has_pin=employee.pin_hash is not None,
        pay_rate=float(employee.pay_rate) if employee.pay_rate is not None else None,
        created_at=employee.created_at,
        last_login_at=employee.last_login_at,
        last_punch_at=last_punch,
        is_clocked_in=is_clocked_in,
    )


@router.put("/admin/employees/{employee_id}", response_model=UserResponse)
@handle_endpoint_errors(operation_name="update_employee")
async def update_employee_endpoint(
    employee_id: str,
    data: UserUpdate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update employee (admin only)."""
    emp_id = parse_uuid(employee_id, "Employee ID")
    
    employee = await update_employee(db, emp_id, current_user.company_id, data, actor_user_id=current_user.id)
    
    # Create general audit log for other changes (name, pay_rate)
    changes = data.dict(exclude_unset=True)
    # Remove status and pin from general log as they're logged separately
    general_changes = {k: v for k, v in changes.items() if k not in ['status', 'pin']}
    if general_changes:
        audit_log = AuditLog(
            id=uuid.uuid4(),
            company_id=current_user.company_id,
            actor_user_id=current_user.id,
            action="employee_updated",
            entity_type="user",
            entity_id=employee.id,
            metadata_json={"changes": general_changes},
        )
        db.add(audit_log)
        await db.commit()
    
    return UserResponse(
        id=employee.id,
        company_id=employee.company_id,
        name=employee.name,
        email=employee.email,
        role=employee.role,
        status=employee.status,
        has_pin=employee.pin_hash is not None,
        pay_rate=float(employee.pay_rate) if employee.pay_rate is not None else None,
        created_at=employee.created_at,
        last_login_at=employee.last_login_at,
    )


@router.post("/admin/employees/{employee_id}/reset-password")
@handle_endpoint_errors(operation_name="reset_password")
async def reset_password_endpoint(
    employee_id: str,
    new_password: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Reset employee password (admin only)."""
    emp_id = parse_uuid(employee_id, "Employee ID")
    
    employee = await reset_password(db, emp_id, current_user.company_id, new_password, actor_user_id=current_user.id)
    
    return {"message": "Password reset successfully"}


@router.delete("/admin/employees/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
@handle_endpoint_errors(operation_name="delete_employee")
async def delete_employee_endpoint(
    employee_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete employee (admin only)."""
    emp_id = parse_uuid(employee_id, "Employee ID")
    
    # Get employee info before deletion for audit log
    from app.services.user_service import get_user_by_id
    employee = await get_user_by_id(db, emp_id, current_user.company_id)
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found",
        )
    
    employee_email = employee.email
    employee_name = employee.name
    
    # Delete employee
    await delete_employee(db, emp_id, current_user.company_id)
    
    # Create audit log
    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=current_user.company_id,
        actor_user_id=current_user.id,
        action="employee_deleted",
        entity_type="user",
        entity_id=emp_id,
        metadata_json={"email": employee_email, "name": employee_name},
    )
    db.add(audit_log)
    await db.commit()
    
    return None

