/** Employee roles that can punch by default (when company has not customized). */
export const DEFAULT_PUNCH_ALLOWED_ROLES = [
  'MAINTENANCE',
  'FRONTDESK',
  'HOUSEKEEPING',
  'RESTAURANT',
  'SECURITY',
  'MANAGER',
] as const

/** Roles allowed on the kiosk by default (same set as punch). */
export const DEFAULT_KIOSK_ALLOWED_ROLES = [...DEFAULT_PUNCH_ALLOWED_ROLES]

export const PUNCH_ROLE_OPTIONS = [
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'FRONTDESK', label: 'Front Desk' },
  { value: 'HOUSEKEEPING', label: 'Housekeeping' },
  { value: 'RESTAURANT', label: 'Restaurant' },
  { value: 'SECURITY', label: 'Security' },
  { value: 'MANAGER', label: 'Manager' },
] as const

/** Whether this employee type is allowed to use punch in/out. */
export function isPunchAllowed(
  role: string | null | undefined,
  punchAllowedRoles?: string[] | null,
): boolean {
  if (!role) return false
  const allowed =
    punchAllowedRoles == null ? [...DEFAULT_PUNCH_ALLOWED_ROLES] : punchAllowedRoles
  return allowed.includes(role)
}

/** Whether this employee type is allowed to use the company kiosk. */
export function isKioskAllowed(
  role: string | null | undefined,
  kioskAllowedRoles?: string[] | null,
): boolean {
  if (!role) return false
  const allowed =
    kioskAllowedRoles == null ? [...DEFAULT_KIOSK_ALLOWED_ROLES] : kioskAllowedRoles
  return allowed.includes(role)
}
