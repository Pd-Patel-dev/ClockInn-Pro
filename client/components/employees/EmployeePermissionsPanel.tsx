'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import logger from '@/lib/logger'

type CatalogItem = {
  key: string
  label: string
  description: string
  role_default: boolean
  can_assign: boolean
}

type PermissionView = {
  user_id: string
  role: string
  role_defaults: string[]
  grants: string[]
  denies: string[]
  effective: string[]
  catalog: CatalogItem[]
  locked: boolean
  punch_role_allowed?: boolean
}

type Mode = 'inherit' | 'grant' | 'deny'

export default function EmployeePermissionsPanel({ employeeId }: { employeeId: string }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<PermissionView | null>(null)
  const [modes, setModes] = useState<Record<string, Mode>>({})

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get(`/users/admin/employees/${employeeId}/permissions`)
      const data = res.data as PermissionView
      setView(data)
      const next: Record<string, Mode> = {}
      for (const item of data.catalog) {
        if (data.grants.includes(item.key)) next[item.key] = 'grant'
        else if (data.denies.includes(item.key)) next[item.key] = 'deny'
        else next[item.key] = 'inherit'
      }
      setModes(next)
    } catch (error: any) {
      logger.error('Failed to load employee permissions', error as Error)
      toast.error(error.response?.data?.detail || 'Failed to load permissions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId])

  const dirty = useMemo(() => {
    if (!view) return false
    const grants = Object.entries(modes)
      .filter(([, m]) => m === 'grant')
      .map(([k]) => k)
      .sort()
    const denies = Object.entries(modes)
      .filter(([, m]) => m === 'deny')
      .map(([k]) => k)
      .sort()
    return (
      JSON.stringify(grants) !== JSON.stringify([...view.grants].sort()) ||
      JSON.stringify(denies) !== JSON.stringify([...view.denies].sort())
    )
  }, [modes, view])

  const save = async () => {
    if (!view) return
    setSaving(true)
    try {
      const grants = Object.entries(modes)
        .filter(([, m]) => m === 'grant')
        .map(([k]) => k)
      const denies = Object.entries(modes)
        .filter(([, m]) => m === 'deny')
        .map(([k]) => k)
      const res = await api.put(`/users/admin/employees/${employeeId}/permissions`, {
        grants,
        denies,
      })
      const data = res.data as PermissionView
      setView(data)
      const next: Record<string, Mode> = {}
      for (const item of data.catalog) {
        if (data.grants.includes(item.key)) next[item.key] = 'grant'
        else if (data.denies.includes(item.key)) next[item.key] = 'deny'
        else next[item.key] = 'inherit'
      }
      setModes(next)
      toast.success('Permissions updated')
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to save permissions')
    } finally {
      setSaving(false)
    }
  }

  const resetToRole = () => {
    if (!view) return
    const next: Record<string, Mode> = {}
    for (const item of view.catalog) next[item.key] = 'inherit'
    setModes(next)
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <div className="h-5 w-40 animate-pulse rounded bg-slate-100" />
        <div className="mt-4 space-y-2">
          <div className="h-12 animate-pulse rounded-lg bg-slate-50" />
          <div className="h-12 animate-pulse rounded-lg bg-slate-50" />
        </div>
      </div>
    )
  }

  if (!view) return null

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Access permissions</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Role defaults plus optional grants or denies for this employee only.
            Employees cannot edit these.
          </p>
        </div>
        {!view.locked && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetToRole}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Reset to role
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save permissions'}
            </button>
          </div>
        )}
      </div>

      {view.locked ? (
        <p className="px-5 py-6 text-sm text-slate-500 sm:px-6">
          Admin and Developer accounts always keep full access. Overrides are not available.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {view.catalog.map((item) => {
            const mode = modes[item.key] || 'inherit'
            const disabled = !item.can_assign && mode === 'inherit'
            return (
              <li
                key={item.key}
                className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">{item.label}</p>
                    {item.role_default && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        In role
                      </span>
                    )}
                    {mode === 'grant' && (
                      <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                        Granted
                      </span>
                    )}
                    {mode === 'deny' && (
                      <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">
                        Denied
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
                  {item.key === 'clock' && view.punch_role_allowed === false && mode !== 'grant' && (
                    <p className="mt-1 text-xs text-amber-800">
                      This role is unchecked in Settings → Payroll → Punch In / Out access, so
                      they cannot clock in until you Grant Clock in / out here or check the role
                      there.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 rounded-lg border border-slate-200 p-0.5">
                  {(['inherit', 'grant', 'deny'] as Mode[]).map((m) => {
                    const lockedOut = !item.can_assign && m !== 'inherit' && mode !== m
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={lockedOut || (disabled && m !== 'inherit')}
                        onClick={() => setModes((prev) => ({ ...prev, [item.key]: m }))}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors disabled:opacity-40 ${
                          mode === m
                            ? m === 'deny'
                              ? 'bg-red-600 text-white'
                              : m === 'grant'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-900 text-white'
                            : 'text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        {m === 'inherit' ? 'Role' : m}
                      </button>
                    )
                  })}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
