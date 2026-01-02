from typing import Dict
from uuid import UUID
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status

from app.models.company import Company
from app.models.audit_log import AuditLog
from app.schemas.company import CompanySettingsUpdate, CompanyNameUpdate
import uuid

# Default company settings (matching payroll_service defaults)
DEFAULT_TIMEZONE = "America/Chicago"
DEFAULT_WEEK_START_DAY = 0  # Monday
DEFAULT_OVERTIME_THRESHOLD_HOURS = 40
DEFAULT_OVERTIME_MULTIPLIER = Decimal("1.5")
DEFAULT_ROUNDING_POLICY = "none"
DEFAULT_BREAKS_PAID = False  # By default, breaks are NOT paid


def get_company_settings(company: Company) -> Dict:
    """Get company settings with defaults."""
    settings = company.settings_json or {}
    return {
        "timezone": settings.get("timezone", DEFAULT_TIMEZONE),
        "payroll_week_start_day": settings.get("payroll_week_start_day", DEFAULT_WEEK_START_DAY),
        "biweekly_anchor_date": settings.get("biweekly_anchor_date"),
        "overtime_enabled": settings.get("overtime_enabled", True),
        "overtime_threshold_hours_per_week": settings.get("overtime_threshold_hours_per_week", DEFAULT_OVERTIME_THRESHOLD_HOURS),
        "overtime_multiplier_default": Decimal(str(settings.get("overtime_multiplier_default", DEFAULT_OVERTIME_MULTIPLIER))),
        "rounding_policy": settings.get("rounding_policy", DEFAULT_ROUNDING_POLICY),
        "breaks_paid": settings.get("breaks_paid", DEFAULT_BREAKS_PAID),
    }


async def get_company_info(
    db: AsyncSession,
    company_id: UUID,
) -> Company:
    """Get company information."""
    result = await db.execute(
        select(Company).where(Company.id == company_id)
    )
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found",
        )
    return company


async def update_company_name(
    db: AsyncSession,
    company_id: UUID,
    data: CompanyNameUpdate,
    updated_by: UUID,
) -> Company:
    """Update company name."""
    company = await get_company_info(db, company_id)
    
    old_name = company.name
    company.name = data.name
    
    # Create audit log
    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
        actor_user_id=updated_by,
        action="COMPANY_NAME_UPDATE",
        entity_type="company",
        entity_id=company_id,
        metadata_json={
            "old_name": old_name,
            "new_name": data.name,
        },
    )
    db.add(audit_log)
    
    await db.commit()
    await db.refresh(company)
    return company


async def update_company_settings(
    db: AsyncSession,
    company_id: UUID,
    data: CompanySettingsUpdate,
    updated_by: UUID,
) -> Company:
    """Update company settings."""
    company = await get_company_info(db, company_id)
    
    # Get current settings
    current_settings = company.settings_json or {}
    
    # Log what we're receiving
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Updating company settings. Received data: {data.model_dump(exclude_unset=True)}")
    logger.info(f"Current settings before update: {current_settings}")
    
    # Update settings with provided values
    # Check for timezone - it should be a non-empty string if provided
    if data.timezone is not None and data.timezone != "":
        current_settings["timezone"] = data.timezone
        logger.info(f"Updated timezone to: {data.timezone}")
    if data.payroll_week_start_day is not None:
        current_settings["payroll_week_start_day"] = data.payroll_week_start_day
    # Handle biweekly_anchor_date - can be string date or None to clear
    if data.biweekly_anchor_date is not None and data.biweekly_anchor_date != "":
        current_settings["biweekly_anchor_date"] = data.biweekly_anchor_date
    elif data.biweekly_anchor_date is None or data.biweekly_anchor_date == "":
        # Allow clearing the anchor date by passing null or empty string
        if "biweekly_anchor_date" in current_settings:
            del current_settings["biweekly_anchor_date"]
    if data.overtime_enabled is not None:
        current_settings["overtime_enabled"] = data.overtime_enabled
    if data.overtime_threshold_hours_per_week is not None:
        current_settings["overtime_threshold_hours_per_week"] = data.overtime_threshold_hours_per_week
    if data.overtime_multiplier_default is not None:
        current_settings["overtime_multiplier_default"] = data.overtime_multiplier_default
    if data.rounding_policy is not None:
        current_settings["rounding_policy"] = data.rounding_policy
    if data.breaks_paid is not None:
        current_settings["breaks_paid"] = data.breaks_paid
        logger.info(f"Updated breaks_paid to: {data.breaks_paid}")
    
    logger.info(f"Settings after update: {current_settings}")
    
    # IMPORTANT: Clear old/deprecated keys to avoid confusion
    # Remove old key names if they exist
    deprecated_keys = ['week_start_day', 'rounding_rule', 'overtime_threshold']
    for key in deprecated_keys:
        if key in current_settings:
            del current_settings[key]
            logger.info(f"Removed deprecated key: {key}")
    
    # CRITICAL: Create a NEW dictionary object to ensure SQLAlchemy detects the change
    # JSON fields in SQLAlchemy need a new object reference to trigger change detection
    import copy
    new_settings = copy.deepcopy(current_settings)
    company.settings_json = new_settings
    
    # Mark the field as modified explicitly (for JSON fields)
    # This is REQUIRED for SQLAlchemy to detect changes to JSON/JSONB columns
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(company, "settings_json")
    
    logger.info(f"Flagged settings_json as modified. New value: {new_settings}")
    
    # Create audit log
    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
        actor_user_id=updated_by,
        action="COMPANY_SETTINGS_UPDATE",
        entity_type="company",
        entity_id=company_id,
        metadata_json={
            "updated_fields": data.model_dump(exclude_unset=True),
        },
    )
    db.add(audit_log)
    
    # Commit and refresh to ensure data is persisted
    await db.commit()
    
    # IMPORTANT: Expire and refresh to get fresh data from database
    await db.refresh(company)
    
    # Double-check by querying fresh from database
    fresh_result = await db.execute(
        select(Company).where(Company.id == company_id)
    )
    fresh_company = fresh_result.scalar_one()
    
    # Verify the update was saved
    logger.info(f"Company settings_json after commit (from refreshed object): {company.settings_json}")
    logger.info(f"Company settings_json after commit (from fresh query): {fresh_company.settings_json}")
    
    return fresh_company

