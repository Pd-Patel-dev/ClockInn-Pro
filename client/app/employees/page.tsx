'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import logger from '@/lib/logger'
import { useDebounce } from '@/hooks/useDebounce'
import { TableSkeleton } from '@/components/LoadingSkeleton'
import { EmployeeRow } from '@/components/EmployeeRow'
import { useToast } from '@/components/Toast'
import ConfirmationDialog from '@/components/ConfirmationDialog'

interface Employee {
  id: string
  name: string
  email: string
  role: string
  status: 'active' | 'inactive'
  has_pin: boolean
  pay_rate: number | null
  preferred_name?: string | null
  phone?: string | null
  job_role?: string | null
  created_at: string
  last_login_at: string | null
  last_punch_at: string | null
  is_clocked_in: boolean | null
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export default function AdminEmployeesPage() {
  const router = useRouter()
  const toast = useToast()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [deletingEmployee, setDeletingEmployee] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [employeeToDelete, setEmployeeToDelete] = useState<{ id: string; name: string } | null>(
    null
  )

  const debouncedSearchQuery = useDebounce(searchQuery, 300)

  useEffect(() => {
    const checkAdminAndFetch = async () => {
      try {
        const user = await getCurrentUser()
        if (!(user.permissions || []).includes('user_management')) {
          router.push('/dashboard')
          return
        }
        fetchEmployees()
      } catch {
        router.push('/login')
      }
    }
    checkAdminAndFetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const fetchEmployees = async () => {
    setLoading(true)
    try {
      const response = await api.get('/users/admin/employees')
      logger.debug('Employees data fetched', { count: response.data?.length })
      setEmployees(response.data || [])
    } catch (error: any) {
      logger.error('Failed to fetch employees', error as Error, {
        endpoint: '/users/admin/employees',
      })
      if (error.response?.status === 403) {
        router.push('/dashboard')
      }
    } finally {
      setLoading(false)
    }
  }

  const deleteEmployee = (employeeId: string, employeeName: string) => {
    setEmployeeToDelete({ id: employeeId, name: employeeName })
    setShowDeleteConfirm(true)
  }

  const confirmDeleteEmployee = async () => {
    if (!employeeToDelete) return
    setShowDeleteConfirm(false)
    const { id } = employeeToDelete
    setEmployeeToDelete(null)

    setDeletingEmployee(id)
    try {
      await api.delete(`/users/admin/employees/${id}`)
      toast.success('Employee deleted successfully!')
      fetchEmployees()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to delete employee')
    } finally {
      setDeletingEmployee(null)
    }
  }

  const stats = useMemo(() => {
    const active = employees.filter((e) => e.status === 'active').length
    const onShift = employees.filter((e) => e.is_clocked_in).length
    return {
      total: employees.length,
      active,
      inactive: employees.length - active,
      onShift,
    }
  }, [employees])

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      if (statusFilter !== 'all' && emp.status !== statusFilter) {
        return false
      }

      if (debouncedSearchQuery.trim()) {
        const query = debouncedSearchQuery.toLowerCase()
        return (
          emp.name.toLowerCase().includes(query) ||
          emp.email.toLowerCase().includes(query) ||
          (emp.preferred_name || '').toLowerCase().includes(query) ||
          (emp.job_role || '').toLowerCase().includes(query)
        )
      }

      return true
    })
  }, [employees, statusFilter, debouncedSearchQuery])

  return (
    <Layout>
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-4 h-52 overflow-hidden"
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(15,23,42,0.06),_transparent_65%)]" />
          <div
            className="absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgb(226 232 240 / 0.55) 1px, transparent 1px), linear-gradient(to bottom, rgb(226 232 240 / 0.55) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
              maskImage: 'linear-gradient(to bottom, black, transparent)',
            }}
          />
        </div>

        <div className="relative space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                Team
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
                Employees
              </h1>
              <p className="mt-1.5 text-sm text-slate-500 max-w-lg">
                Manage team members, roles, and access across your property.
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push('/employees/create')}
              className="shrink-0 inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Add employee
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Total" value={stats.total} hint="All team members" />
            <StatCard label="Active" value={stats.active} hint="Can clock in" />
            <StatCard label="On shift" value={stats.onShift} hint="Clocked in now" />
            <StatCard label="Inactive" value={stats.inactive} hint="Disabled accounts" />
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z"
                />
              </svg>
              <input
                type="search"
                placeholder="Search name, email, or title…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
                aria-label="Search employees"
              />
            </div>
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              {(['all', 'active', 'inactive'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStatusFilter(f)}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === f
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Inactive'}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <TableSkeleton rows={6} columns={8} />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Directory</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {filteredEmployees.length}{' '}
                    {filteredEmployees.length === 1 ? 'person' : 'people'}
                    {statusFilter !== 'all' || debouncedSearchQuery.trim()
                      ? ' matching filters'
                      : ''}
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80">
                      <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Employee
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Role
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Status
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Clock
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        PIN
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Pay
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Last punch
                      </th>
                      <th className="px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-16">
                          <div className="flex flex-col items-center justify-center text-center">
                            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                              <svg
                                className="w-6 h-6 text-slate-400"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                                />
                              </svg>
                            </div>
                            <p className="text-sm font-semibold text-slate-800">No employees found</p>
                            <p className="text-sm text-slate-400 mt-1">
                              Try adjusting search or filters
                            </p>
                            <button
                              type="button"
                              onClick={() => router.push('/employees/create')}
                              className="mt-4 text-sm font-semibold text-slate-900 hover:underline"
                            >
                              Add your first employee
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredEmployees.map((employee) => (
                        <EmployeeRow
                          key={employee.id}
                          employee={employee}
                          onEdit={(emp) => router.push(`/employees/${emp.id}?edit=1`)}
                          onDelete={deleteEmployee}
                          deletingEmployee={deletingEmployee}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <ConfirmationDialog
            isOpen={showDeleteConfirm}
            title="Delete Employee"
            message={
              employeeToDelete
                ? `Are you sure you want to delete ${employeeToDelete.name}? This action cannot be undone and will delete all associated time entries, leave requests, and sessions.`
                : ''
            }
            confirmText="Delete"
            cancelText="Cancel"
            type="warning"
            onConfirm={confirmDeleteEmployee}
            onCancel={() => {
              setShowDeleteConfirm(false)
              setEmployeeToDelete(null)
            }}
          />
        </div>
      </div>
    </Layout>
  )
}
