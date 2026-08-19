export interface NavItem {
  label: string
  href: string
  permission: string
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', permission: 'clock' },
  { label: 'My Schedule', href: '/my-schedule', permission: 'schedule' },
  { label: 'Leave', href: '/leave', permission: 'leave' },
  { label: 'My Logs', href: '/logs', permission: 'clock' },
  { label: 'Employees', href: '/employees', permission: 'user_management' },
  { label: 'Leave Requests', href: '/leave-requests', permission: 'user_management' },
  { label: 'Schedules', href: '/schedules', permission: 'schedule' },
  { label: 'Punch Log', href: '/admin/punch-log', permission: 'common_log' },
  { label: 'Drawer Log', href: '/admin/drawer-log', permission: 'common_log' },
  { label: 'Payroll', href: '/payroll', permission: 'payroll' },
  { label: 'Reports', href: '/reports', permission: 'reports' },
  { label: 'Settings', href: '/settings', permission: 'settings' },
]

export const ROUTE_PERMISSIONS: Record<string, string> = {
  '/cash-drawer': 'cash_drawer',
  '/payroll': 'payroll',
  '/reports': 'reports',
  '/admin/drawer-log': 'common_log',
  '/admin/punch-log': 'common_log',
  '/employees': 'user_management',
  '/leave-requests': 'user_management',
  '/settings': 'settings',
}
