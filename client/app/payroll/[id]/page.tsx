'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import { format, parseISO } from 'date-fns'
import logger from '@/lib/logger'
import { useToast } from '@/components/Toast'
import { ButtonSpinner } from '@/components/LoadingSpinner'
import ConfirmationDialog from '@/components/ConfirmationDialog'
import { deliverExportBlob, openPreviewTab } from '@/lib/deliverExportBlob'

interface PayrollLineItem {
  id: string
  employee_id: string
  employee_name: string
  regular_minutes: number
  overtime_minutes: number
  total_minutes: number
  pay_rate_cents: number
  overtime_multiplier: number
  regular_pay_cents: number
  overtime_pay_cents: number
  total_pay_cents: number
  exceptions_count: number
  details_json?: {
    exceptions?: PayrollExceptionDetail[]
    week_blocks?: Array<{
      entries?: Array<{
        entry_id?: string
        date?: string
        minutes?: number
        hours_overridden?: boolean
      }>
    }>
    days?: Record<string, number>
    hour_overrides_applied?: Record<string, number>
  } | null
}

interface PayrollExceptionDetail {
  type: string
  entry_id?: string
  date?: string
  clock_in_local?: string | null
  clock_out_local?: string | null
  hours_overridden?: boolean
  message?: string
}

interface PayrollRun {
  id: string
  company_id: string
  payroll_type: 'WEEKLY' | 'BIWEEKLY'
  period_start_date: string
  period_end_date: string
  pay_date?: string | null
  timezone: string
  status: 'DRAFT' | 'FINALIZED' | 'VOID'
  generated_by: string
  generated_by_name?: string
  generated_at: string
  total_regular_hours: number | string
  total_overtime_hours: number | string
  total_gross_pay_cents: number
  created_at: string
  updated_at: string
  line_items: PayrollLineItem[]
}

function toHours(value: number | string | null | undefined): number {
  if (value == null) return 0
  const n = typeof value === 'string' ? parseFloat(value) : value
  return Number.isFinite(n) ? n : 0
}

function formatPayDate(value?: string | null) {
  if (!value) return null
  try {
    return format(parseISO(value), 'MMM d, yyyy')
  } catch {
    return value
  }
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format((cents || 0) / 100)
}

function minutesToHours(minutes: number) {
  return (minutes / 60).toFixed(2)
}

function getExceptionDetails(item: PayrollLineItem): PayrollExceptionDetail[] {
  const stored = item.details_json?.exceptions
  if (Array.isArray(stored) && stored.length > 0) {
    return stored
  }

  // Fallback for older runs that only stored a count
  const fallback: PayrollExceptionDetail[] = []
  const overrides = item.details_json?.hour_overrides_applied || {}
  const weekBlocks = item.details_json?.week_blocks || []
  for (const block of weekBlocks) {
    for (const entry of block.entries || []) {
      if (entry.hours_overridden || (entry.entry_id && overrides[entry.entry_id] != null)) {
        fallback.push({
          type: 'edited',
          entry_id: entry.entry_id,
          date: entry.date,
          hours_overridden: true,
          message: 'Hours adjusted during payroll review',
        })
      }
    }
  }
  if (fallback.length === 0 && item.exceptions_count > 0) {
    fallback.push({
      type: 'unknown',
      message: `${item.exceptions_count} exception${
        item.exceptions_count === 1 ? '' : 's'
      } recorded (open punch or edited time entry). Regenerate payroll to see full details.`,
    })
  }
  return fallback
}

function exceptionTypeLabel(type: string) {
  switch (type) {
    case 'open_punch':
      return 'Open punch'
    case 'edited':
      return 'Edited entry'
    default:
      return 'Exception'
  }
}

function formatPeriod(start: string, end: string) {
  try {
    const s = parseISO(start)
    const e = parseISO(end)
    const sameYear = s.getFullYear() === e.getFullYear()
    const sameMonth = sameYear && s.getMonth() === e.getMonth()

    if (sameMonth) {
      return `${format(s, 'MMM d')} – ${format(e, 'd, yyyy')}`
    }
    if (sameYear) {
      return `${format(s, 'MMM d')} – ${format(e, 'MMM d, yyyy')}`
    }
    return `${format(s, 'MMM d, yyyy')} – ${format(e, 'MMM d, yyyy')}`
  } catch {
    return `${start} – ${end}`
  }
}

function formatPeriodMonthYear(start: string) {
  try {
    return format(parseISO(start), 'MMMM yyyy')
  } catch {
    return ''
  }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
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

export default function PayrollDetailsPage() {
  const router = useRouter()
  const params = useParams()
  const payrollRunId = params.id as string
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [payrollRun, setPayrollRun] = useState<PayrollRun | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [showVoidModal, setShowVoidModal] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [search, setSearch] = useState('')
  const [exceptionItem, setExceptionItem] = useState<PayrollLineItem | null>(null)

  useEffect(() => {
    const checkAdminAndFetch = async () => {
      try {
        const user = await getCurrentUser()
        if (user.role !== 'ADMIN') {
          router.push('/dashboard')
          return
        }
        fetchPayrollRun()
      } catch (err: any) {
        logger.error('Authentication error', err as Error, {
          action: 'fetchPayrollRun',
          payrollId: params.id,
        })
        router.push('/login')
      }
    }
    checkAdminAndFetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, payrollRunId])

  const fetchPayrollRun = async () => {
    setLoading(true)
    try {
      const response = await api.get(`/admin/payroll/runs/${payrollRunId}`)
      setPayrollRun(response.data)
    } catch (error: any) {
      logger.error('Failed to fetch payroll run', error as Error, {
        endpoint: `/admin/payroll/runs/${params.id}`,
      })
      if (error.response?.status === 404) {
        toast.error('Payroll run not found')
        router.push('/payroll')
      } else if (error.response?.status === 403) {
        router.push('/dashboard')
      } else {
        toast.error(error.response?.data?.detail || 'Failed to fetch payroll run')
      }
    } finally {
      setLoading(false)
    }
  }

  const confirmFinalize = async () => {
    setShowFinalizeConfirm(false)
    setFinalizing(true)
    try {
      await api.post(`/admin/payroll/runs/${payrollRunId}/finalize`, {})
      toast.success('Payroll run finalized successfully!')
      fetchPayrollRun()
    } catch (error: any) {
      logger.error('Failed to finalize payroll', error as Error, {
        endpoint: `/admin/payroll/runs/${params.id}/finalize`,
      })
      toast.error(error.response?.data?.detail || 'Failed to finalize payroll')
    } finally {
      setFinalizing(false)
    }
  }

  const handleVoid = async () => {
    if (!voidReason.trim()) {
      toast.warning('Please provide a reason for voiding')
      return
    }
    setVoiding(true)
    try {
      await api.post(`/admin/payroll/runs/${payrollRunId}/void`, {
        reason: voidReason,
      })
      toast.success('Payroll run voided successfully!')
      setShowVoidModal(false)
      setVoidReason('')
      fetchPayrollRun()
    } catch (error: any) {
      logger.error('Failed to void payroll', error as Error, {
        endpoint: `/admin/payroll/runs/${params.id}/void`,
      })
      toast.error(error.response?.data?.detail || 'Failed to void payroll')
    } finally {
      setVoiding(false)
    }
  }

  const handleExport = async (fileFormat: 'pdf' | 'xlsx') => {
    // Open tab during the click gesture so the browser allows PDF preview
    const previewWindow = fileFormat === 'pdf' ? openPreviewTab() : null
    setExporting(true)
    try {
      const response = await api.post(
        `/admin/payroll/runs/${payrollRunId}/export?format=${fileFormat}`,
        {},
        { responseType: 'blob' }
      )
      const filename = `payroll_${payrollRunId}.${fileFormat === 'pdf' ? 'pdf' : 'xlsx'}`
      const result = deliverExportBlob(response.data, filename, {
        previewInBrowser: fileFormat === 'pdf',
        previewWindow,
        mimeType:
          fileFormat === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      toast.success(
        fileFormat === 'pdf' && result.mode === 'preview'
          ? 'PDF opened in a new tab — use the browser to save or print'
          : `Payroll exported as ${fileFormat.toUpperCase()} successfully!`
      )
    } catch (error: any) {
      if (previewWindow && !previewWindow.closed) {
        previewWindow.close()
      }
      logger.error('Failed to export payroll', error as Error, {
        endpoint: `/admin/payroll/runs/${params.id}/export`,
      })
      toast.error(error.response?.data?.detail || 'Failed to export payroll')
    } finally {
      setExporting(false)
    }
  }

  const confirmDelete = async () => {
    setShowDeleteConfirm(false)
    setDeleting(true)
    try {
      await api.delete(`/admin/payroll/runs/${payrollRunId}`)
      toast.success('Payroll run deleted successfully!')
      router.push('/payroll')
    } catch (error: any) {
      logger.error('Failed to delete payroll', error as Error, {
        endpoint: `/admin/payroll/runs/${payrollRunId}`,
      })
      toast.error(error.response?.data?.detail || error.message || 'Failed to delete payroll')
    } finally {
      setDeleting(false)
    }
  }

  const lineItems = payrollRun?.line_items || []

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return lineItems
    return lineItems.filter((item) => item.employee_name.toLowerCase().includes(q))
  }, [lineItems, search])

  const kpis = useMemo(() => {
    if (!payrollRun) {
      return {
        employees: 0,
        regularHours: 0,
        otHours: 0,
        totalHours: 0,
        otShare: 0,
        avgPay: 0,
        exceptions: 0,
        topEarner: null as PayrollLineItem | null,
      }
    }
    const regularHours = toHours(payrollRun.total_regular_hours)
    const otHours = toHours(payrollRun.total_overtime_hours)
    const totalHours = regularHours + otHours
    const exceptions = lineItems.reduce((sum, i) => sum + (i.exceptions_count || 0), 0)
    const avgPay =
      lineItems.length > 0
        ? Math.round(payrollRun.total_gross_pay_cents / lineItems.length)
        : 0
    const topEarner =
      [...lineItems].sort((a, b) => b.total_pay_cents - a.total_pay_cents)[0] || null

    return {
      employees: lineItems.length,
      regularHours,
      otHours,
      totalHours,
      otShare: totalHours > 0 ? Math.round((otHours / totalHours) * 100) : 0,
      avgPay,
      exceptions,
      topEarner,
    }
  }, [payrollRun, lineItems])

  if (loading) {
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

  if (!payrollRun) {
    return (
      <Layout>
        <div className="relative mx-auto max-w-6xl py-24 text-center">
          <p className="text-sm font-semibold text-slate-800">Payroll run not found</p>
          <Link
            href="/payroll"
            className="mt-4 inline-block text-sm font-semibold text-slate-700 hover:text-slate-900"
          >
            ← Back to Payroll
          </Link>
        </div>
      </Layout>
    )
  }

  const busy = finalizing || voiding || deleting || exporting

  return (
    <Layout>
      <div className="relative mx-auto max-w-6xl">
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

        <div className="relative space-y-6 pb-8">
          <div>
            <Link
              href="/payroll"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
            >
              ← Back to Payroll
            </Link>
          </div>

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
              <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Payroll run · {payrollRun.payroll_type.toLowerCase()}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                      {formatPeriodMonthYear(payrollRun.period_start_date)}
                    </h1>
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset capitalize ${
                        payrollRun.status === 'FINALIZED'
                          ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/30'
                          : payrollRun.status === 'VOID'
                            ? 'bg-red-400/15 text-red-200 ring-red-400/30'
                            : 'bg-amber-400/15 text-amber-100 ring-amber-400/30'
                      }`}
                    >
                      {payrollRun.status.toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-300 tabular-nums">
                    {formatPeriod(payrollRun.period_start_date, payrollRun.period_end_date)}
                    {formatPayDate(payrollRun.pay_date) ? (
                      <>
                        {' · '}Pay date {formatPayDate(payrollRun.pay_date)}
                      </>
                    ) : null}
                  </p>
                  <p className="mt-1.5 max-w-xl text-sm text-slate-400 leading-relaxed">
                    {payrollRun.generated_by_name
                      ? `Generated by ${payrollRun.generated_by_name}`
                      : 'Generated'}
                    {' · '}
                    {(() => {
                      try {
                        return format(parseISO(payrollRun.generated_at), 'MMM d, yyyy · h:mm a')
                      } catch {
                        return payrollRun.generated_at
                      }
                    })()}
                    {' · '}
                    {payrollRun.timezone}
                  </p>
                  <p className="mt-3 text-sm font-medium text-teal-200/90 tabular-nums">
                    {formatCurrency(payrollRun.total_gross_pay_cents)} gross
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleExport('pdf')}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm font-medium text-slate-100 hover:bg-white/10 disabled:opacity-50"
                  >
                    {exporting && <ButtonSpinner />}
                    View PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport('xlsx')}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm font-medium text-slate-100 hover:bg-white/10 disabled:opacity-50"
                  >
                    Export Excel
                  </button>
                  {payrollRun.status === 'DRAFT' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowFinalizeConfirm(true)}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-100 disabled:opacity-50"
                      >
                        {finalizing && <ButtonSpinner />}
                        Finalize
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowVoidModal(true)}
                        disabled={busy}
                        className="rounded-xl border border-red-400/40 bg-red-500/10 px-3.5 py-2.5 text-sm font-semibold text-red-100 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        Void
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={busy}
                        className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/10 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </header>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <StatCard
              label="Gross pay"
              value={formatCurrency(payrollRun.total_gross_pay_cents)}
              hint={`${kpis.employees} employees`}
            />
            <StatCard
              label="Total hours"
              value={kpis.totalHours.toFixed(1)}
              hint={`${kpis.otHours.toFixed(1)} OT · ${kpis.otShare}%`}
            />
            <StatCard
              label="Avg pay"
              value={formatCurrency(kpis.avgPay)}
              hint="Per employee"
              tone="success"
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Regular hours"
              value={kpis.regularHours.toFixed(1)}
              hint="This period"
            />
            <StatCard
              label="OT hours"
              value={kpis.otHours.toFixed(1)}
              hint="Overtime worked"
              tone={kpis.otHours > 0 ? 'warning' : 'default'}
            />
            <StatCard label="Employees" value={kpis.employees} hint="On this run" />
            <StatCard
              label="Top earner"
              value={
                kpis.topEarner
                  ? formatCurrency(kpis.topEarner.total_pay_cents)
                  : '—'
              }
              hint={kpis.topEarner?.employee_name || 'No line items'}
            />
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Employee line items</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {filteredItems.length === lineItems.length
                    ? `${lineItems.length} employee${lineItems.length === 1 ? '' : 's'}`
                    : `${filteredItems.length} of ${lineItems.length} employees`}
                </p>
              </div>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employee…"
                className="w-full sm:w-56 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
              />
            </div>

            {filteredItems.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <p className="text-sm font-semibold text-slate-800">No employees found</p>
                <p className="mt-1 text-sm text-slate-500">
                  {search ? 'Try a different search' : 'This payroll run has no line items'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full table-fixed min-w-[900px]">
                  <colgroup>
                    <col className="w-[22%]" />
                    <col className="w-[10%]" />
                    <col className="w-[10%]" />
                    <col className="w-[11%]" />
                    <col className="w-[11%]" />
                    <col className="w-[11%]" />
                    <col className="w-[13%]" />
                    <col className="w-[8%]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Employee
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Reg
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        OT
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Rate
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Reg pay
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        OT pay
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Total
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Exc
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredItems.map((item) => (
                      <tr
                        key={item.id}
                        className="border-l-4 border-l-transparent transition-colors hover:bg-slate-50/90"
                      >
                        <td className="px-4 py-3.5 align-middle">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                              {initials(item.employee_name)}
                            </div>
                            <p className="truncate text-sm font-medium text-slate-900">
                              {item.employee_name}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 align-middle text-right text-sm tabular-nums text-slate-900">
                          {minutesToHours(item.regular_minutes)}
                        </td>
                        <td className="px-4 py-3.5 align-middle text-right text-sm tabular-nums text-slate-900">
                          {minutesToHours(item.overtime_minutes)}
                        </td>
                        <td className="px-4 py-3.5 align-middle text-right text-sm tabular-nums text-slate-700">
                          {formatCurrency(item.pay_rate_cents)}
                        </td>
                        <td className="px-4 py-3.5 align-middle text-right text-sm tabular-nums text-slate-900">
                          {formatCurrency(item.regular_pay_cents)}
                        </td>
                        <td className="px-4 py-3.5 align-middle text-right text-sm tabular-nums text-slate-900">
                          {formatCurrency(item.overtime_pay_cents)}
                        </td>
                        <td className="px-4 py-3.5 align-middle text-right text-sm font-semibold tabular-nums text-slate-900">
                          {formatCurrency(item.total_pay_cents)}
                        </td>
                        <td className="px-4 py-3.5 align-middle text-right text-sm tabular-nums">
                          {item.exceptions_count > 0 ? (
                            <button
                              type="button"
                              onClick={() => setExceptionItem(item)}
                              className="font-semibold text-red-600 underline decoration-red-300 underline-offset-2 hover:text-red-700"
                              title="View exception details"
                            >
                              {item.exceptions_count}
                            </button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50/80">
                      <td className="px-4 py-3.5 text-sm font-semibold text-slate-900">
                        Totals
                      </td>
                      <td className="px-4 py-3.5 text-right text-sm font-semibold tabular-nums text-slate-900">
                        {toHours(payrollRun.total_regular_hours).toFixed(2)}
                      </td>
                      <td className="px-4 py-3.5 text-right text-sm font-semibold tabular-nums text-slate-900">
                        {toHours(payrollRun.total_overtime_hours).toFixed(2)}
                      </td>
                      <td className="px-4 py-3.5" />
                      <td className="px-4 py-3.5" />
                      <td className="px-4 py-3.5" />
                      <td className="px-4 py-3.5 text-right text-sm font-semibold tabular-nums text-slate-900">
                        {formatCurrency(payrollRun.total_gross_pay_cents)}
                      </td>
                      <td className="px-4 py-3.5 text-right text-sm font-semibold tabular-nums text-slate-900">
                        {kpis.exceptions > 0 ? kpis.exceptions : '—'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>

        {exceptionItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
            <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="border-b border-slate-800/10 bg-slate-900 px-5 py-4 text-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      Exceptions
                    </p>
                    <h3 className="mt-1 text-xl font-semibold tracking-tight">
                      {exceptionItem.employee_name}
                    </h3>
                    <p className="mt-1 text-sm text-slate-300">
                      {exceptionItem.exceptions_count} exception
                      {exceptionItem.exceptions_count === 1 ? '' : 's'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExceptionItem(null)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
                    aria-label="Close"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <ul className="space-y-2">
                  {getExceptionDetails(exceptionItem).map((exc, idx) => (
                    <li
                      key={`${exc.entry_id || 'exc'}-${idx}`}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-900">
                          {exceptionTypeLabel(exc.type)}
                        </p>
                        {exc.date && (
                          <p className="shrink-0 text-xs tabular-nums text-slate-500">
                            {(() => {
                              try {
                                return format(parseISO(exc.date), 'MMM d, yyyy')
                              } catch {
                                return exc.date
                              }
                            })()}
                          </p>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">
                        {exc.message || 'Flagged during payroll calculation'}
                      </p>
                      {(exc.clock_in_local || exc.clock_out_local) && (
                        <p className="mt-2 text-xs tabular-nums text-slate-500">
                          {exc.clock_in_local || '—'} → {exc.clock_out_local || 'Open'}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="border-t border-slate-100 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setExceptionItem(null)}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {showVoidModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="border-b border-slate-800/10 bg-slate-900 px-5 py-4 text-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      Void run
                    </p>
                    <h3 className="mt-1 text-xl font-semibold tracking-tight">Void payroll</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowVoidModal(false)
                      setVoidReason('')
                    }}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
                    aria-label="Close"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-slate-600">
                  Provide a reason for voiding this payroll run. This cannot be undone.
                </p>
                <textarea
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  rows={4}
                  placeholder="Reason for voiding…"
                  className="block w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm shadow-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                />
                <div className="flex gap-3 border-t border-slate-100 pt-5">
                  <button
                    type="button"
                    onClick={handleVoid}
                    disabled={voiding}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {voiding && <ButtonSpinner />}
                    Void run
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowVoidModal(false)
                      setVoidReason('')
                    }}
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <ConfirmationDialog
          isOpen={showFinalizeConfirm}
          title="Finalize Payroll Run"
          message="Are you sure you want to finalize this payroll run? This action cannot be undone."
          confirmText="Finalize"
          cancelText="Cancel"
          type="warning"
          onConfirm={confirmFinalize}
          onCancel={() => setShowFinalizeConfirm(false)}
        />

        <ConfirmationDialog
          isOpen={showDeleteConfirm}
          title="Delete Payroll Run"
          message="Are you sure you want to delete this payroll run? This action cannot be undone."
          confirmText="Delete"
          cancelText="Cancel"
          type="warning"
          onConfirm={confirmDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      </div>
    </Layout>
  )
}
