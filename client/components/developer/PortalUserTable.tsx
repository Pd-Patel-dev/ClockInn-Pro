'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'

export type PortalUserRow = {
  id: string
  company_id: string | null
  company_name: string
  name: string
  email: string
  role: string
  status: string
  email_verified: boolean
  verification_required: boolean
  created_at: string
  last_login_at: string | null
}

export function PortalUserTable({
  rows,
  showCompany,
  emptyLabel,
  countLabel,
}: {
  rows: PortalUserRow[]
  showCompany: boolean
  emptyLabel: string
  countLabel: string
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-foreground-muted">{emptyLabel}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-border-subtle/50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase text-foreground-muted">Name</th>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase text-foreground-muted">Email</th>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase text-foreground-muted">Role</th>
            {showCompany && (
              <th className="px-4 py-2 text-left text-xs font-medium uppercase text-foreground-muted">Company</th>
            )}
            <th className="px-4 py-2 text-left text-xs font-medium uppercase text-foreground-muted">Status</th>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase text-foreground-muted">Verified</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {rows.map((u) => (
            <tr key={u.id} className="hover:bg-border-subtle/40">
              <td className="px-4 py-3">
                <Link href={`/developer/users/${u.id}`} className="font-medium text-accent hover:underline">
                  {u.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-sm text-foreground-muted">{u.email}</td>
              <td className="px-4 py-3 text-sm">
                <Badge variant={u.role === 'DEVELOPER' ? 'neutral' : 'info'}>{u.role}</Badge>
              </td>
              {showCompany && (
                <td className="px-4 py-3 text-sm text-foreground-muted">
                  {u.company_id ? (
                    <Link href={`/developer/companies/${u.company_id}`} className="text-accent hover:underline">
                      {u.company_name}
                    </Link>
                  ) : (
                    <span>{u.company_name || '—'}</span>
                  )}
                </td>
              )}
              <td className="px-4 py-3 text-sm capitalize text-foreground-muted">{u.status}</td>
              <td className="px-4 py-3 text-sm">
                {u.email_verified ? (
                  <span className="text-emerald-600 dark:text-emerald-400">Yes</span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">No</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-foreground-subtle">
        {rows.length} {countLabel}
      </p>
    </div>
  )
}
