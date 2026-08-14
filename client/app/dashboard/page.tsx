'use client'

import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import PunchInOutPanel from '@/components/PunchInOutPanel'
import { getCurrentUser, User } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { format } from 'date-fns'
import logger from '@/lib/logger'
import { isPunchAllowed } from '@/lib/punch'

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

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || fullName
}

function relativePunch(lastPunchAt: string | null) {
  if (!lastPunchAt) return 'No punches yet'
  const date = new Date(lastPunchAt)
  const now = new Date()
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return format(date, 'MMM d')
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
  const [canPunch, setCanPunch] = useState(false)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const currentUser = await getCurrentUser()
        setUser(currentUser)
        if (currentUser.role === 'DEVELOPER') {
          router.replace('/developer')
          return
        }
        if (currentUser.role === 'ADMIN') {
          fetchStats()
        }
        try {
          const companyRes = await api.get('/company/info')
          const roles = companyRes.data?.settings?.punch_allowed_roles as string[] | undefined
          setCanPunch(isPunchAllowed(currentUser.role, roles))
        } catch {
          setCanPunch(isPunchAllowed(currentUser.role, null))
        }
      } catch {
        router.push('/login')
      } finally {
        setLoading(false)
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
      setActiveToday(employeesList.filter((emp: Employee) => emp.is_clocked_in === true).length)
      setEmployees(employeesList.slice(0, 8))

      try {
        const leaveResponse = await api.get('/leave/admin/leave?status=pending&limit=1')
        setPendingLeave(leaveResponse.data?.total || 0)
      } catch {
        setPendingLeave(0)
      }
    } catch (error: unknown) {
      logger.error('Failed to fetch dashboard stats', error as Error, { endpoint: 'dashboard' })
    } finally {
      setLoadingStats(false)
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="min-h-[50vh] flex items-center justify-center" role="status" aria-label="Loading">
          <div className="w-full max-w-lg space-y-4 animate-pulse px-2">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="h-10 w-2/3 rounded-lg bg-slate-200" />
            <div className="h-40 rounded-2xl bg-slate-100" />
          </div>
        </div>
      </Layout>
    )
  }

  if (!user) return null

  const isAdmin = user.role === 'ADMIN'
  const displayName = user.preferred_name?.trim() || firstName(user.name)

  return (
    <Layout>
      <div className="mx-auto max-w-5xl space-y-10">
        {/* Hero */}
        <header className="dashboard-reveal">
          <p className="text-sm font-medium tracking-wide text-slate-500">
            {format(now, 'EEEE · MMM d')}
            <span className="mx-2 text-slate-300">·</span>
            <span className="tabular-nums text-slate-600">{format(now, 'h:mm:ss a')}</span>
          </p>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            {getGreeting()}, {displayName}
          </h1>
          <p className="mt-2 max-w-md text-base text-slate-500">
            {canPunch
              ? 'Ready when you are — clock in and keep your day on track.'
              : isAdmin
                ? user.company_name
                  ? `Here’s how ${user.company_name} is doing today.`
                  : 'Here’s how your team is doing today.'
                : 'Your workspace for schedules, leave, and day-to-day work.'}
          </p>
        </header>

        {canPunch && (
          <section className="dashboard-reveal dashboard-reveal-delay-1">
            <PunchInOutPanel user={user} compact />
          </section>
        )}

          {isAdmin && (
            <>
              {/* At a glance — numbers, not card grid */}
              <section className="dashboard-reveal dashboard-reveal-delay-2">
                <div className="flex flex-wrap items-end gap-x-10 gap-y-6 border-y border-slate-200/80 py-8">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Team</p>
                    {loadingStats ? (
                      <div className="mt-2 h-10 w-16 animate-pulse rounded bg-slate-200" />
                    ) : (
                      <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-slate-900">
                        {totalEmployees}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Clocked in</p>
                    {loadingStats ? (
                      <div className="mt-2 h-10 w-16 animate-pulse rounded bg-slate-200" />
                    ) : (
                      <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-emerald-600">
                        {activeToday}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Leave waiting</p>
                    {loadingStats ? (
                      <div className="mt-2 h-10 w-16 animate-pulse rounded bg-slate-200" />
                    ) : (
                      <p
                        className={`mt-1 text-4xl font-semibold tabular-nums tracking-tight ${
                          pendingLeave > 0 ? 'text-amber-600' : 'text-slate-900'
                        }`}
                      >
                        {pendingLeave}
                      </p>
                    )}
                  </div>
                  {pendingLeave > 0 && (
                    <Link
                      href="/leave-requests"
                      className="ml-auto self-center text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
                    >
                      Review leave →
                    </Link>
                  )}
                </div>
              </section>

              {/* Team list */}
              <section className="dashboard-reveal dashboard-reveal-delay-3">
                <div className="mb-4 flex items-baseline justify-between gap-4">
                  <h2 className="text-lg font-semibold text-slate-900">Who’s on</h2>
                  <Link
                    href="/employees"
                    className="text-sm font-medium text-slate-500 transition-colors hover:text-blue-600"
                  >
                    All employees
                  </Link>
                </div>

                {loadingStats ? (
                  <div className="space-y-3" role="status" aria-label="Loading employees">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-14 animate-pulse rounded-xl bg-white" />
                    ))}
                  </div>
                ) : employees.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
                    <p className="text-sm font-medium text-slate-700">No employees yet</p>
                    <p className="mt-1 text-sm text-slate-400">Add your first team member to get started.</p>
                    <Link
                      href="/employees"
                      className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
                    >
                      Go to Employees →
                    </Link>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                    {employees.map((employee) => (
                      <li key={employee.id}>
                        <button
                          type="button"
                          onClick={() => router.push(`/employees/${employee.id}`)}
                          className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-slate-50/90 focus:outline-none focus-visible:bg-slate-50 sm:px-5"
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-700">
                            {employee.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-slate-900">{employee.name}</p>
                            <p className="truncate text-sm text-slate-400">{relativePunch(employee.last_punch_at)}</p>
                          </div>
                          <span
                            className={`shrink-0 text-xs font-medium ${
                              employee.is_clocked_in ? 'text-emerald-600' : 'text-slate-400'
                            }`}
                          >
                            {employee.is_clocked_in ? 'In' : 'Out'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {!canPunch && !isAdmin && (
            <section className="dashboard-reveal dashboard-reveal-delay-1">
              <div className="rounded-2xl border border-slate-200/80 bg-white px-6 py-10 text-center shadow-sm">
                <p className="text-base font-medium text-slate-800">You’re all set</p>
                <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
                  Use the menu to open your schedule, leave, or logs. Punch access is controlled by your admin.
                </p>
              </div>
            </section>
          )}
      </div>
    </Layout>
  )
}
