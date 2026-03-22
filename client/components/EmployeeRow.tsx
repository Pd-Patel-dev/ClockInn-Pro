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

const roleBadge = (role: string) => {
  if (role === 'ADMIN') {
    return 'bg-blue-50 text-blue-700 border border-blue-200'
  }
  return 'bg-slate-100 text-slate-600 border border-slate-200'
}

export const EmployeeRow = React.memo<EmployeeRowProps>(({ employee, onEdit, onDelete, deletingEmployee }) => {
  const router = useRouter()

  const handleRowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) {
      return
    }
    router.push(`/employees/${employee.id}`)
  }

  return (
    <tr
      onClick={handleRowClick}
      className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer last:border-0"
    >
      <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-700">{employee.name}</td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-700">{employee.email}</td>
      <td className="px-4 py-3 whitespace-nowrap text-sm">
        <span
          className={`inline-flex text-xs font-medium px-2.5 py-0.5 rounded-full ${roleBadge(employee.role)}`}
        >
          {employee.role === 'ADMIN'
            ? 'Admin'
            : employee.role === 'MAINTENANCE'
              ? 'Maintenance'
              : employee.role === 'FRONTDESK'
                ? 'Front Desk'
                : employee.role === 'HOUSEKEEPING'
                  ? 'Housekeeping'
                  : employee.role}
        </span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm">
        <span
          className={`inline-flex text-xs font-medium px-2.5 py-0.5 rounded-full border ${
            employee.status === 'active'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-red-50 text-red-600 border-red-200'
          }`}
        >
          {employee.status === 'active' ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm">
        {employee.is_clocked_in !== null ? (
          <span
            className={`inline-flex text-xs font-medium px-2.5 py-0.5 rounded-full border ${
              employee.is_clocked_in
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}
          >
            {employee.is_clocked_in ? 'In' : 'Out'}
          </span>
        ) : (
          <span className="inline-flex text-xs font-medium px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
            —
          </span>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-700">{employee.has_pin ? 'Yes' : 'No'}</td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-700">
        {employee.pay_rate ? `$${employee.pay_rate.toFixed(2)}` : '—'}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-700">
        {employee.created_at
          ? new Date(employee.created_at).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })
          : '—'}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-700">
        {employee.last_punch_at
          ? new Date(employee.last_punch_at).toLocaleString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'Never'}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onEdit(employee)
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
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
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deletingEmployee === employee.id ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </td>
    </tr>
  )
}, (prevProps, nextProps) => {
  return (
    prevProps.employee.id === nextProps.employee.id &&
    prevProps.employee.name === nextProps.employee.name &&
    prevProps.employee.status === nextProps.employee.status &&
    prevProps.employee.is_clocked_in === nextProps.employee.is_clocked_in &&
    prevProps.deletingEmployee === nextProps.deletingEmployee
  )
})

EmployeeRow.displayName = 'EmployeeRow'
