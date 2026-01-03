'use client'

import React from 'react'
import { useRouter } from 'next/navigation'

interface Employee {
  id: string
  name: string
  email: string
  status: 'active' | 'inactive'
  has_pin: boolean
  job_role: string | null
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

export const EmployeeRow = React.memo<EmployeeRowProps>(({ employee, onEdit, onDelete, deletingEmployee }) => {
  const router = useRouter()

  const handleRowClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking on action buttons
    if ((e.target as HTMLElement).closest('button')) {
      return
    }
    router.push(`/employees/${employee.id}`)
  }

  return (
    <tr
      onClick={handleRowClick}
      className="hover:bg-gray-50 transition-colors cursor-pointer"
    >
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {employee.name}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {employee.email}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm">
        <span
          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
            employee.status === 'active'
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {employee.status === 'active' ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm">
        {employee.is_clocked_in !== null ? (
          <span
            className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
              employee.is_clocked_in
                ? 'bg-blue-100 text-blue-800'
                : 'bg-gray-100 text-gray-800'
            }`}
          >
            {employee.is_clocked_in ? 'In' : 'Out'}
          </span>
        ) : (
          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-500">
            -
          </span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {employee.has_pin ? 'Yes' : 'No'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {employee.job_role || '-'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {employee.pay_rate ? `$${employee.pay_rate.toFixed(2)}` : '-'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {employee.created_at
          ? new Date(employee.created_at).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })
          : '-'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
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
      <td className="px-6 py-4 whitespace-nowrap text-sm">
        <div className="flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onEdit(employee)
            }}
            className="px-3 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200"
          >
            Edit
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete(employee.id, employee.name)
            }}
            disabled={deletingEmployee === employee.id}
            className="px-3 py-1 rounded-md text-xs font-medium bg-red-100 text-red-800 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deletingEmployee === employee.id ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </td>
    </tr>
  )
}, (prevProps, nextProps) => {
  // Custom comparison function for React.memo
  return (
    prevProps.employee.id === nextProps.employee.id &&
    prevProps.employee.name === nextProps.employee.name &&
    prevProps.employee.status === nextProps.employee.status &&
    prevProps.employee.is_clocked_in === nextProps.employee.is_clocked_in &&
    prevProps.deletingEmployee === nextProps.deletingEmployee
  )
})

EmployeeRow.displayName = 'EmployeeRow'

