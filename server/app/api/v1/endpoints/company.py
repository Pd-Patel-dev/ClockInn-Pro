from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date as date_type

from app.core.dependencies import get_db, get_current_admin, get_current_user
from app.core.error_handling import handle_endpoint_errors
from app.models.user import User, UserRole
from app.schemas.company import (
    CompanyInfoResponse,
    CompanySettingsResponse,
    CompanySettingsUpdate,
    CompanyNameUpdate,
    AdminInfo,
)
from sqlalchemy import select
from app.services.company_service import (
    get_company_info,
    get_company_settings,
    update_company_name,
    update_company_settings,
)

router = APIRouter()


@router.get("/company/info", response_model=CompanyInfoResponse)
@handle_endpoint_errors(operation_name="get_company_info_public")
async def get_company_info_public_endpoint(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get company information and settings (for authenticated users)."""
    company = await get_company_info(db, current_user.company_id)
    settings = get_company_settings(company)
    
    # Convert biweekly_anchor_date string to date if present
    biweekly_anchor = None
    if settings.get("biweekly_anchor_date"):
        try:
            biweekly_anchor = date_type.fromisoformat(settings["biweekly_anchor_date"])
        except (ValueError, TypeError):
            pass
    
    # Get admin user for this company (only for admin users)
    admin_info = None
    if current_user.role == UserRole.ADMIN:
        admin_result = await db.execute(
            select(User).where(
                User.company_id == current_user.company_id,
                User.role == UserRole.ADMIN
            ).order_by(User.created_at.asc()).limit(1)
        )
        admin_user = admin_result.scalar_one_or_none()
        
        if admin_user:
            admin_info = AdminInfo(
                id=str(admin_user.id),
                name=admin_user.name,
                email=admin_user.email,
                created_at=admin_user.created_at.isoformat(),
                last_login_at=admin_user.last_login_at.isoformat() if admin_user.last_login_at else None,
            )
    
    return CompanyInfoResponse(
        id=str(company.id),
        name=company.name,
        slug=company.slug,
        kiosk_enabled=company.kiosk_enabled,
        created_at=company.created_at.isoformat(),
        settings=CompanySettingsResponse(
            timezone=settings["timezone"],
            payroll_week_start_day=settings["payroll_week_start_day"],
            biweekly_anchor_date=biweekly_anchor,
            overtime_enabled=settings["overtime_enabled"],
            overtime_threshold_hours_per_week=settings["overtime_threshold_hours_per_week"],
            overtime_multiplier_default=settings["overtime_multiplier_default"],
            rounding_policy=settings["rounding_policy"],
            breaks_paid=settings["breaks_paid"],
            cash_drawer_enabled=settings.get("cash_drawer_enabled", False),
            cash_drawer_required_for_all=settings.get("cash_drawer_required_for_all", False),
            cash_drawer_required_roles=settings.get("cash_drawer_required_roles", []),
            cash_drawer_currency=settings.get("cash_drawer_currency", "USD"),
            cash_drawer_starting_amount_cents=settings.get("cash_drawer_starting_amount_cents", 0),
            cash_drawer_variance_threshold_cents=settings.get("cash_drawer_variance_threshold_cents", 2000),
            cash_drawer_allow_edit=settings.get("cash_drawer_allow_edit", True),
            cash_drawer_require_manager_review=settings.get("cash_drawer_require_manager_review", False),
        ),
        admin=admin_info,
    )


@router.get("/admin/company", response_model=CompanyInfoResponse)
@handle_endpoint_errors(operation_name="get_company_info")
async def get_company_info_endpoint(
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get company information and settings (admin only)."""
    company = await get_company_info(db, current_user.company_id)
    settings = get_company_settings(company)
    
    # Convert biweekly_anchor_date string to date if present
    biweekly_anchor = None
    if settings.get("biweekly_anchor_date"):
        try:
            biweekly_anchor = date_type.fromisoformat(settings["biweekly_anchor_date"])
        except (ValueError, TypeError):
            pass
    
    # Get admin user for this company
    admin_result = await db.execute(
        select(User).where(
            User.company_id == current_user.company_id,
            User.role == UserRole.ADMIN
        ).order_by(User.created_at.asc()).limit(1)
    )
    admin_user = admin_result.scalar_one_or_none()
    
    admin_info = None
    if admin_user:
        admin_info = AdminInfo(
            id=str(admin_user.id),
            name=admin_user.name,
            email=admin_user.email,
            created_at=admin_user.created_at.isoformat(),
            last_login_at=admin_user.last_login_at.isoformat() if admin_user.last_login_at else None,
        )
    
    return CompanyInfoResponse(
        id=str(company.id),
        name=company.name,
        slug=company.slug,
        kiosk_enabled=company.kiosk_enabled,
        created_at=company.created_at.isoformat(),
        settings=CompanySettingsResponse(
            timezone=settings["timezone"],
            payroll_week_start_day=settings["payroll_week_start_day"],
            biweekly_anchor_date=biweekly_anchor,
            overtime_enabled=settings["overtime_enabled"],
            overtime_threshold_hours_per_week=settings["overtime_threshold_hours_per_week"],
            overtime_multiplier_default=settings["overtime_multiplier_default"],
            rounding_policy=settings["rounding_policy"],
            breaks_paid=settings["breaks_paid"],
            cash_drawer_enabled=settings.get("cash_drawer_enabled", False),
            cash_drawer_required_for_all=settings.get("cash_drawer_required_for_all", False),
            cash_drawer_required_roles=settings.get("cash_drawer_required_roles", []),
            cash_drawer_currency=settings.get("cash_drawer_currency", "USD"),
            cash_drawer_starting_amount_cents=settings.get("cash_drawer_starting_amount_cents", 0),
            cash_drawer_variance_threshold_cents=settings.get("cash_drawer_variance_threshold_cents", 2000),
            cash_drawer_allow_edit=settings.get("cash_drawer_allow_edit", True),
            cash_drawer_require_manager_review=settings.get("cash_drawer_require_manager_review", False),
        ),
        admin=admin_info,
    )


@router.put("/admin/company/name", response_model=CompanyInfoResponse)
@handle_endpoint_errors(operation_name="update_company_name")
async def update_company_name_endpoint(
    data: CompanyNameUpdate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update company name (admin only)."""
    company = await update_company_name(
        db,
        current_user.company_id,
        data,
        current_user.id,
    )
    settings = get_company_settings(company)
    
    # Convert biweekly_anchor_date string to date if present
    biweekly_anchor = None
    if settings.get("biweekly_anchor_date"):
        try:
            biweekly_anchor = date_type.fromisoformat(settings["biweekly_anchor_date"])
        except (ValueError, TypeError):
            pass
    
    # Get admin user for this company
    admin_result = await db.execute(
        select(User).where(
            User.company_id == current_user.company_id,
            User.role == UserRole.ADMIN
        ).order_by(User.created_at.asc()).limit(1)
    )
    admin_user = admin_result.scalar_one_or_none()
    
    admin_info = None
    if admin_user:
        admin_info = AdminInfo(
            id=str(admin_user.id),
            name=admin_user.name,
            email=admin_user.email,
            created_at=admin_user.created_at.isoformat(),
            last_login_at=admin_user.last_login_at.isoformat() if admin_user.last_login_at else None,
        )
    
    return CompanyInfoResponse(
        id=str(company.id),
        name=company.name,
        slug=company.slug,
        kiosk_enabled=company.kiosk_enabled,
        created_at=company.created_at.isoformat(),
        settings=CompanySettingsResponse(
            timezone=settings["timezone"],
            payroll_week_start_day=settings["payroll_week_start_day"],
            biweekly_anchor_date=biweekly_anchor,
            overtime_enabled=settings["overtime_enabled"],
            overtime_threshold_hours_per_week=settings["overtime_threshold_hours_per_week"],
            overtime_multiplier_default=settings["overtime_multiplier_default"],
            rounding_policy=settings["rounding_policy"],
            breaks_paid=settings["breaks_paid"],
            cash_drawer_enabled=settings.get("cash_drawer_enabled", False),
            cash_drawer_required_for_all=settings.get("cash_drawer_required_for_all", False),
            cash_drawer_required_roles=settings.get("cash_drawer_required_roles", []),
            cash_drawer_currency=settings.get("cash_drawer_currency", "USD"),
            cash_drawer_starting_amount_cents=settings.get("cash_drawer_starting_amount_cents", 0),
            cash_drawer_variance_threshold_cents=settings.get("cash_drawer_variance_threshold_cents", 2000),
            cash_drawer_allow_edit=settings.get("cash_drawer_allow_edit", True),
            cash_drawer_require_manager_review=settings.get("cash_drawer_require_manager_review", False),
        ),
        admin=admin_info,
    )


@router.put("/admin/company/settings", response_model=CompanyInfoResponse)
@handle_endpoint_errors(operation_name="update_company_settings")
async def update_company_settings_endpoint(
    data: CompanySettingsUpdate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update company settings (admin only)."""
    company = await update_company_settings(
        db,
        current_user.company_id,
        data,
        current_user.id,
    )
    
    # IMPORTANT: Re-fetch the company to get fresh data from database
    from app.services.company_service import get_company_info
    company = await get_company_info(db, current_user.company_id)
    
    settings = get_company_settings(company)
    
    # Convert biweekly_anchor_date string to date if present
    biweekly_anchor = None
    if settings.get("biweekly_anchor_date"):
        try:
            biweekly_anchor = date_type.fromisoformat(settings["biweekly_anchor_date"])
        except (ValueError, TypeError):
            pass
    
    # Get admin user for this company
    admin_result = await db.execute(
        select(User).where(
            User.company_id == current_user.company_id,
            User.role == UserRole.ADMIN
        ).order_by(User.created_at.asc()).limit(1)
    )
    admin_user = admin_result.scalar_one_or_none()
    
    admin_info = None
    if admin_user:
        admin_info = AdminInfo(
            id=str(admin_user.id),
            name=admin_user.name,
            email=admin_user.email,
            created_at=admin_user.created_at.isoformat(),
            last_login_at=admin_user.last_login_at.isoformat() if admin_user.last_login_at else None,
        )
    
    return CompanyInfoResponse(
        id=str(company.id),
        name=company.name,
        slug=company.slug,
        kiosk_enabled=company.kiosk_enabled,
        created_at=company.created_at.isoformat(),
        settings=CompanySettingsResponse(
            timezone=settings["timezone"],
            payroll_week_start_day=settings["payroll_week_start_day"],
            biweekly_anchor_date=biweekly_anchor,
            overtime_enabled=settings["overtime_enabled"],
            overtime_threshold_hours_per_week=settings["overtime_threshold_hours_per_week"],
            overtime_multiplier_default=settings["overtime_multiplier_default"],
            rounding_policy=settings["rounding_policy"],
            breaks_paid=settings["breaks_paid"],
            cash_drawer_enabled=settings.get("cash_drawer_enabled", False),
            cash_drawer_required_for_all=settings.get("cash_drawer_required_for_all", False),
            cash_drawer_required_roles=settings.get("cash_drawer_required_roles", []),
            cash_drawer_currency=settings.get("cash_drawer_currency", "USD"),
            cash_drawer_starting_amount_cents=settings.get("cash_drawer_starting_amount_cents", 0),
            cash_drawer_variance_threshold_cents=settings.get("cash_drawer_variance_threshold_cents", 2000),
            cash_drawer_allow_edit=settings.get("cash_drawer_allow_edit", True),
            cash_drawer_require_manager_review=settings.get("cash_drawer_require_manager_review", False),
        ),
        admin=admin_info,
    )

