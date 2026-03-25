export interface NavItem {
  label: string
  href: string
  permission: string
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', permission: 'clock' },
  { label: 'Punch In/Out', href: '/punch-in-out', permission: 'clock' },
  { label: 'My Schedule', href: '/my-schedule', permission: 'schedule' },
  { label: 'Leave', href: '/leave', permission: 'leave' },
  { label: 'Shift Notepad', href: '/my/shift-notepad', permission: 'shift_notes' },
  { label: 'My Logs', href: '/logs', permission: 'clock' },
  { label: 'Employees', href: '/employees', permission: 'user_management' },
  { label: 'Leave Requests', href: '/leave-requests', permission: 'user_management' },
  { label: 'Roles & Permissions', href: '/roles', permission: 'user_management' },
  { label: 'Schedules', href: '/schedules', permission: 'schedule' },
  { label: 'Time Entries', href: '/time-entries', permission: 'schedule' },
  { label: 'Shift Log', href: '/admin/shift-log', permission: 'common_log' },
  { label: 'Payroll', href: '/payroll', permission: 'payroll' },
  { label: 'Reports', href: '/reports', permission: 'reports' },
  { label: 'Settings', href: '/settings', permission: 'settings' },
]

export const ROUTE_PERMISSIONS: Record<string, string> = {
  '/cash-drawer': 'cash_drawer',
  '/payroll': 'payroll',
  '/reports': 'reports',
  '/admin/shift-log': 'common_log',
  '/employees': 'user_management',
  '/leave-requests': 'user_management',
  '/roles': 'user_management',
  '/settings': 'settings',
}

