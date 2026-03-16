from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date
from decimal import Decimal


class CompanySettingsResponse(BaseModel):
    """Company settings with defaults applied."""
    timezone: str
    payroll_week_start_day: int  # 0=Monday, 6=Sunday
    biweekly_anchor_date: Optional[date] = None
    overtime_enabled: bool
    overtime_threshold_hours_per_week: int
    overtime_multiplier_default: Decimal
    rounding_policy: str  # none, 5, 6, 10, 15, 30
    breaks_paid: bool  # Whether breaks are paid (default: False)
    cash_drawer_enabled: Optional[bool] = False
    cash_drawer_required_for_all: Optional[bool] = False
    cash_drawer_required_roles: Optional[list[str]] = None
    cash_drawer_currency: Optional[str] = None
    cash_drawer_starting_amount_cents: Optional[int] = None
    cash_drawer_variance_threshold_cents: Optional[int] = None
    cash_drawer_allow_edit: Optional[bool] = None
    cash_drawer_require_manager_review: Optional[bool] = None
    schedule_day_start_hour: Optional[int] = 7  # 0-23, hour when schedule day starts (e.g. 7 = 7 AM)
    schedule_day_end_hour: Optional[int] = 7    # 0-23, hour when schedule day ends (same = 24h, e.g. 7 = 7 AM next day)
    shift_notes_enabled: Optional[bool] = True
    shift_notes_required_on_clock_out: Optional[bool] = False
    shift_notes_allow_edit_after_clock_out: Optional[bool] = False
    email_verification_required: Optional[bool] = True  # If False, users in this company can use the app without verifying email
    # Geofence: require punch in/out only when at office
    geofence_enabled: Optional[bool] = False
    office_latitude: Optional[float] = None
    office_longitude: Optional[float] = None
    geofence_radius_meters: Optional[int] = 100
    # Kiosk: only allow on office network (IP allowlist)
    kiosk_network_restriction_enabled: Optional[bool] = False
    kiosk_allowed_ips: Optional[List[str]] = None


class AdminInfo(BaseModel):
    """Admin user information."""
    id: str
    name: str
    email: str
    created_at: str
    last_login_at: Optional[str] = None

    class Config:
        from_attributes = True


class CompanyInfoResponse(BaseModel):
    """Company basic information."""
    id: str
    name: str
    slug: str
    kiosk_enabled: bool
    created_at: str
    settings: CompanySettingsResponse
    admin: Optional[AdminInfo] = None

    class Config:
        from_attributes = True


class CompanySettingsUpdate(BaseModel):
    """Update company settings."""
    timezone: Optional[str] = Field(None, max_length=100, description="Company timezone (e.g., America/New_York)")
    payroll_week_start_day: Optional[int] = Field(None, ge=0, le=6, description="Week start day: 0=Monday, 6=Sunday")
    biweekly_anchor_date: Optional[str] = Field(None, max_length=10, description="Biweekly payroll anchor date (YYYY-MM-DD format, or null to clear)")
    overtime_enabled: Optional[bool] = Field(None, description="Enable/disable overtime calculation")
    overtime_threshold_hours_per_week: Optional[int] = Field(None, ge=1, le=168, description="Hours before overtime kicks in")
    overtime_multiplier_default: Optional[float] = Field(None, ge=1, le=3, description="Default overtime multiplier (e.g., 1.5)")
    rounding_policy: Optional[str] = Field(None, pattern="^(none|5|6|10|15|30)$", description="Rounding policy: none, 5, 6, 10, 15 (7-minute rule), or 30 minutes")
    breaks_paid: Optional[bool] = Field(None, description="Whether breaks are paid (default: False - breaks are deducted from pay)")
    # Cash drawer settings
    cash_drawer_enabled: Optional[bool] = Field(None, description="Enable cash drawer management")
    cash_drawer_required_for_all: Optional[bool] = Field(None, description="Require cash drawer for all employees")
    cash_drawer_required_roles: Optional[list[str]] = Field(None, description="Roles that require cash drawer (e.g., ['FRONTDESK', 'HOUSEKEEPING'])")
    cash_drawer_currency: Optional[str] = Field(None, max_length=10, description="Currency code (e.g., USD)")
    cash_drawer_starting_amount_cents: Optional[int] = Field(None, ge=0, description="Default starting cash amount in cents (e.g., 10000 = $100.00)")
    cash_drawer_variance_threshold_cents: Optional[int] = Field(None, ge=0, description="Variance threshold in cents (e.g., 2000 = $20.00)")
    cash_drawer_allow_edit: Optional[bool] = Field(None, description="Allow editing cash drawer sessions")
    cash_drawer_require_manager_review: Optional[bool] = Field(None, description="Require manager review for variances")
    schedule_day_start_hour: Optional[int] = Field(None, ge=0, le=23, description="Hour (0-23) when the schedule day starts (e.g. 7 = 7 AM)")
    schedule_day_end_hour: Optional[int] = Field(None, ge=0, le=23, description="Hour (0-23) when the schedule day ends (e.g. 7 = 7 AM next day; same as start = 24h day)")
    shift_notes_enabled: Optional[bool] = Field(None, description="Enable shift notepad / common log")
    shift_notes_required_on_clock_out: Optional[bool] = Field(None, description="Require shift note before clock out")
    shift_notes_allow_edit_after_clock_out: Optional[bool] = Field(None, description="Allow editing shift note after clock out")
    email_verification_required: Optional[bool] = Field(None, description="If False, users in this company can use the app without email verification")
    geofence_enabled: Optional[bool] = Field(None, description="Require employees to be within office radius to punch in/out")
    office_latitude: Optional[float] = Field(None, ge=-90, le=90, description="Office location latitude")
    office_longitude: Optional[float] = Field(None, ge=-180, le=180, description="Office location longitude")
    geofence_radius_meters: Optional[int] = Field(None, ge=10, le=5000, description="Allowed radius in meters (e.g. 100)")
    kiosk_network_restriction_enabled: Optional[bool] = Field(None, description="Restrict kiosk to office network only (IP allowlist)")
    kiosk_allowed_ips: Optional[List[str]] = Field(None, description="Allowed IPs or CIDR ranges (e.g. ['192.168.1.0/24', '10.0.0.1'])")


class CompanyNameUpdate(BaseModel):
    """Update company name."""
    name: str = Field(..., min_length=1, max_length=255)

