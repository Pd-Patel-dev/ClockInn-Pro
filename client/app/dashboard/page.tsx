'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
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

function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  href,
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'default' | 'success' | 'warning'
  href?: string
}) {
  const valueClass =
    tone === 'success'
      ? 'text-emerald-600'
      : tone === 'warning'
        ? 'text-amber-600'
        : 'text-slate-900'

  const inner = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>
      <p className={`mt-1 text-3xl font-semibold tracking-tight tabular-nums ${valueClass}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50/80"
      >
        {inner}
      </Link>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm">
      {inner}
    </div>
  )
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
  const [cashDrawerEnabled, setCashDrawerEnabled] = useState(false)
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
          setCashDrawerEnabled(companyRes.data?.settings?.cash_drawer_enabled === true)
        } catch {
          setCanPunch(isPunchAllowed(currentUser.role, null))
          setCashDrawerEnabled(false)
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
            actionable.map((i) => i.employee_id).filter((id): id is string => Boolean(id))
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
        <div
          className="min-h-[50vh] flex items-center justify-center"
          role="status"
          aria-label="Loading"
        >
          <div className="w-full max-w-lg space-y-4 animate-pulse px-2">
            <div className="h-40 rounded-2xl bg-slate-200" />
            <div className="grid grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-2xl bg-slate-100" />
              ))}
            </div>
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
      <div className="relative mx-auto max-w-6xl">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-4 h-56 overflow-hidden"
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

        <div className="relative space-y-6 pb-8">
          {/* Hero */}
          <header className="dashboard-reveal overflow-hidden rounded-2xl border border-slate-800/10 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.45)]">
            <div className="relative bg-slate-900 px-5 py-6 sm:px-7 sm:py-8 text-white">
              <div
                aria-hidden
                className="absolute inset-0 opacity-40"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 12% 20%, rgba(45,212,191,0.28), transparent 42%), radial-gradient(circle at 88% 10%, rgba(59,130,246,0.22), transparent 36%)',
                }}
              />
              <div
                aria-hidden
                className="absolute inset-y-0 right-0 w-1/2 opacity-[0.07]"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(-32deg, transparent, transparent 10px, white 10px, white 11px)',
                }}
              />

              <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    {user.company_name || 'Workspace'}
                    <span className="mx-2 text-slate-600">·</span>
                    {format(now, 'EEEE · MMM d')}
                  </p>
                  <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-balance">
                    {getGreeting()}, {displayName}
                  </h1>
                  <p className="mt-2 max-w-lg text-sm text-slate-300 leading-relaxed">
                    {canPunch
                      ? 'Ready when you are — clock in and keep your day on track.'
                      : isAdmin
                        ? 'Here’s how your team is doing right now.'
                        : 'Your workspace for schedules, leave, and day-to-day work.'}
                  </p>
                </div>
                <div className="shrink-0 sm:pt-0 sm:text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Local time
                  </p>
                  <p className="mt-2 text-3xl sm:text-4xl font-semibold tabular-nums tracking-tight leading-none">
                    {format(now, 'h:mm:ss')}
                    <span className="ml-1.5 text-sm font-medium text-slate-300 align-baseline">
                      {format(now, 'a')}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </header>

          {canPunch && (
            <section className="dashboard-reveal dashboard-reveal-delay-1">
              <PunchInOutPanel user={user} compact />
            </section>
          )}

          {isAdmin && cashDrawerEnabled && forgotPunchOut > 0 && (
            <section className="dashboard-reveal dashboard-reveal-delay-1">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-4 shadow-sm">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-800 ring-1 ring-inset ring-amber-500/20">
                    <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                  </span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-amber-950">
                        {forgotPunchOut} auto clock-out{forgotPunchOut === 1 ? '' : 's'} need review
                      </p>
                      <InfoTip
                        label="About auto clock-out"
                        content="Employee missed punch-out; shift closed at schedule time. Review in Drawer Log, then Approve & Close."
                      />
                    </div>
                    <p className="mt-0.5 text-xs text-amber-800/80">
                      Open Drawer Log to approve and close.
                    </p>
                  </div>
                </div>
                <Link
                  href="/admin/shift-log"
                  className="shrink-0 rounded-xl bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
                >
                  Review now
                </Link>
              </div>
            </section>
          )}

          {isAdmin && (
            <>
              <section className="dashboard-reveal dashboard-reveal-delay-2 grid grid-cols-2 lg:grid-cols-4 gap-3">
                {loadingStats ? (
                  [0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-[88px] animate-pulse rounded-2xl bg-slate-100 border border-slate-100"
                    />
                  ))
                ) : (
                  <>
                    <StatCard
                      label="Team"
                      value={totalEmployees}
                      hint="All employees"
                      href="/employees"
                    />
                    <StatCard
                      label="On shift"
                      value={activeToday}
                      hint="Clocked in now"
                      tone="success"
                    />
                    <StatCard
                      label="Leave waiting"
                      value={pendingLeave}
                      hint={pendingLeave > 0 ? 'Needs approval' : 'All clear'}
                      tone={pendingLeave > 0 ? 'warning' : 'default'}
                      href={pendingLeave > 0 ? '/leave-requests' : undefined}
                    />
                    <StatCard
                      label="Auto clock-out"
                      value={forgotPunchOut}
                      hint={
                        forgotPunchOut > 0
                          ? cashDrawerEnabled
                            ? 'Review in Drawer Log'
                            : 'Needs attention'
                          : 'None pending'
                      }
                      tone={forgotPunchOut > 0 ? 'warning' : 'default'}
                      href={
                        forgotPunchOut > 0 && cashDrawerEnabled
                          ? '/admin/shift-log'
                          : undefined
                      }
                    />
                  </>
                )}
              </section>

              {isAdmin && (
                <section className="dashboard-reveal dashboard-reveal-delay-2 flex flex-wrap gap-2">
                  {[
                    { href: '/employees/create', label: 'Add employee' },
                    { href: '/schedules', label: 'Schedules' },
                    { href: '/leave-requests', label: 'Leave requests' },
                    ...(cashDrawerEnabled
                      ? [{ href: '/admin/shift-log', label: 'Drawer Log' }]
                      : []),
                    { href: '/settings', label: 'Settings' },
                  ].map((action) => (
                    <Link
                      key={action.href}
                      href={action.href}
                      className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 transition-colors"
                    >
                      {action.label}
                    </Link>
                  ))}
                </section>
              )}

              <section className="dashboard-reveal dashboard-reveal-delay-3">
                <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                  <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">Team status</h2>
                      {!loadingStats && (
                        <p className="mt-0.5 text-xs text-slate-500">
                          {activeToday} on shift
                          {forgotPunchOut > 0 ? ` · ${forgotPunchOut} need review` : ''}
                        </p>
                      )}
                    </div>
                    <Link
                      href="/employees"
                      className="text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
                    >
                      All employees →
                    </Link>
                  </div>

                  {loadingStats ? (
                    <div className="p-4 space-y-2" role="status" aria-label="Loading employees">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
                      ))}
                    </div>
                  ) : whoIsOn.length === 0 ? (
                    <div className="px-6 py-14 text-center">
                      <p className="text-sm font-semibold text-slate-800">No employees yet</p>
                      <Link
                        href="/employees/create"
                        className="mt-3 inline-block text-sm font-semibold text-slate-900 hover:underline"
                      >
                        Add your first employee →
                      </Link>
                    </div>
                  ) : (
                    <ul>
                      {whoIsOn.map((employee, index) => {
                        const needsReview = autoClockOutIds.has(employee.id)
                        const clockedIn = Boolean(employee.is_clocked_in)
                        return (
                          <li
                            key={employee.id}
                            className={index > 0 ? 'border-t border-slate-100' : undefined}
                          >
                            <div
                              className={`group flex w-full items-center gap-2 px-5 py-3.5 transition-colors ${
                                needsReview
                                  ? 'bg-amber-50/40 hover:bg-amber-50'
                                  : 'hover:bg-slate-50/90'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  router.push(
                                    needsReview && cashDrawerEnabled
                                      ? '/admin/shift-log'
                                      : `/employees/${employee.id}`
                                  )
                                }
                                className="flex min-w-0 flex-1 items-center gap-3.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10 rounded-lg"
                              >
                                <div className="relative shrink-0">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-xs font-semibold tracking-wide text-white shadow-sm">
                                    {initials(employee.name)}
                                  </div>
                                  <span
                                    className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                                      clockedIn
                                        ? 'bg-emerald-400'
                                        : needsReview
                                          ? 'bg-amber-400'
                                          : 'bg-slate-300'
                                    }`}
                                    aria-hidden
                                  />
                                </div>

                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold text-slate-900">
                                    {employee.name}
                                  </p>
                                  <p className="mt-0.5 truncate text-xs text-slate-500">
                                    {needsReview
                                      ? 'Auto clock-out'
                                      : clockedIn
                                        ? `On since ${relativePunch(employee.last_punch_at)}`
                                        : relativePunch(employee.last_punch_at)}
                                  </p>
                                </div>

                                <span
                                  className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                                    clockedIn
                                      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/80'
                                      : needsReview
                                        ? 'bg-amber-50 text-amber-800 ring-amber-200/80'
                                        : 'bg-slate-50 text-slate-500 ring-slate-200'
                                  }`}
                                >
                                  {clockedIn && (
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  )}
                                  {clockedIn ? 'On shift' : needsReview ? 'Review' : 'Off'}
                                </span>
                              </button>
                              {needsReview && (
                                <InfoTip
                                  label="Auto clock-out"
                                  content="Missed punch-out — reviewed in Shift Log."
                                />
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </section>
            </>
          )}

          {!canPunch && !isAdmin && (
            <section className="dashboard-reveal dashboard-reveal-delay-1">
              <div className="rounded-2xl border border-slate-200/80 bg-white px-6 py-12 text-center shadow-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white">
                  {initials(user.name)}
                </div>
                <p className="mt-4 text-base font-semibold text-slate-900">You’re all set</p>
                <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
                  Use the menu to open your schedule, leave, or logs. Punch access is controlled by
                  your admin.
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </Layout>
  )
}
