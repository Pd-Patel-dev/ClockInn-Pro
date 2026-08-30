'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Layout from '@/components/Layout'
import PageAtmosphere from '@/components/PageAtmosphere'
import api from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import { format, parseISO, startOfMonth, endOfMonth, getYear, getMonth } from 'date-fns'
import logger from '@/lib/logger'
import { useToast } from '@/components/Toast'
import PayrollGenerateReviewModal, {
  type PayrollGenerateFormValues,
} from '@/components/payroll/PayrollGenerateReviewModal'

interface PayrollSchedule {
  configured: boolean
  last_pay_date: string | null
  payroll_type: 'WEEKLY' | 'BIWEEKLY' | null
  next_pay_date: string | null
  period_start: string | null
  period_end: string | null
  days_until_pay_date: number | null
  generate_window_days: number
  in_generate_window?: boolean
  can_generate: boolean
  window_opens_on: string | null
  reminder_enabled: boolean
  message: string
  existing_run_id: string | null
  existing_run_status: string | null
  today: string
}

interface PayrollRunSummary {
  id: string
  payroll_type: 'WEEKLY' | 'BIWEEKLY'
  period_start_date: string
  period_end_date: string
  pay_date?: string | null
  status: 'DRAFT' | 'FINALIZED' | 'VOID'
  generated_at: string
  total_regular_hours: number | string
  total_overtime_hours: number | string
  total_gross_pay_cents: number
  employee_count: number
  total_rooms_cleaned?: number
}

function toHours(value: number | string | null | undefined): number {
  if (value == null) return 0
  const n = typeof value === 'string' ? parseFloat(value) : value
  return Number.isFinite(n) ? n : 0
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format((cents || 0) / 100)
}

function formatHours(value: number | string) {
  return `${toHours(value).toFixed(1)}h`
}

function formatPayDate(value?: string | null) {
  if (!value) return null
  try {
    return format(parseISO(value), 'MMM d, yyyy')
  } catch {
    return value
  }
}

function formatPeriod(start: string, end: string) {
  try {
    const s = parseISO(start)
    const e = parseISO(end)
    const sameYear = getYear(s) === getYear(e)
    const sameMonth = sameYear && getMonth(s) === getMonth(e)

    if (sameMonth) {
      // e.g. Aug 10 – 16, 2026
      return `${format(s, 'MMM d')} – ${format(e, 'd, yyyy')}`
    }
    if (sameYear) {
      // e.g. Jul 28 – Aug 3, 2026
      return `${format(s, 'MMM d')} – ${format(e, 'MMM d, yyyy')}`
    }
    // e.g. Dec 29, 2025 – Jan 4, 2026
    return `${format(s, 'MMM d, yyyy')} – ${format(e, 'MMM d, yyyy')}`
  } catch {
    return `${start} – ${end}`
  }
}

/** Calendar month label for a pay period (uses period start). */
function formatPeriodMonthYear(start: string) {
  try {
    return format(parseISO(start), 'MMMM yyyy')
  } catch {
    return ''
  }
}

function statusChipClass(status: string) {
  switch (status) {
    case 'FINALIZED':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200/80'
    case 'VOID':
      return 'bg-red-50 text-red-700 ring-red-200/80'
    default:
      return 'bg-amber-50 text-amber-800 ring-amber-200/80'
  }
}

function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'warning' | 'success' | 'danger'
}) {
  const valueClass =
    tone === 'warning'
      ? 'text-amber-600'
      : tone === 'success'
        ? 'text-emerald-600'
        : tone === 'danger'
          ? 'text-red-600'
          : 'text-slate-900'

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${valueClass}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export default function AdminPayrollPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [payrollRuns, setPayrollRuns] = useState<PayrollRunSummary[]>([])
  const [schedule, setSchedule] = useState<PayrollSchedule | null>(null)
  const [showGenerateForm, setShowGenerateForm] = useState(false)
  const [testMode, setTestMode] = useState(false)
  const isDev = process.env.NODE_ENV === 'development'
  const [generateDefaults, setGenerateDefaults] = useState<PayrollGenerateFormValues>({
    payroll_type: 'WEEKLY',
    start_date: '',
    include_inactive: false,
  })
  const [filters, setFilters] = useState({
    year: '',
    month: '',
    from_date: '',
    to_date: '',
    status: '',
    payroll_type: '',
  })

  const fetchSchedule = async () => {
    try {
      const response = await api.get('/admin/payroll/schedule')
      setSchedule(response.data)
    } catch (error) {
      logger.error('Failed to fetch payroll schedule', error as Error, {
        endpoint: '/admin/payroll/schedule',
      })
    }
  }

  const fetchPayrollRuns = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.from_date) params.append('from_date', filters.from_date)
      if (filters.to_date) params.append('to_date', filters.to_date)
      if (filters.status) params.append('status', filters.status)
      if (filters.payroll_type) params.append('payroll_type', filters.payroll_type)

      const queryString = params.toString()
      const url = queryString ? `/admin/payroll/runs?${queryString}` : '/admin/payroll/runs'
      const response = await api.get(url)
      setPayrollRuns(response.data || [])
    } catch (error: any) {
      logger.error('Failed to fetch payroll runs', error as Error, {
        endpoint: '/admin/payroll/runs',
      })
      if (error.response?.status === 403) {
        router.push('/dashboard')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const checkAdminAndFetch = async () => {
      try {
        const user = await getCurrentUser()
        if (user.role !== 'ADMIN') {
          router.push('/dashboard')
          return
        }
        await Promise.all([fetchPayrollRuns(), fetchSchedule()])
      } catch (err: any) {
        logger.error('Authentication error', err as Error, { action: 'fetchPayrollRuns' })
        router.push('/login')
      }
    }
    checkAdminAndFetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, filters])

  const onGeneratePayroll = async (data: PayrollGenerateFormValues) => {
    setGenerating(true)
    try {
      const response = await api.post('/admin/payroll/runs/generate', {
        payroll_type: data.payroll_type,
        start_date: data.start_date,
        include_inactive: data.include_inactive,
        entry_hour_overrides: data.entry_hour_overrides || undefined,
        room_count_overrides: data.room_count_overrides || undefined,
        bypass_schedule: Boolean(data.bypass_schedule),
      })
      setShowGenerateForm(false)
      setTestMode(false)
      await Promise.all([fetchPayrollRuns(), fetchSchedule()])
      router.push(`/payroll/${response.data.id}`)
    } catch (error: any) {
      logger.error('Failed to generate payroll', error as Error, {
        endpoint: '/admin/payroll/runs/generate',
      })
      toast.error(error.response?.data?.detail || 'Failed to generate payroll')
    } finally {
      setGenerating(false)
    }
  }

  const openGenerateForm = () => {
    setTestMode(false)
    if (schedule?.configured) {
      if (!schedule.can_generate) {
        if (schedule.existing_run_id) {
          router.push(`/payroll/${schedule.existing_run_id}`)
          return
        }
        toast.warning(schedule.message || 'Generation is not open yet')
        return
      }
      setGenerateDefaults({
        payroll_type: (schedule.payroll_type as 'WEEKLY' | 'BIWEEKLY') || 'WEEKLY',
        start_date: schedule.period_start || '',
        include_inactive: false,
      })
    } else {
      setGenerateDefaults({
        payroll_type: 'WEEKLY',
        start_date: '',
        include_inactive: false,
      })
    }
    setShowGenerateForm(true)
  }

  const openTestPayrollForm = () => {
    const fallbackStart = format(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd')
    setTestMode(true)
    setGenerateDefaults({
      payroll_type: (schedule?.payroll_type as 'WEEKLY' | 'BIWEEKLY') || 'WEEKLY',
      start_date: schedule?.period_start || fallbackStart,
      include_inactive: false,
      bypass_schedule: true,
    })
    setShowGenerateForm(true)
  }
  const hasFilters = Boolean(
    filters.year ||
      filters.month ||
      filters.from_date ||
      filters.to_date ||
      filters.status ||
      filters.payroll_type
  )

  const yearOptions = useMemo(() => {
    const years = new Set<number>()
    const current = new Date().getFullYear()
    years.add(current)
    years.add(current - 1)
    for (const run of payrollRuns) {
      try {
        years.add(getYear(parseISO(run.period_start_date)))
        years.add(getYear(parseISO(run.period_end_date)))
      } catch {
        /* ignore */
      }
    }
    return Array.from(years).sort((a, b) => b - a)
  }, [payrollRuns])

  const monthOptions = [
    { value: '1', label: 'January' },
    { value: '2', label: 'February' },
    { value: '3', label: 'March' },
    { value: '4', label: 'April' },
    { value: '5', label: 'May' },
    { value: '6', label: 'June' },
    { value: '7', label: 'July' },
    { value: '8', label: 'August' },
    { value: '9', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ]

  const applyYearMonthFilter = (year: string, month: string) => {
    if (!year && !month) {
      setFilters((prev) => ({ ...prev, year: '', month: '', from_date: '', to_date: '' }))
      return
    }
    const y = parseInt(year || String(new Date().getFullYear()), 10)
    if (month) {
      const m = parseInt(month, 10) - 1
      const start = startOfMonth(new Date(y, m, 1))
      const end = endOfMonth(start)
      setFilters((prev) => ({
        ...prev,
        year: String(y),
        month,
        from_date: format(start, 'yyyy-MM-dd'),
        to_date: format(end, 'yyyy-MM-dd'),
      }))
      return
    }
    // Whole year
    setFilters((prev) => ({
      ...prev,
      year: String(y),
      month: '',
      from_date: `${y}-01-01`,
      to_date: `${y}-12-31`,
    }))
  }

  const kpis = useMemo(() => {
    const active = payrollRuns.filter((r) => r.status !== 'VOID')
    const drafts = payrollRuns.filter((r) => r.status === 'DRAFT')
    const finalized = payrollRuns.filter((r) => r.status === 'FINALIZED')
    const grossCents = active.reduce((sum, r) => sum + (r.total_gross_pay_cents || 0), 0)
    const regularHours = active.reduce((sum, r) => sum + toHours(r.total_regular_hours), 0)
    const otHours = active.reduce((sum, r) => sum + toHours(r.total_overtime_hours), 0)
    const totalHours = regularHours + otHours
    const employeesPaid = finalized.reduce((sum, r) => sum + (r.employee_count || 0), 0)
    const totalRooms = active.reduce((sum, r) => sum + (r.total_rooms_cleaned || 0), 0)
    const avgGross =
      finalized.length > 0
        ? Math.round(
            finalized.reduce((sum, r) => sum + (r.total_gross_pay_cents || 0), 0) /
              finalized.length
          )
        : 0
    const latest = [...payrollRuns].sort(
      (a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
    )[0]

    return {
      runs: payrollRuns.length,
      drafts: drafts.length,
      finalized: finalized.length,
      grossCents,
      totalHours,
      otHours,
      employeesPaid,
      totalRooms,
      avgGross,
      otShare: totalHours > 0 ? Math.round((otHours / totalHours) * 100) : 0,
      latest,
    }
  }, [payrollRuns])

  if (loading && payrollRuns.length === 0) {
    return (
      <Layout>
        <div className="relative mx-auto max-w-6xl py-16">
          <div className="space-y-3">
            <div className="h-40 animate-pulse rounded-2xl bg-slate-200/80" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
            <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="relative mx-auto max-w-6xl">
        <PageAtmosphere />

        <div className="relative space-y-6 pb-8">
          <header className="overflow-hidden rounded-2xl border border-slate-800/10 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.45)]">
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
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Finance · Compensation
                  </p>
                  <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight">
                    Payroll
                  </h1>
                  <p className="mt-2 max-w-lg text-sm text-slate-300 leading-relaxed">
                    Generate weekly or biweekly runs, track drafts, and finalize pay periods.
                  </p>
                  {kpis.latest && (
                    <p className="mt-3 text-sm text-teal-200/90">
                      Latest · {formatPeriod(kpis.latest.period_start_date, kpis.latest.period_end_date)}
                      {formatPayDate(kpis.latest.pay_date)
                        ? ` · Pay date ${formatPayDate(kpis.latest.pay_date)}`
                        : ''}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-stretch sm:items-end gap-3 shrink-0">
                  {kpis.drafts > 0 && (
                    <div className="sm:text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                        Drafts open
                      </p>
                      <p className="mt-1 text-3xl sm:text-4xl font-semibold tabular-nums tracking-tight leading-none text-amber-200">
                        {kpis.drafts}
                      </p>
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row items-stretch gap-2">
                    {isDev && (
                      <button
                        type="button"
                        onClick={openTestPayrollForm}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-400/50 bg-amber-500/15 px-4 py-2.5 text-sm font-semibold text-amber-100 hover:bg-amber-500/25"
                      >
                        Test payroll
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={openGenerateForm}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-100"
                    >
                      Generate payroll
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </header>

          {schedule && (
            <div
              className={`rounded-2xl border px-5 py-4 shadow-sm ${
                !schedule.configured
                  ? 'border-slate-200 bg-white'
                  : schedule.can_generate
                    ? 'border-amber-200 bg-amber-50'
                    : schedule.existing_run_id
                      ? 'border-emerald-200 bg-emerald-50'
                      : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                    Pay schedule
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {schedule.configured && schedule.next_pay_date
                      ? (() => {
                          if (schedule.existing_run_id) {
                            return 'Payroll already created for this period'
                          }
                          let payLabel = schedule.next_pay_date
                          let periodLabel = ''
                          try {
                            payLabel = format(parseISO(schedule.next_pay_date), 'MMM d')
                          } catch {
                            /* keep ISO */
                          }
                          if (schedule.period_start && schedule.period_end) {
                            try {
                              periodLabel = `${format(parseISO(schedule.period_start), 'MMM d')}–${format(
                                parseISO(schedule.period_end),
                                'MMM d'
                              )}`
                            } catch {
                              periodLabel = `${schedule.period_start}–${schedule.period_end}`
                            }
                          }
                          const days = schedule.days_until_pay_date
                          const periodBit = periodLabel ? ` · Period ${periodLabel}` : ''
                          if (schedule.can_generate) {
                            if (days === 0) return `Payday today (${payLabel})${periodBit} — generate now`
                            if (days === 1) return `1 day until payday (${payLabel})${periodBit} — generate now`
                            return `${days} days until payday (${payLabel})${periodBit} — generate now`
                          }
                          if (typeof days === 'number' && days > 0) {
                            return `Next payday ${payLabel}${periodBit} · ${days} day${days === 1 ? '' : 's'} left`
                          }
                          return `Next payday ${payLabel}${periodBit}`
                        })()
                      : schedule.message}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!schedule.configured && (
                    <Link
                      href="/settings?tab=payroll"
                      className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Configure in Settings
                    </Link>
                  )}
                  {schedule.existing_run_id && (
                    <Link
                      href={`/payroll/${schedule.existing_run_id}`}
                      className="rounded-xl bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      Open current run
                    </Link>
                  )}
                  {isDev && !schedule.can_generate && (
                    <button
                      type="button"
                      onClick={openTestPayrollForm}
                      className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
                    >
                      Test payroll
                    </button>
                  )}
                  {schedule.can_generate && (
                    <button
                      type="button"
                      onClick={openGenerateForm}
                      className="rounded-xl bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      Generate now
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Gross pay"
              value={formatCurrency(kpis.grossCents)}
              hint="Excludes void runs"
            />
            <StatCard
              label="Hours"
              value={kpis.totalHours.toFixed(1)}
              hint={`${kpis.otHours.toFixed(1)} OT · ${kpis.otShare}%`}
            />
            <StatCard
              label="Finalized"
              value={kpis.finalized}
              hint={`${kpis.employeesPaid} employee pays`}
              tone="success"
            />
            <StatCard
              label="Total rooms"
              value={kpis.totalRooms}
              hint="Matching filters · excludes void"
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Runs" value={kpis.runs} hint="Matching filters" />
            <StatCard
              label="Avg run"
              value={formatCurrency(kpis.avgGross)}
              hint="Finalized only"
            />
            <StatCard
              label="OT hours"
              value={kpis.otHours.toFixed(1)}
              hint="Across active runs"
              tone={kpis.otHours > 0 ? 'warning' : 'default'}
            />
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 mb-1.5">
                  Year
                </label>
                <select
                  value={filters.year}
                  onChange={(e) => applyYearMonthFilter(e.target.value, filters.month)}
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
                >
                  <option value="">All years</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 mb-1.5">
                  Month
                </label>
                <select
                  value={filters.month}
                  onChange={(e) =>
                    applyYearMonthFilter(
                      filters.year || String(new Date().getFullYear()),
                      e.target.value
                    )
                  }
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
                >
                  <option value="">All months</option>
                  {monthOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 mb-1.5">
                  Status
                </label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
                >
                  <option value="">All</option>
                  <option value="DRAFT">Draft</option>
                  <option value="FINALIZED">Finalized</option>
                  <option value="VOID">Void</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 mb-1.5">
                  Type
                </label>
                <select
                  value={filters.payroll_type}
                  onChange={(e) => setFilters({ ...filters, payroll_type: e.target.value })}
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
                >
                  <option value="">All</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="BIWEEKLY">Biweekly</option>
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <button
                  type="button"
                  onClick={() =>
                    setFilters({
                      year: '',
                      month: '',
                      from_date: '',
                      to_date: '',
                      status: '',
                      payroll_type: '',
                    })
                  }
                  disabled={!hasFilters}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
            </div>
            {(filters.from_date || filters.to_date) && (
              <p className="mt-3 text-xs text-slate-500">
                Showing periods overlapping{' '}
                <span className="font-medium text-slate-700">
                  {filters.from_date || '…'}
                  {' – '}
                  {filters.to_date || '…'}
                </span>
              </p>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Payroll runs</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {payrollRuns.length === 0
                    ? hasFilters
                      ? 'No runs match these filters'
                      : 'No runs yet'
                    : `${payrollRuns.length} run${payrollRuns.length === 1 ? '' : 's'}`}
                </p>
              </div>
              {!hasFilters && (
                <button
                  type="button"
                  onClick={openGenerateForm}
                  className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  New run
                </button>
              )}
            </div>

            {loading ? (
              <div className="p-4 space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : payrollRuns.length === 0 ? (
              <div className="px-6 py-16 text-center">
                {hasFilters ? (
                  <>
                    <p className="text-sm font-semibold text-slate-800">No runs match these filters</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Try another year or month, or clear filters to see all payroll runs.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-slate-800">No payroll runs yet</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Generate a weekly or biweekly run to get started
                    </p>
                    <button
                      type="button"
                      onClick={openGenerateForm}
                      className="mt-4 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      Generate payroll
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="overflow-hidden">
                <table className="w-full table-fixed">
                  <colgroup>
                    <col className="w-[26%]" />
                    <col className="w-[9%]" />
                    <col className="w-[7%]" />
                    <col className="w-[8%]" />
                    <col className="w-[10%]" />
                    <col className="w-[8%]" />
                    <col className="w-[12%]" />
                    <col className="w-[12%]" />
                    <col className="w-[8%]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Period
                      </th>
                      <th className="px-2 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Type
                      </th>
                      <th className="px-2 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Staff
                      </th>
                      <th className="px-2 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Rooms
                      </th>
                      <th className="px-2 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Regular
                      </th>
                      <th className="px-2 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        OT
                      </th>
                      <th className="px-2 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Gross
                      </th>
                      <th className="px-2 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Status
                      </th>
                      <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payrollRuns.map((run) => (
                      <tr key={run.id} className="hover:bg-slate-50/90 transition-colors">
                        <td className="min-w-0 px-3 py-3.5 align-middle">
                          <Link
                            href={`/payroll/${run.id}`}
                            className="block truncate text-sm font-semibold text-slate-900 hover:underline"
                          >
                            {formatPeriodMonthYear(run.period_start_date)}
                          </Link>
                          <p className="mt-0.5 truncate text-xs text-slate-500 tabular-nums">
                            {formatPeriod(run.period_start_date, run.period_end_date)}
                          </p>
                          {formatPayDate(run.pay_date) ? (
                            <p className="mt-0.5 truncate text-xs text-slate-500 tabular-nums">
                              Pay {formatPayDate(run.pay_date)}
                            </p>
                          ) : null}
                          <p className="mt-0.5 truncate text-xs text-slate-400 tabular-nums">
                            Gen{' '}
                            {(() => {
                              try {
                                return format(parseISO(run.generated_at), 'MMM d, yyyy')
                              } catch {
                                return run.generated_at
                              }
                            })()}
                          </p>
                        </td>
                        <td className="px-2 py-3.5 align-middle text-sm text-slate-700 capitalize">
                          {run.payroll_type.toLowerCase()}
                        </td>
                        <td className="px-2 py-3.5 align-middle text-right text-sm tabular-nums text-slate-900">
                          {run.employee_count}
                        </td>
                        <td className="px-2 py-3.5 align-middle text-right text-sm tabular-nums text-slate-900">
                          {run.total_rooms_cleaned ?? 0}
                        </td>
                        <td className="px-2 py-3.5 align-middle text-right text-sm tabular-nums text-slate-900">
                          {formatHours(run.total_regular_hours)}
                        </td>
                        <td className="px-2 py-3.5 align-middle text-right text-sm tabular-nums text-slate-900">
                          {formatHours(run.total_overtime_hours)}
                        </td>
                        <td className="px-2 py-3.5 align-middle text-right text-sm font-semibold tabular-nums text-slate-900">
                          {formatCurrency(run.total_gross_pay_cents)}
                        </td>
                        <td className="px-2 py-3.5 align-middle">
                          <span
                            className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset capitalize ${statusChipClass(run.status)}`}
                          >
                            {run.status.toLowerCase()}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 align-middle text-right">
                          <Link
                            href={`/payroll/${run.id}`}
                            className="text-sm font-semibold text-slate-700 hover:text-slate-900 whitespace-nowrap"
                          >
                            Open →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <PayrollGenerateReviewModal
          open={showGenerateForm}
          scheduleLocked={Boolean(schedule?.configured) && !testMode}
          testMode={testMode}
          nextPayDate={schedule?.next_pay_date}
          initialValues={generateDefaults}
          generating={generating}
          onClose={() => {
            setShowGenerateForm(false)
            setTestMode(false)
          }}
          onGenerate={onGeneratePayroll}
          onError={(message) => toast.error(message)}
          onInfo={(message) => toast.success(message)}
        />
      </div>
    </Layout>
  )
}
