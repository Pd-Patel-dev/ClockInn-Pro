'use client'

import React from 'react'
import { useRouter } from 'next/navigation'

interface Employee {
  id: string
  name: string
  email: string
  role: string
  status: 'active' | 'inactive'
  has_pin: boolean
  pay_rate: number | null
  preferred_name?: string | null
  job_role?: string | null
  created_at: string
  last_login_at: string | null
  last_punch_at: string | null
  is_clocked_in: boolean | null
}

interface EmployeeRowProps {
  employee: Employee
  onEdit: (employee: Employee) => void
  onDelete: (id: string, name: string) => void
  deletingEmployee: string | null
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  MAINTENANCE: 'Maintenance',
  FRONTDESK: 'Front Desk',
  HOUSEKEEPING: 'Housekeeping',
  RESTAURANT: 'Restaurant',
  SECURITY: 'Security',
}

function roleLabel(role: string) {
  return ROLE_LABELS[role] || role
}

export const EmployeeRow = React.memo<EmployeeRowProps>(
  ({ employee, onEdit, onDelete, deletingEmployee }) => {
    const router = useRouter()
    const initial = (employee.preferred_name || employee.name).charAt(0).toUpperCase()

    const handleRowClick = (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return
      router.push(`/employees/${employee.id}`)
    }

    return (
      <tr
        onClick={handleRowClick}
        className="group border-b border-slate-100 last:border-0 hover:bg-slate-50/80 transition-colors cursor-pointer"
      >
        <td className="px-5 py-3.5 align-middle text-left">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex-shrink-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-xs font-semibold text-white tracking-tight shadow-sm">
                {initial}
              </div>
              {employee.is_clocked_in && (
                <span
                  className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-white"
                  title="On shift"
                />
              )}
            </div>
            <div className="min-w-0 text-left">
              <p className="text-sm font-semibold text-slate-900 truncate group-hover:text-slate-950">
                {employee.name}
              </p>
              <p className="text-xs text-slate-500 truncate mt-0.5">
                {employee.preferred_name ? `${employee.preferred_name} · ` : ''}
                {employee.email}
              </p>
            </div>
          </div>
        </td>
        <td className="px-4 py-3.5 align-middle text-center">
          <span className="inline-flex text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200/80">
            {roleLabel(employee.role)}
          </span>
        </td>
        <td className="px-4 py-3.5 align-middle text-center">
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-md ring-1 ring-inset ${
              employee.status === 'active'
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/80'
                : 'bg-slate-50 text-slate-600 ring-slate-200'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                employee.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
            {employee.status === 'active' ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td className="px-4 py-3.5 align-middle text-center">
          {employee.is_clocked_in ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200/80">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              On shift
            </span>
          ) : (
            <span className="text-xs text-slate-400">Off</span>
          )}
        </td>
        <td className="px-4 py-3.5 align-middle text-center">
          <span
            className={`text-xs font-medium ${
              employee.has_pin ? 'text-slate-700' : 'text-slate-400'
            }`}
          >
            {employee.has_pin ? 'Set' : '—'}
          </span>
        </td>
        <td className="px-4 py-3.5 align-middle text-center text-sm font-medium text-slate-800 tabular-nums">
          {employee.pay_rate != null ? `$${employee.pay_rate.toFixed(2)}` : '—'}
        </td>
        <td className="px-4 py-3.5 align-middle text-center text-xs text-slate-500">
          {employee.last_punch_at
            ? new Date(employee.last_punch_at).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'Never'}
        </td>
        <td className="px-5 py-3.5 align-middle text-center">
          <div className="inline-flex justify-center gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(employee)
              }}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-white hover:shadow-sm border border-transparent hover:border-slate-200 transition-all"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(employee.id, employee.name)
              }}
              disabled={deletingEmployee === employee.id}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 transition-all disabled:opacity-50"
            >
              {deletingEmployee === employee.id ? '…' : 'Delete'}
            </button>
          </div>
        </td>
      </tr>
    )
  },
  (prevProps, nextProps) => {
    return (
      prevProps.employee.id === nextProps.employee.id &&
      prevProps.employee.name === nextProps.employee.name &&
      prevProps.employee.email === nextProps.employee.email &&
      prevProps.employee.preferred_name === nextProps.employee.preferred_name &&
      prevProps.employee.role === nextProps.employee.role &&
      prevProps.employee.status === nextProps.employee.status &&
      prevProps.employee.has_pin === nextProps.employee.has_pin &&
      prevProps.employee.pay_rate === nextProps.employee.pay_rate &&
      prevProps.employee.last_punch_at === nextProps.employee.last_punch_at &&
      prevProps.employee.is_clocked_in === nextProps.employee.is_clocked_in &&
      prevProps.deletingEmployee === nextProps.deletingEmployee
    )
  }
)

EmployeeRow.displayName = 'EmployeeRow'
