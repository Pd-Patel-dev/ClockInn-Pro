'use client'

import { useEffect, useMemo, useState } from 'react'
import Layout from '@/components/Layout'
import PunchInOutPanel from '@/components/PunchInOutPanel'
import { getCurrentUser, User } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { format } from 'date-fns'
import logger from '@/lib/logger'
import { isPunchAllowed } from '@/lib/punch'
import { InfoTip } from '@/components/ui/InfoTip'

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

function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
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
  const [forgotPunchOut, setForgotPunchOut] = useState(0)
  const [autoClockOutIds, setAutoClockOutIds] = useState<Set<string>>(new Set())
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
      const employeesList = (employeesResponse.data || []) as Employee[]
      setTotalEmployees(employeesList.length)
      setActiveToday(employeesList.filter((emp) => emp.is_clocked_in === true).length)
      // Prefer people on shift, then alphabetical — show a compact roster
      const ranked = [...employeesList].sort((a, b) => {
        const aIn = a.is_clocked_in ? 1 : 0
        const bIn = b.is_clocked_in ? 1 : 0
        if (aIn !== bIn) return bIn - aIn
        return a.name.localeCompare(b.name)
      })
      setEmployees(ranked.slice(0, 10))

      try {
        const leaveResponse = await api.get('/leave/admin/leave?status=pending&limit=1')
        setPendingLeave(leaveResponse.data?.total || 0)
      } catch {
        setPendingLeave(0)
      }

      try {
        const notifRes = await api.get('/notifications?type=missing_punch&limit=40')
        const items = (notifRes.data?.items || []) as {
          actionable?: boolean
          employee_id?: string | null
        }[]
        const actionable = items.filter((i) => i.actionable === true)
        setForgotPunchOut(actionable.length)
        setAutoClockOutIds(
          new Set(
            actionable
              .map((i) => i.employee_id)
              .filter((id): id is string => Boolean(id))
          )
        )
      } catch {
        setForgotPunchOut(0)
        setAutoClockOutIds(new Set())
      }
    } catch (error: unknown) {
      logger.error('Failed to fetch dashboard stats', error as Error, { endpoint: 'dashboard' })
    } finally {
      setLoadingStats(false)
    }
  }

  const whoIsOn = useMemo(() => {
    return [...employees].sort((a, b) => {
      const aIn = a.is_clocked_in ? 1 : 0
      const bIn = b.is_clocked_in ? 1 : 0
      if (aIn !== bIn) return bIn - aIn
      const aReview = autoClockOutIds.has(a.id) ? 1 : 0
      const bReview = autoClockOutIds.has(b.id) ? 1 : 0
      if (aReview !== bReview) return bReview - aReview
      return a.name.localeCompare(b.name)
    })
  }, [employees, autoClockOutIds])

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

          {isAdmin && forgotPunchOut > 0 && (
            <section className="dashboard-reveal dashboard-reveal-delay-1">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5 shadow-sm">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="text-sm font-semibold text-amber-950">
                    {forgotPunchOut} auto clock-out{forgotPunchOut === 1 ? '' : 's'}
                  </p>
                  <InfoTip
                    label="About auto clock-out"
                    content="Employee missed punch-out; shift closed at schedule time. Review in Shift Log, then Approve & Close."
                  />
                </div>
                <Link
                  href="/admin/shift-log"
                  className="shrink-0 text-sm font-semibold text-amber-800 hover:text-amber-950"
                >
                  Review →
                </Link>
              </div>
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

              {/* Who’s on */}
              <section className="dashboard-reveal dashboard-reveal-delay-3">
                <div className="mb-4 flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight text-slate-900">Team status</h2>
                    {!loadingStats && (
                      <p className="mt-0.5 text-sm text-slate-500">
                        {activeToday} on shift
                        {forgotPunchOut > 0 ? ` · ${forgotPunchOut} auto clock-out` : ''}
                      </p>
                    )}
                  </div>
                  <Link
                    href="/employees"
                    className="text-sm font-medium text-slate-500 transition-colors hover:text-blue-600"
                  >
                    All employees
                  </Link>
                </div>

                {loadingStats ? (
                  <div className="space-y-2" role="status" aria-label="Loading employees">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />
                    ))}
                  </div>
                ) : whoIsOn.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
                    <p className="text-sm font-medium text-slate-700">No employees yet</p>
                    <Link
                      href="/employees"
                      className="mt-3 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
                    >
                      Go to Employees →
                    </Link>
                  </div>
                ) : (
                  <ul className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                    {whoIsOn.map((employee, index) => {
                      const needsReview = autoClockOutIds.has(employee.id)
                      const clockedIn = Boolean(employee.is_clocked_in)
                      return (
                        <li
                          key={employee.id}
                          className={index > 0 ? 'border-t border-slate-100' : undefined}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              router.push(
                                needsReview ? '/admin/shift-log' : `/employees/${employee.id}`
                              )
                            }
                            className={`flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors focus:outline-none focus-visible:bg-slate-50 sm:px-5 ${
                              needsReview
                                ? 'bg-amber-50/50 hover:bg-amber-50'
                                : 'hover:bg-slate-50/90'
                            }`}
                          >
                            <div className="relative shrink-0">
                              <div
                                className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold tracking-wide ${
                                  clockedIn
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : needsReview
                                      ? 'bg-amber-100 text-amber-900'
                                      : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {initials(employee.name)}
                              </div>
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
                                  clockedIn
                                    ? 'bg-emerald-500'
                                    : needsReview
                                      ? 'bg-amber-500'
                                      : 'bg-slate-300'
                                }`}
                                aria-hidden
                              />
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <p className="truncate font-medium text-slate-900">{employee.name}</p>
                                {needsReview && (
                                  <InfoTip
                                    label="Auto clock-out"
                                    content="Missed punch-out — reviewed in Shift Log."
                                  />
                                )}
                              </div>
                              <p className="mt-0.5 truncate text-sm text-slate-500">
                                {needsReview
                                  ? 'Auto clock-out'
                                  : clockedIn
                                    ? `On since ${relativePunch(employee.last_punch_at)}`
                                    : relativePunch(employee.last_punch_at)}
                              </p>
                            </div>

                            <span
                              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                                clockedIn
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : needsReview
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              {clockedIn ? 'In' : needsReview ? 'Review' : 'Out'}
                            </span>
                          </button>
                        </li>
                      )
                    })}
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
