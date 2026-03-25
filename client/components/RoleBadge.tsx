const ROLE_STYLES: Record<string, string> = {
  ADMIN: 'bg-gray-900 text-white',
  MANAGER: 'bg-gray-700 text-white',
  FRONTDESK: 'bg-blue-50 text-blue-700',
  HOUSEKEEPING: 'bg-emerald-50 text-emerald-700',
  MAINTENANCE: 'bg-orange-50 text-orange-700',
  RESTAURANT: 'bg-purple-50 text-purple-700',
  SECURITY: 'bg-red-50 text-red-700',
  DEVELOPER: 'bg-slate-800 text-white',
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  FRONTDESK: 'Front Desk',
  HOUSEKEEPING: 'Housekeeping',
  MAINTENANCE: 'Maintenance',
  RESTAURANT: 'Restaurant',
  SECURITY: 'Security',
  DEVELOPER: 'Developer',
}

export function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
        ROLE_STYLES[role] ?? 'bg-gray-100 text-gray-600'
      }`}
    >
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}

