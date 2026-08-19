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
    },
    UserRole.FRONTDESK: {
        "clock",
        "schedule",
        "leave",
        "cash_drawer",
    },
    UserRole.HOUSEKEEPING: {
        "clock",
        "schedule",
        "leave",
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
    },
}


def has_permission(role: UserRole, feature: str) -> bool:
    return feature in ROLE_PERMISSIONS.get(role, set())
