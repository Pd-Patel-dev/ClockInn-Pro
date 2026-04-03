'use client'

import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import { getCurrentUser, User } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { format } from 'date-fns'
import logger from '@/lib/logger'
import type { ShiftNoteListItemType } from '@/lib/shiftNotes'
import { formatDateTimeForDisplay } from '@/lib/time'

interface Employee {
  id: string
  name: string
  email: string
  status: string
  last_punch_at: string | null
  is_clocked_in: boolean | null
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [totalEmployees, setTotalEmployees] = useState(0)
  const [activeToday, setActiveToday] = useState(0)
  const [pendingLeave, setPendingLeave] = useState(0)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loadingStats, setLoadingStats] = useState(true)
  const [shiftNotes, setShiftNotes] = useState<ShiftNoteListItemType[]>([])
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [shiftNotesFeatureEnabled, setShiftNotesFeatureEnabled] = useState(true)

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const currentUser = await getCurrentUser()
        setUser(currentUser)
        if (currentUser.role === 'ADMIN') {
          fetchStats()
        }
        fetchNotes(currentUser)
      } catch (error) {
        router.push('/login')
      } finally {
        setLoading(false)
      }
    }
    async function fetchNotes(_u: User) {
      setLoadingNotes(true)
      try {
        const info = await api.get('/company/info')
        const enabled = info.data?.settings?.shift_notes_enabled !== false
        setShiftNotesFeatureEnabled(enabled)
        if (!enabled) {
          setShiftNotes([])
          return
        }
        const res = await api.get('/shift-notes/common?limit=25&sort_by=clock_in_at&order=desc')
        const data = res.data as { items?: ShiftNoteListItemType[]; total?: number }
        setShiftNotes(data.items ?? [])
      } catch {
        setShiftNotes([])
      } finally {
        setLoadingNotes(false)
      }
    }
    fetchUser()
  }, [router])

  const fetchStats = async () => {
    setLoadingStats(true)
    try {
      const employeesResponse = await api.get('/users/admin/employees?limit=1000')
      const employeesList = employeesResponse.data || []
      setTotalEmployees(employeesList.length)

      const activeCount = employeesList.filter((emp: Employee) => emp.is_clocked_in === true).length
      setActiveToday(activeCount)

      setEmployees(employeesList.slice(0, 10))

      try {
        const leaveResponse = await api.get('/leave/admin/leave?status=pending&limit=1')
        setPendingLeave(leaveResponse.data?.total || 0)
      } catch (error) {
        setPendingLeave(0)
      }
    } catch (error: any) {
      logger.error('Failed to fetch dashboard stats', error as Error, { endpoint: 'dashboard' })
    } finally {
      setLoadingStats(false)
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="min-h-[40vh] flex items-center justify-center" role="status" aria-label="Loading">
          <div className="animate-pulse space-y-3 w-full max-w-md mx-auto px-4">
            <div className="h-8 bg-slate-200 rounded-lg w-2/3" />
            <div className="h-4 bg-slate-200 rounded-lg w-1/2" />
            <div className="h-32 bg-slate-200 rounded-xl mt-6" />
          </div>
        </div>
      </Layout>
    )
  }

  if (!user) {
    return null
  }

  const isEmployee = ['MAINTENANCE', 'FRONTDESK', 'HOUSEKEEPING'].includes(user.role)
  const isAdmin = user.role === 'ADMIN'

  const employeeQuickActions = [
    { title: 'Punch In/Out', description: 'Clock in or out for your shift', href: '/punch-in-out' },
    { title: 'Time Logs', description: 'View your time entries', href: '/logs' },
    { title: 'Leave Requests', description: 'Request time off', href: '/leave' },
  ]

  const adminQuickActions = [
    { title: 'Employees', description: 'Manage your team', href: '/employees' },
    { title: 'Schedules', description: 'Manage shift schedules', href: '/schedules' },
    { title: 'Time Entries', description: 'View all time entries', href: '/time-entries' },
    { title: 'Payroll', description: 'Generate payroll', href: '/payroll' },
    { title: 'Leave Requests', description: 'Review leave requests', href: '/leave-requests' },
    { title: 'Reports', description: 'Generate reports', href: '/reports' },
    { title: 'Settings', description: 'Company settings', href: '/settings' },
  ]

  const quickActions = isEmployee ? employeeQuickActions : adminQuickActions

  const formatLastPunch = (lastPunchAt: string | null) => {
    if (!lastPunchAt) return 'Never'
    const date = new Date(lastPunchAt)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} min ago`
    if (diffHours < 24) return `${diffHours} hr ago`
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return format(date, 'MMM dd, yyyy HH:mm')
  }

  const greeting = getGreeting()

  return (
    <Layout>
      <div className="space-y-6">
        <div className="mb-6">
          <p className="text-sm text-slate-500">
            {greeting}, {user.name}
          </p>
          <h1 className="text-2xl font-semibold text-slate-900 mt-1">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isAdmin ? 'Manage your team and track attendance.' : 'Track your time and manage your schedule.'}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <span>
              Role: <span className="font-medium text-slate-900">{user.role}</span>
            </span>
            <span className="text-slate-300">·</span>
            <span>
              Company: <span className="font-medium text-slate-900">{user.company_name}</span>
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {user.email_verified && !user.verification_required ? (
              <span className="inline-flex bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium px-2.5 py-0.5 rounded-full">
                Email verified
              </span>
            ) : (
              <span className="inline-flex bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium px-2.5 py-0.5 rounded-full">
                Email not verified
              </span>
            )}
          </div>
        </div>

        {isAdmin && !shiftNotesFeatureEnabled && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden border-l-4 border-l-slate-600">
            <div className="p-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Shift log</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Shift notes are turned off for employees, but you can still open the full shift log (time entries,
                  cash drawer, and any saved notes).
                </p>
              </div>
              <Link
                href="/admin/shift-log"
                className="inline-flex shrink-0 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Open shift log →
              </Link>
            </div>
          </div>
        )}

        {shiftNotesFeatureEnabled && (
          <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Shift notes</h2>
                <p className="text-sm text-slate-500 mt-0.5">Recent notes from your team</p>
              </div>
              <Link
                href={isAdmin ? '/admin/shift-log' : '/my/shift-notepad'}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 shrink-0"
              >
                {isAdmin ? 'View shift log' : 'My shift notepad'}
              </Link>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden min-h-[200px] border-l-4 border-l-blue-600">
              <div className="p-6">
                {loadingNotes ? (
                  <div className="animate-pulse space-y-4 py-4" role="status" aria-label="Loading notes">
                    <div className="h-4 bg-slate-200 rounded w-full" />
                    <div className="h-4 bg-slate-200 rounded w-5/6" />
                    <div className="h-4 bg-slate-200 rounded w-4/6" />
                  </div>
                ) : shiftNotes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                      <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-slate-700">No shift notes yet</p>
                    <p className="text-sm text-slate-400 mt-1">Notes from shifts will show up here</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {shiftNotes.map((note) => {
                      const timeStr = formatDateTimeForDisplay(note.clock_in_at ?? note.updated_at, '—')
                      return (
                        <div key={note.id} className="border-b border-slate-100 pb-5 last:border-0 last:pb-0">
                          <p className="text-slate-800 text-sm leading-relaxed whitespace-pre-wrap">{note.preview || '—'}</p>
                          <p className="mt-2 text-right text-xs text-slate-500">
                            {note.employee_name} · {timeStr}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {isAdmin && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Total employees</p>
                {loadingStats ? (
                  <div className="mt-2 h-9 w-20 bg-slate-200 rounded-lg animate-pulse" />
                ) : (
                  <p className="mt-2 text-3xl font-semibold text-slate-900">{totalEmployees}</p>
                )}
                <p className="mt-1 text-sm text-slate-400">All accounts</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Active today</p>
                {loadingStats ? (
                  <div className="mt-2 h-9 w-20 bg-slate-200 rounded-lg animate-pulse" />
                ) : (
                  <p className="mt-2 text-3xl font-semibold text-slate-900">{activeToday}</p>
                )}
                <p className="mt-1 text-sm text-slate-400">Currently clocked in</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Pending leave</p>
                {loadingStats ? (
                  <div className="mt-2 h-9 w-20 bg-slate-200 rounded-lg animate-pulse" />
                ) : (
                  <p className="mt-2 text-3xl font-semibold text-slate-900">{pendingLeave}</p>
                )}
                <p className="mt-1 text-sm text-slate-400">Awaiting review</p>
              </div>
            </div>

            <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm bg-white">
              <div className="p-6 border-b border-slate-200 flex justify-between items-center gap-4">
                <h2 className="text-lg font-semibold text-slate-900">Recent employees</h2>
                <Link href="/employees" className="text-sm font-medium text-blue-600 hover:text-blue-700 shrink-0">
                  View all
                </Link>
              </div>
              {loadingStats ? (
                <div className="p-8 animate-pulse space-y-3" role="status" aria-label="Loading employees">
                  <div className="h-10 bg-slate-100 rounded-lg" />
                  <div className="h-10 bg-slate-100 rounded-lg" />
                  <div className="h-10 bg-slate-100 rounded-lg" />
                </div>
              ) : employees.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-slate-700">No employees yet</p>
                  <p className="text-sm text-slate-400 mt-1">Add employees from the Employees page</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Employee</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Punch</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Last punch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((employee) => (
                        <tr
                          key={employee.id}
                          onClick={() => router.push(`/employees/${employee.id}`)}
                          className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer last:border-0"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center min-w-0">
                              <div className="flex-shrink-0 h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 text-sm font-medium">
                                {employee.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="ml-3 min-w-0">
                                <div className="font-medium text-slate-900 truncate">{employee.name}</div>
                                <div className="text-slate-500 truncate">{employee.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`inline-flex text-xs font-medium px-2.5 py-0.5 rounded-full border ${
                                employee.status === 'active'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}
                            >
                              {employee.status
                                ? employee.status.charAt(0).toUpperCase() + employee.status.slice(1).toLowerCase()
                                : employee.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {employee.is_clocked_in ? (
                              <span className="inline-flex bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium px-2.5 py-0.5 rounded-full">
                                Clocked in
                              </span>
                            ) : (
                              <span className="inline-flex bg-slate-100 text-slate-600 border border-slate-200 text-xs font-medium px-2.5 py-0.5 rounded-full">
                                Clocked out
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{formatLastPunch(employee.last_punch_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        <div>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Quick actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {quickActions.map((action, index) => (
              <Link
                key={index}
                href={action.href}
                className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                <h3 className="text-base font-medium text-slate-900 mb-1">{action.title}</h3>
                <p className="text-sm text-slate-600 leading-snug">{action.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  )
}
