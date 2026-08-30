from __future__ import annotations

from app.models.user import UserRole

# Feature-level permissions used for UI and API authorization.
ROLE_PERMISSIONS: dict[UserRole, set[str]] = {
    UserRole.ADMIN: {
        "clock",
        "schedule",
        "schedule_edit",
        "payroll",
        "payroll_export",
        "cash_drawer",
        "leave",
        "reports",
        "common_log",
        "settings",
        "user_management",
        "housekeeping",
    },
    UserRole.MANAGER: {
        "clock",
        "schedule",
        "schedule_edit",
        "payroll",
        "payroll_export",
        "leave",
        "reports",
        "common_log",
        "user_management",
        "cash_drawer",
        "housekeeping",
    },
    UserRole.FRONTDESK: {
        "clock",
        "schedule",
        "leave",
        "cash_drawer",
        "housekeeping",
    },
    UserRole.HOUSEKEEPING: {
        "clock",
        "schedule",
        "leave",
        "housekeeping",
    },
    UserRole.MAINTENANCE: {
        "clock",
        "schedule",
        "leave",
    },
    UserRole.RESTAURANT: {
        "clock",
        "schedule",
        "leave",
        "cash_drawer",
    },
    UserRole.SECURITY: {
        "clock",
        "schedule",
        "leave",
    },
    # Keep developer unrestricted for internal tooling.
    UserRole.DEVELOPER: {
        "clock",
        "schedule",
        "schedule_edit",
        "payroll",
        "payroll_export",
        "cash_drawer",
        "leave",
        "reports",
        "common_log",
        "settings",
        "user_management",
        "housekeeping",
    },
}

# Catalog for employee override UI (labels shown to Admin/Manager).
FEATURE_PERMISSION_META: dict[str, dict[str, str]] = {
    "clock": {
        "label": "Clock in / out",
        "description": "Punch time from the portal or kiosk. If this role is unchecked under Settings → Punch In / Out access, Grant this to allow this person anyway.",
    },
    "schedule": {
        "label": "View schedules",
        "description": "See My Schedule and Schedules",
    },
    "schedule_edit": {
        "label": "Edit schedules",
        "description": "Create, edit, approve, and send shifts",
    },
    "leave": {
        "label": "Leave requests",
        "description": "Submit personal leave requests",
    },
    "cash_drawer": {
        "label": "Cash drawer",
        "description": "Use cash drawer / marketplace on punch",
    },
    "payroll": {
        "label": "Payroll",
        "description": "View and manage payroll runs",
    },
    "payroll_export": {
        "label": "Payroll export",
        "description": "Export payroll files",
    },
    "reports": {
        "label": "Reports",
        "description": "Run and download time reports",
    },
    "common_log": {
        "label": "Logs",
        "description": "Punch Log and Drawer Log",
    },
    "user_management": {
        "label": "Employees & leave review",
        "description": "Manage employees and approve leave",
    },
    "settings": {
        "label": "Company settings",
        "description": "Change company configuration (Admin only to grant)",
    },
    "housekeeping": {
        "label": "Housekeeping",
        "description": "Board, update room status, assign & print sheets (not room setup)",
    },
}

OVERRIDABLE_FEATURE_KEYS: frozenset[str] = frozenset(FEATURE_PERMISSION_META.keys())


def has_permission(role: UserRole, feature: str) -> bool:
    return feature in ROLE_PERMISSIONS.get(role, set())


def role_feature_permissions(role: UserRole) -> set[str]:
    return set(ROLE_PERMISSIONS.get(role, set()))
