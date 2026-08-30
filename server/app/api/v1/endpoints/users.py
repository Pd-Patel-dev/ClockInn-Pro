from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import List
from uuid import UUID as UUIDType
from pydantic import BaseModel, Field
import uuid

from app.core.database import get_db
from app.core.dependencies import (
    get_current_user,
    get_current_tenant_company_id,
    require_permission,
)
from app.core.error_handling import handle_endpoint_errors, parse_uuid
from app.models.user import User, UserRole
from app.models.audit_log import AuditLog
from app.schemas.user import (
    UserCreate,
    UserUpdate,
    UserResponse,
    UserMeResponse,
    UserRoleUpdate,
)
from app.services.user_service import (
    get_user_me,
    get_user_by_id,
    list_employee_user_responses,
    create_employee,
    update_employee,
    reset_password,
    delete_employee,
)
from app.services.effective_permission_service import (
    get_effective_feature_permissions,
    get_employee_permission_view,
    replace_employee_permission_overrides,
)

router = APIRouter()


class EmployeePermissionOverridesUpdate(BaseModel):
    grants: List[str] = Field(default_factory=list)
    denies: List[str] = Field(default_factory=list)


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

    # If company has email verification disabled, report as verified so app does not redirect to verify-email
    from app.services.company_service import get_company_settings
    email_verified = user.email_verified
    verification_required = user.verification_required
    if user.company:
        settings = get_company_settings(user.company)
        if not settings.get("email_verification_required", True):
            email_verified = True
            verification_required = False
    
    effective = await get_effective_feature_permissions(db, user)

    return UserMeResponse(
        id=user.id,
        company_id=user.company_id,
        name=user.name,
        email=user.email,
        role=user.role,
        status=user.status,
        company_name=company_name,
        email_verified=email_verified,
        verification_required=verification_required,
        permissions=sorted(effective),
        preferred_name=user.preferred_name,
        phone=user.phone,
        avatar_url=user.avatar_url,
        timezone=user.timezone or "America/Chicago",
        date_format=user.date_format or "MM/DD/YYYY",
        time_format=user.time_format or "12h",
        first_day_of_week=user.first_day_of_week if user.first_day_of_week is not None else 0,
        theme_preference=user.theme_preference or "system",
        created_at=user.created_at,
        last_verified_at=user.last_verified_at,
        has_pin=bool(user.pin_hash),
    )


@router.post("/admin/employees", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="create_employee")
async def create_employee_endpoint(
    data: UserCreate,
    current_user: User = Depends(require_permission("user_management")),
    company_id: UUIDType = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a new employee (admin only)."""
    if data.role == UserRole.ADMIN and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can assign the admin role",
        )
    employee = await create_employee(db, company_id, data)
    
    # Create audit log
    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
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
        pay_method=employee.pay_method,
        preferred_name=employee.preferred_name,
        phone=employee.phone,
        job_role=employee.job_role,
        created_at=employee.created_at,
        last_login_at=employee.last_login_at,
    )


@router.get("/admin/employees", response_model=List[UserResponse])
@handle_endpoint_errors(operation_name="list_employees")
async def list_employees_endpoint(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user: User = Depends(require_permission("user_management")),
    company_id: UUIDType = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    """List all employees (admin only)."""
    return await list_employee_user_responses(db, company_id, skip, limit)


@router.get("/admin/employees/{employee_id}", response_model=UserResponse)
@handle_endpoint_errors(operation_name="get_employee")
async def get_employee_endpoint(
    employee_id: str,
    current_user: User = Depends(require_permission("user_management")),
    company_id: UUIDType = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    """Get a single employee by ID (admin only)."""
    from app.models.time_entry import TimeEntry
    from sqlalchemy import select, and_
    
    emp_id = parse_uuid(employee_id, "Employee ID")
    
    employee = await get_user_by_id(db, emp_id, company_id)
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found",
        )
    
    # Platform developers are not tenant employees
    if employee.role == UserRole.DEVELOPER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot view developer accounts through this endpoint",
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
                TimeEntry.company_id == company_id,
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
                    TimeEntry.company_id == company_id
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
        pay_method=employee.pay_method,
        preferred_name=employee.preferred_name,
        phone=employee.phone,
        job_role=employee.job_role,
        created_at=employee.created_at,
        last_login_at=employee.last_login_at,
        last_punch_at=last_punch,
        is_clocked_in=is_clocked_in,
        password_setup_pending=bool(employee.password_setup_token_hash),
    )


@router.get("/admin/employees/{employee_id}/permissions")
@handle_endpoint_errors(operation_name="get_employee_permissions")
async def get_employee_permissions_endpoint(
    employee_id: str,
    current_user: User = Depends(require_permission("user_management")),
    company_id: UUIDType = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    """Get role defaults + overrides for an employee (Admin/Manager only)."""
    emp_id = parse_uuid(employee_id, "Employee ID")
    employee = await get_user_by_id(db, emp_id, company_id)
    if not employee or employee.role == UserRole.DEVELOPER:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    return await get_employee_permission_view(db, actor=current_user, employee=employee)


@router.put("/admin/employees/{employee_id}/permissions")
@handle_endpoint_errors(operation_name="update_employee_permissions")
async def update_employee_permissions_endpoint(
    employee_id: str,
    body: EmployeePermissionOverridesUpdate,
    current_user: User = Depends(require_permission("user_management")),
    company_id: UUIDType = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    """Replace grant/deny overrides for an employee (Admin/Manager only)."""
    emp_id = parse_uuid(employee_id, "Employee ID")
    employee = await get_user_by_id(db, emp_id, company_id)
    if not employee or employee.role == UserRole.DEVELOPER:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    result = await replace_employee_permission_overrides(
        db,
        actor=current_user,
        employee=employee,
        grants=body.grants,
        denies=body.denies,
    )

    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
        actor_user_id=current_user.id,
        action="employee_permissions_updated",
        entity_type="user",
        entity_id=employee.id,
        metadata_json={"grants": body.grants, "denies": body.denies},
    )
    db.add(audit_log)
    await db.commit()
    return result


@router.put("/admin/employees/{employee_id}", response_model=UserResponse)
@handle_endpoint_errors(operation_name="update_employee")
async def update_employee_endpoint(
    employee_id: str,
    data: UserUpdate,
    current_user: User = Depends(require_permission("user_management")),
    company_id: UUIDType = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    """Update employee (admin only)."""
    emp_id = parse_uuid(employee_id, "Employee ID")
    
    if data.role == UserRole.ADMIN and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can assign the admin role",
        )
    employee = await update_employee(db, emp_id, company_id, data, actor_user_id=current_user.id)
    
    # Create general audit log for other changes (name, pay_rate)
    changes = data.dict(exclude_unset=True)
    # Remove status and pin from general log as they're logged separately
    general_changes = {k: v for k, v in changes.items() if k not in ['status', 'pin']}
    if general_changes:
        audit_log = AuditLog(
            id=uuid.uuid4(),
            company_id=company_id,
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
        pay_method=employee.pay_method,
        preferred_name=employee.preferred_name,
        phone=employee.phone,
        job_role=employee.job_role,
        created_at=employee.created_at,
        last_login_at=employee.last_login_at,
    )


@router.post("/admin/employees/{employee_id}/reset-password")
@handle_endpoint_errors(operation_name="reset_password")
async def reset_password_endpoint(
    employee_id: str,
    new_password: str,
    current_user: User = Depends(require_permission("user_management")),
    company_id: UUIDType = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    """Reset employee password (admin only)."""
    emp_id = parse_uuid(employee_id, "Employee ID")
    
    employee = await reset_password(db, emp_id, company_id, new_password, actor_user_id=current_user.id)
    
    return {"message": "Password reset successfully"}


@router.post("/admin/employees/{employee_id}/resend-password-setup")
@handle_endpoint_errors(operation_name="resend_password_setup")
async def resend_password_setup_endpoint(
    employee_id: str,
    current_user: User = Depends(require_permission("user_management")),
    company_id: UUIDType = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    """Re-send invite / set-password email when the previous link expired or never arrived."""
    from app.services.user_service import resend_password_setup_as_admin

    emp_id = parse_uuid(employee_id, "Employee ID")
    return await resend_password_setup_as_admin(
        db, emp_id, company_id, actor_user_id=current_user.id
    )


@router.delete("/admin/employees/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
@handle_endpoint_errors(operation_name="delete_employee")
async def delete_employee_endpoint(
    employee_id: str,
    current_user: User = Depends(require_permission("user_management")),
    company_id: UUIDType = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete employee (admin only)."""
    emp_id = parse_uuid(employee_id, "Employee ID")
    
    # Get employee info before deletion for audit log
    from app.services.user_service import get_user_by_id
    employee = await get_user_by_id(db, emp_id, company_id)
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found",
        )
    
    employee_email = employee.email
    employee_name = employee.name
    
    # Delete employee
    await delete_employee(db, emp_id, company_id)
    
    # Create audit log
    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
        actor_user_id=current_user.id,
        action="employee_deleted",
        entity_type="user",
        entity_id=emp_id,
        metadata_json={"email": employee_email, "name": employee_name},
    )
    db.add(audit_log)
    await db.commit()
    
    return None


@router.patch("/admin/employees/{employee_id}/role")
@handle_endpoint_errors(operation_name="update_employee_role")
async def update_employee_role_endpoint(
    employee_id: str,
    body: UserRoleUpdate,
    current_user: User = Depends(require_permission("user_management")),
    company_id: UUIDType = Depends(get_current_tenant_company_id),
    db: AsyncSession = Depends(get_db),
):
    """Update a user's role (admin/manager with user_management permission)."""
    emp_id = parse_uuid(employee_id, "Employee ID")
    employee = await get_user_by_id(db, emp_id, company_id)
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if body.role == UserRole.ADMIN and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can assign the admin role",
        )
    if body.role == UserRole.DEVELOPER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot assign DEVELOPER role through tenant employee APIs",
        )

    # Prevent users from accidentally removing the last admin from admin role.
    if employee.role == UserRole.ADMIN and body.role != UserRole.ADMIN:
        result = await db.execute(
            select(User).where(
                and_(
                    User.company_id == company_id,
                    User.role == UserRole.ADMIN,
                    User.status == employee.status,
                )
            )
        )
        admins = result.scalars().all()
        if len(admins) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot change role of the last admin",
            )

    employee.role = body.role
    db.add(employee)
    await db.commit()
    await db.refresh(employee)
    return {"message": "Role updated", "role": employee.role}

