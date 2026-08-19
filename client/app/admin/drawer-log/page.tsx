'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser, User } from '@/lib/auth'
import { addWeeks, endOfWeek, format, startOfWeek } from 'date-fns'
import { useToast } from '@/components/Toast'
import ConfirmationDialog from '@/components/ConfirmationDialog'
import { InfoTip } from '@/components/ui/InfoTip'
import { deliverExportBlob, openPreviewTab } from '@/lib/deliverExportBlob'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

interface CashDrawerSession {
  id: string
  employee_id: string
  employee_name: string
  time_entry_id: string
  start_cash_cents: number
  start_counted_at: string
  end_cash_cents: number | null
  end_counted_at: string | null
  current_cash_cents: number | null
  collected_cash_cents: number | null
  drop_amount_cents: number | null
  beverages_cash_cents: number | null
  marketplace_cash_cents?: number | null
  marketplace_card_cents?: number | null
  marketplace_sales?: MarketplaceSaleRow[] | null
  expected_balance_cents: number | null
  delta_cents: number | null
  status: 'OPEN' | 'CLOSED' | 'REVIEW_NEEDED'
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  verified_by: string | null
  verified_at: string | null
  created_at: string
  clock_in_at: string | null
  clock_out_at: string | null
}

type MarketplaceSaleRow = {
  id: string
  label: string
  price_cents: number
  qty: number
  payment?: 'cash' | 'card'
}

const editSchema = z.object({
  start_cash_cents: z.string().optional(),
  end_cash_cents: z.string().optional(),
  reason: z.string().min(1, 'Reason is required'),
})

type EditForm = z.infer<typeof editSchema>

const FORGOT_PUNCH_OUT_MARKER = 'forgot to punch out'

function isForgotPunchOutReview(session: CashDrawerSession): boolean {
  return (
    session.status === 'REVIEW_NEEDED' &&
    Boolean(session.review_note?.toLowerCase().includes(FORGOT_PUNCH_OUT_MARKER))
  )
}

/** Finished session awaiting weekly Drop & Sales verification */
function needsWeekVerify(session: CashDrawerSession): boolean {
  return session.status !== 'OPEN' && !session.verified_at
}

/** After-drop cash doesn't match expected (current − drop), or finished session missing ending count */
function hasBalanceDiscrepancy(session: CashDrawerSession): boolean {
  if (session.status === 'OPEN') return false
  if (session.end_cash_cents == null) return true
  if (session.delta_cents != null) return session.delta_cents !== 0
  if (session.expected_balance_cents != null) {
    return session.end_cash_cents !== session.expected_balance_cents
  }
  return false
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

function statusChipClass(status: string) {
  switch (status) {
    case 'OPEN':
      return 'bg-amber-50 text-amber-800 ring-amber-200/80'
    case 'CLOSED':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200/80'
    case 'REVIEW_NEEDED':
      return 'bg-red-50 text-red-700 ring-red-200/80'
    case 'UNVERIFIED':
      return 'bg-sky-50 text-sky-800 ring-sky-200/80'
    case 'VERIFIED':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200/80'
    default:
      return 'bg-slate-50 text-slate-600 ring-slate-200'
  }
}

function sessionStatusLabel(session: CashDrawerSession): { label: string; chip: string } {
  if (session.status === 'OPEN') {
    return { label: 'Open', chip: statusChipClass('OPEN') }
  }
  if (session.status === 'REVIEW_NEEDED') {
    return { label: 'Review', chip: statusChipClass('REVIEW_NEEDED') }
  }
  if (session.verified_at) {
    return { label: 'Verified', chip: statusChipClass('VERIFIED') }
  }
  return { label: 'Unverified', chip: statusChipClass('UNVERIFIED') }
}

export default function AdminShiftLogPage() {
  const router = useRouter()
  const toast = useToast()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<CashDrawerSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  /** Monday-start week; list + export use this range */
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })
  const fromDate = format(weekStart, 'yyyy-MM-dd')
  const toDate = format(weekEnd, 'yyyy-MM-dd')
  const weekRangeLabel = `Week of ${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`
  const [statusFilter, setStatusFilter] = useState<string>('')
  /** '' | 'false' | 'true' — weekly Drop & Sales verification */
  const [verifiedFilter, setVerifiedFilter] = useState<string>('false')
  const [selectedSession, setSelectedSession] = useState<CashDrawerSession | null>(null)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showVerifyDialog, setShowVerifyDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [verifyNote, setVerifyNote] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDetailPanel, setShowDetailPanel] = useState(false)
  const [detailSession, setDetailSession] = useState<CashDrawerSession | null>(null)

  const editForm = useForm<EditForm>({
    resolver: zodResolver(editSchema),
  })

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const currentUser = await getCurrentUser()
        if (currentUser.role !== 'ADMIN' && currentUser.role !== 'MANAGER') {
          router.push('/dashboard')
          return
        }
        try {
          const info = await api.get('/company/info')
          if (info.data?.settings?.cash_drawer_enabled !== true) {
            router.replace('/dashboard')
            return
          }
        } catch {
          /* ignore — proceed if company info fails */
        }
        setUser(currentUser)
      } catch (error) {
        router.push('/login')
      } finally {
        setLoading(false)
      }
    }
    fetchUser()
  }, [router])

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      const params = new URLSearchParams({
        from_date: fromDate,
        to_date: toDate,
      })
      if (statusFilter) {
        params.append('status_filter', statusFilter)
      }
      if (verifiedFilter === 'true' || verifiedFilter === 'false') {
        params.append('verified', verifiedFilter)
      }
      const response = await api.get(`/admin/cash-drawers?${params.toString()}`)
      setSessions(response.data || [])
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to fetch shift sessions')
    } finally {
      setLoadingSessions(false)
    }
  }, [fromDate, toDate, statusFilter, verifiedFilter, toast])

  useEffect(() => {
    if (user) {
      fetchSessions()
    }
  }, [user, fetchSessions])

  const handleEdit = (session: CashDrawerSession) => {
    setSelectedSession(session)
    editForm.reset({
      start_cash_cents: (session.start_cash_cents / 100).toFixed(2),
      end_cash_cents: session.end_cash_cents ? (session.end_cash_cents / 100).toFixed(2) : '',
      reason: '',
    })
    setShowEditDialog(true)
  }

  const handleVerify = (session: CashDrawerSession) => {
    setSelectedSession(session)
    setVerifyNote('')
    setShowVerifyDialog(true)
  }

  const handleDelete = (session: CashDrawerSession) => {
    setSelectedSession(session)
    setShowDeleteDialog(true)
  }

  const handleViewFullDetails = (session: CashDrawerSession) => {
    setDetailSession(session)
    setShowDetailPanel(true)
  }

  const onSubmitDelete = async () => {
    if (!selectedSession) return

    setDeleting(true)
    try {
      await api.delete(`/admin/cash-drawers/${selectedSession.id}`)
      toast.success('Shift session deleted successfully')
      setShowDeleteDialog(false)
      setSelectedSession(null)
      fetchSessions()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to delete shift session')
    } finally {
      setDeleting(false)
    }
  }

  const onSubmitEdit = async (data: EditForm) => {
    if (!selectedSession) return

    try {
      const updateData: any = {
        reason: data.reason,
      }
      if (data.start_cash_cents) {
        updateData.start_cash_cents = Math.round(parseFloat(data.start_cash_cents) * 100)
      }
      if (data.end_cash_cents) {
        updateData.end_cash_cents = Math.round(parseFloat(data.end_cash_cents) * 100)
      }

      await api.put(`/admin/cash-drawers/${selectedSession.id}`, updateData)
      toast.success('Shift session updated successfully')
      setShowEditDialog(false)
      setSelectedSession(null)
      fetchSessions()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to update shift session')
    }
  }

  const onSubmitVerify = async () => {
    if (!selectedSession) return

    setVerifying(true)
    try {
      await api.post(`/admin/cash-drawers/${selectedSession.id}/verify`, {
        note: verifyNote || null,
      })
      toast.success('Drop & Sales verified')
      setShowVerifyDialog(false)
      setSelectedSession(null)
      setVerifyNote('')
      fetchSessions()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to verify session')
    } finally {
      setVerifying(false)
    }
  }

  const handleExport = async (format: 'pdf' | 'xlsx') => {
    if (!fromDate || !toDate) {
      toast.error('Please select both start and end dates')
      return
    }

    const previewWindow = format === 'pdf' ? openPreviewTab() : null
    setExporting(true)
    try {
      const params: Record<string, string> = {
        format,
        from_date: fromDate,
        to_date: toDate,
      }
      if (statusFilter) {
        params.status = statusFilter
      }

      const response = await api.get('/admin/cash-drawers/export', {
        params,
        responseType: 'blob',
      })

      const filename = `shift_log_${fromDate}_${toDate}.${format === 'pdf' ? 'pdf' : 'xlsx'}`
      const result = deliverExportBlob(response.data, filename, {
        previewInBrowser: format === 'pdf',
        previewWindow,
        mimeType:
          format === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      toast.success(
        format === 'pdf' && result.mode === 'preview'
          ? 'PDF opened in a new tab — use the browser to save or print'
          : `Drawer log exported as ${format.toUpperCase()}`
      )
    } catch (error: any) {
      if (previewWindow && !previewWindow.closed) {
        previewWindow.close()
      }
      toast.error(error.response?.data?.detail || 'Failed to export drawer log')
    } finally {
      setExporting(false)
    }
  }

  const formatCurrency = (cents: number | null) => {
    if (cents === null) return 'N/A'
    return `$${(cents / 100).toFixed(2)}`
  }

  const formatCurrencyOptional = (cents: number | null) => {
    if (cents === null || cents === undefined) return '$0.00'
    return `$${(cents / 100).toFixed(2)}`
  }

  const getDeltaColor = (deltaCents: number | null) => {
    if (deltaCents === null) return 'text-slate-500'
    if (deltaCents > 0) return 'text-emerald-600'
    if (deltaCents < 0) return 'text-red-600'
    return 'text-slate-900'
  }

  const forgotPunchCount = useMemo(
    () => sessions.filter((s) => isForgotPunchOutReview(s)).length,
    [sessions]
  )

  const sessionStats = useMemo(() => {
    const unverified = sessions.filter((s) => needsWeekVerify(s)).length
    const verified = sessions.filter((s) => Boolean(s.verified_at)).length
    const dropCents = sessions.reduce((sum, s) => sum + (s.drop_amount_cents ?? 0), 0)
    const salesCents = sessions.reduce((sum, s) => sum + (s.beverages_cash_cents ?? 0), 0)
    return {
      unverified,
      verified,
      total: sessions.length,
      dropCents,
      salesCents,
    }
  }, [sessions])

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
                    Logs · Cash drawer
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                      Drawer Log
                    </h1>
                    <InfoTip
                      label="About Drawer Log"
                      content="Each week, verify Drop and Sales on every finished session. Open shifts stay unverifiable until closed."
                      buttonClassName="border-slate-500 text-slate-300 hover:border-slate-300 hover:bg-white/10 hover:text-white"
                    />
                  </div>
                  <p className="mt-2 max-w-md text-sm text-slate-300 leading-relaxed">
                    End-of-week check: confirm Drop and Sales for each finished drawer session.
                  </p>
                  <p className="mt-3 text-sm font-medium text-teal-200/90 tabular-nums">
                    {weekRangeLabel}
                  </p>
                </div>
                <div className="flex flex-col items-stretch sm:items-end gap-3 shrink-0">
                  {sessionStats.unverified > 0 && verifiedFilter !== 'true' && (
                    <div className="sm:text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                        Unverified
                      </p>
                      <p className="mt-1 text-3xl sm:text-4xl font-semibold tabular-nums tracking-tight leading-none text-amber-200">
                        {sessionStats.unverified}
                      </p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleExport('pdf')}
                      disabled={exporting}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm font-medium text-slate-100 hover:bg-white/10 disabled:opacity-50"
                    >
                      View PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExport('xlsx')}
                      disabled={exporting}
                      className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 shadow-sm"
                    >
                      Export Excel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Unverified"
              value={sessionStats.unverified}
              hint="Awaiting check"
              tone="warning"
            />
            <StatCard
              label="Verified"
              value={sessionStats.verified}
              hint="Confirmed"
              tone="success"
            />
            <StatCard
              label="Drop"
              value={formatCurrencyOptional(sessionStats.dropCents)}
              hint="Week total"
            />
            <StatCard
              label="Sales"
              value={formatCurrency(sessionStats.salesCents)}
              hint="Marketplace"
            />
          </div>

          {forgotPunchCount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <span className="font-semibold">
                {forgotPunchCount} forgot punch-out{forgotPunchCount === 1 ? '' : 's'}
              </span>
              <InfoTip
                label="About forgot punch-out"
                content="Employee missed punch-out; drawer was auto-closed without an ending count. Verify Drop & Sales to close it."
              />
            </div>
          )}

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="inline-flex rounded-xl border border-slate-200 p-1 bg-slate-50/80">
                {(
                  [
                    { value: 'false', label: 'Unverified' },
                    { value: 'true', label: 'Verified' },
                    { value: '', label: 'All' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setVerifiedFilter(opt.value)}
                    className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
                      verifiedFilter === opt.value
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                This week
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 mb-1.5">
                  Week
                </label>
                <div className="flex items-center rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                  <button
                    type="button"
                    onClick={() => setWeekStart((w) => addWeeks(w, -1))}
                    className="p-2.5 text-slate-600 hover:bg-slate-50"
                    aria-label="Previous week"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <div className="flex-1 px-3 py-2.5 border-x border-slate-200 bg-white text-center">
                    <span className="text-sm font-semibold text-slate-900 tabular-nums">
                      {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWeekStart((w) => addWeeks(w, 1))}
                    className="p-2.5 text-slate-600 hover:bg-slate-50"
                    aria-label="Next week"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 mb-1.5">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
                >
                  <option value="">All statuses</option>
                  <option value="OPEN">Open</option>
                  <option value="CLOSED">Closed</option>
                  <option value="REVIEW_NEEDED">Needs review</option>
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-900">Sessions</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {sessionStats.total === 0
                  ? 'No sessions match these filters'
                  : `${sessionStats.total} session${sessionStats.total === 1 ? '' : 's'}`}
              </p>
            </div>

            {loadingSessions ? (
              <div className="p-4 space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <p className="text-sm font-semibold text-slate-800">No sessions found</p>
                <p className="mt-1 text-sm text-slate-500">
                  {verifiedFilter === 'false'
                    ? 'All finished sessions are verified for this week'
                    : 'Try another week or filter'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full table-fixed min-w-[880px]">
                  <colgroup>
                    <col className="w-[120px]" />
                    <col />
                    <col className="w-[96px]" />
                    <col className="w-[96px]" />
                    <col className="w-[96px]" />
                    <col className="w-[96px]" />
                    <col className="w-[108px]" />
                    <col className="w-[200px]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Date
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Employee
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Start
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        After drop
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Drop
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Sales
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Status
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sessions
                      .slice()
                      .sort(
                        (a, b) =>
                          new Date(b.start_counted_at).getTime() -
                          new Date(a.start_counted_at).getTime()
                      )
                      .map((session) => {
                        const chip = sessionStatusLabel(session)
                        const forgot = isForgotPunchOutReview(session)
                        const canVerify = needsWeekVerify(session)
                        const discrepancy = hasBalanceDiscrepancy(session)
                        return (
                          <tr
                            key={session.id}
                            className={`border-l-4 transition-colors ${
                              discrepancy
                                ? 'border-l-red-400 bg-red-50/70 hover:bg-red-50'
                                : forgot
                                  ? 'border-l-amber-300 bg-amber-50/40 hover:bg-amber-50/70'
                                  : 'border-l-transparent hover:bg-slate-50/90'
                            }`}
                          >
                            <td className="px-4 py-3.5 align-middle text-left text-sm text-slate-700 tabular-nums whitespace-nowrap">
                              {format(new Date(session.start_counted_at), 'MMM d')}
                              {session.clock_in_at && (
                                <span className="block text-xs text-slate-400">
                                  {format(new Date(session.clock_in_at), 'h:mma')}
                                  {session.clock_out_at
                                    ? ` – ${format(new Date(session.clock_out_at), 'h:mma')}`
                                    : ''}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3.5 align-middle text-left">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                                  {initials(session.employee_name)}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-900">
                                    {session.employee_name}
                                  </p>
                                  {forgot && (
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                      Forgot out
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 align-middle text-right text-sm tabular-nums text-slate-900">
                              {formatCurrency(session.start_cash_cents)}
                            </td>
                            <td className="px-4 py-3.5 align-middle text-right text-sm tabular-nums text-slate-900">
                              {formatCurrency(session.end_cash_cents)}
                            </td>
                            <td className="px-4 py-3.5 align-middle text-right text-sm font-semibold tabular-nums text-slate-900">
                              {formatCurrencyOptional(session.drop_amount_cents)}
                            </td>
                            <td className="px-4 py-3.5 align-middle text-right text-sm font-semibold tabular-nums text-slate-900">
                              {formatCurrency(session.beverages_cash_cents)}
                            </td>
                            <td className="px-4 py-3.5 align-middle text-left">
                              <span
                                className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${chip.chip}`}
                              >
                                {chip.label}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 align-middle text-right">
                              <div className="ml-auto flex w-[176px] items-center justify-end gap-1">
                                {canVerify ? (
                                  <button
                                    type="button"
                                    onClick={() => handleVerify(session)}
                                    className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                                  >
                                    Verify
                                  </button>
                                ) : (
                                  <span className="invisible rounded-lg px-2.5 py-1.5 text-xs font-semibold">
                                    Verify
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleViewFullDetails(session)}
                                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  Details
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleEdit(session)}
                                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                  title="Edit"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(session)}
                                  className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                                  title="Delete"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {showDetailPanel && detailSession && (
          <div className="fixed inset-0 z-50 overflow-hidden">
            <div
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
              onClick={() => {
                setShowDetailPanel(false)
                setDetailSession(null)
              }}
            />
            <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
              <div className="flex w-screen max-w-lg flex-col overflow-hidden bg-white shadow-2xl">
                <div className="shrink-0 border-b border-slate-800/10 bg-slate-900 px-5 py-4 text-white">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                        Drawer detail
                      </p>
                      <h2 className="mt-1 truncate text-xl font-semibold tracking-tight">
                        {detailSession.employee_name}
                      </h2>
                      <p className="mt-1 text-sm text-slate-300">
                        {format(new Date(detailSession.start_counted_at), 'EEEE, MMM d, yyyy')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDetailPanel(false)
                        setDetailSession(null)
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

                <div className="flex-1 space-y-5 overflow-y-auto p-5">
                  {isForgotPunchOutReview(detailSession) && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <p className="font-semibold">Forgot punch-out</p>
                        <InfoTip
                          label="About forgot punch-out"
                          content="Shift was auto clocked out at the scheduled end. Cash drawer was deactivated without an ending count."
                        />
                      </div>
                      {needsWeekVerify(detailSession) && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowDetailPanel(false)
                            handleVerify(detailSession)
                          }}
                          className="shrink-0 rounded-lg bg-amber-900/90 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-950"
                        >
                          Verify
                        </button>
                      )}
                    </div>
                  )}

                  {needsWeekVerify(detailSession) && !isForgotPunchOutReview(detailSession) && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-200/80 bg-sky-50 px-4 py-3 text-sm text-sky-950">
                      <p className="font-semibold">Awaiting Drop & Sales verification</p>
                      <button
                        type="button"
                        onClick={() => {
                          setShowDetailPanel(false)
                          handleVerify(detailSession)
                        }}
                        className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                      >
                        Verify
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Status
                      </p>
                      {(() => {
                        const chip = sessionStatusLabel(detailSession)
                        return (
                          <span
                            className={`mt-1.5 inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${chip.chip}`}
                          >
                            {chip.label}
                          </span>
                        )
                      })()}
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Clock
                      </p>
                      <p className="mt-1.5 text-sm font-medium text-slate-900 tabular-nums">
                        {detailSession.clock_in_at ? (
                          <>
                            {format(new Date(detailSession.clock_in_at), 'h:mm a')}
                            <span className="text-slate-400"> – </span>
                            {detailSession.clock_out_at ? (
                              format(new Date(detailSession.clock_out_at), 'h:mm a')
                            ) : (
                              <span className="text-amber-600">Open</span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Cash drawer
                    </p>
                    <dl className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50/60 px-4 py-3 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Starting</dt>
                        <dd className="font-medium tabular-nums text-slate-900">
                          {formatCurrency(detailSession.start_cash_cents)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Current cash</dt>
                        <dd className="font-medium tabular-nums text-slate-900">
                          {formatCurrencyOptional(detailSession.current_cash_cents)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3 rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-200/80">
                        <dt className="font-medium text-slate-700">Drop</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">
                          {formatCurrencyOptional(detailSession.drop_amount_cents)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">After drop</dt>
                        <dd className="font-medium tabular-nums text-slate-900">
                          {detailSession.end_cash_cents == null
                            ? '—'
                            : formatCurrency(detailSession.end_cash_cents)}
                        </dd>
                      </div>
                      {detailSession.expected_balance_cents != null && (
                        <div className="flex justify-between gap-3 text-xs text-slate-500">
                          <dt>Expected (current − drop)</dt>
                          <dd className="tabular-nums">
                            {formatCurrency(detailSession.expected_balance_cents)}
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between gap-3 rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-200/80">
                        <dt className="font-medium text-slate-700">Sales</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">
                          {formatCurrency(detailSession.beverages_cash_cents)}
                        </dd>
                      </div>
                      {(detailSession.marketplace_cash_cents != null ||
                        detailSession.marketplace_card_cents != null) && (
                        <div className="flex justify-between gap-3 px-2 text-xs text-slate-500">
                          <span>
                            Cash{' '}
                            <span className="font-medium tabular-nums text-emerald-700">
                              {formatCurrency(detailSession.marketplace_cash_cents ?? 0)}
                            </span>
                          </span>
                          <span>
                            Card{' '}
                            <span className="font-medium tabular-nums text-sky-700">
                              {formatCurrency(detailSession.marketplace_card_cents ?? 0)}
                            </span>
                          </span>
                        </div>
                      )}
                      {detailSession.marketplace_sales &&
                        detailSession.marketplace_sales.length > 0 && (
                          <ul className="mt-1 space-y-1 rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-xs text-slate-600">
                            {detailSession.marketplace_sales
                              .filter((row) => (row.qty || 0) > 0)
                              .map((row) => (
                                <li
                                  key={`${row.id}-${row.payment || 'cash'}`}
                                  className="flex justify-between gap-2"
                                >
                                  <span>
                                    {row.label} × {row.qty}
                                    <span
                                      className={`ml-1 ${
                                        row.payment === 'card'
                                          ? 'text-sky-600'
                                          : 'text-emerald-600'
                                      }`}
                                    >
                                      ({row.payment === 'card' ? 'card' : 'cash'})
                                    </span>
                                  </span>
                                  <span className="font-medium tabular-nums text-slate-800">
                                    {formatCurrency(row.qty * row.price_cents)}
                                  </span>
                                </li>
                              ))}
                          </ul>
                        )}
                      <div className="flex justify-between gap-3 border-t border-slate-200/80 pt-2">
                        <dt className="font-medium text-slate-600">Difference</dt>
                        <dd
                          className={`font-semibold tabular-nums ${getDeltaColor(detailSession.delta_cents)}`}
                        >
                          {detailSession.delta_cents != null
                            ? detailSession.delta_cents > 0
                              ? `+${formatCurrency(detailSession.delta_cents)}`
                              : formatCurrency(detailSession.delta_cents)
                            : '—'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showEditDialog && selectedSession && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="border-b border-slate-800/10 bg-slate-900 px-5 py-4 text-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      Edit session
                    </p>
                    <h3 className="mt-1 text-xl font-semibold tracking-tight">
                      {selectedSession.employee_name}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditDialog(false)
                      setSelectedSession(null)
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
              <form onSubmit={editForm.handleSubmit(onSubmitEdit)} className="p-5">
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Start cash ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      {...editForm.register('start_cash_cents')}
                      className="block w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm shadow-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      End cash ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      {...editForm.register('end_cash_cents')}
                      className="block w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm shadow-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Reason *
                    </label>
                    <textarea
                      {...editForm.register('reason')}
                      rows={3}
                      className="block w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm shadow-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                      placeholder="Enter reason for editing"
                    />
                    {editForm.formState.errors.reason && (
                      <p className="mt-1 text-sm text-red-600">
                        {editForm.formState.errors.reason.message}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-6 flex gap-3 border-t border-slate-100 pt-5">
                  <button
                    type="submit"
                    className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    Save changes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditDialog(false)
                      setSelectedSession(null)
                    }}
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <ConfirmationDialog
          isOpen={showDeleteDialog}
          onCancel={() => {
            setShowDeleteDialog(false)
            setSelectedSession(null)
          }}
          onConfirm={onSubmitDelete}
          title="Delete Shift Session"
          message="Are you sure you want to delete this shift session? This action cannot be undone."
          confirmText="Delete"
          cancelText="Cancel"
          type="error"
        />

        {showVerifyDialog && selectedSession && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="border-b border-slate-800/10 bg-slate-900 px-5 py-4 text-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      Verify Drop & Sales
                    </p>
                    <h3 className="mt-1 text-xl font-semibold tracking-tight">
                      {selectedSession.employee_name}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowVerifyDialog(false)
                      setSelectedSession(null)
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
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  onSubmitVerify()
                }}
                className="p-5"
              >
                <div className="mb-5 space-y-4">
                  {isForgotPunchOutReview(selectedSession) && (
                    <div className="flex items-center gap-1.5 rounded-xl border border-amber-200/80 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
                      <p className="font-semibold">Forgot punch-out</p>
                      <InfoTip
                        label="About forgot punch-out"
                        content="Confirming also closes this session and clears the review flag."
                      />
                    </div>
                  )}
                  {selectedSession.status === 'REVIEW_NEEDED' &&
                    !isForgotPunchOutReview(selectedSession) && (
                      <div className="rounded-xl border border-red-200/80 bg-red-50 px-4 py-2.5 text-sm text-red-900">
                        Variance flagged — verifying will close this session.
                      </div>
                    )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Drop
                      </p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                        {formatCurrencyOptional(selectedSession.drop_amount_cents)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Sales
                      </p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                        {formatCurrency(selectedSession.beverages_cash_cents)}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-xl border border-slate-200/80 bg-white px-4 py-3 text-sm">
                    <p className="text-slate-500">
                      Date:{' '}
                      <span className="font-semibold text-slate-900">
                        {format(new Date(selectedSession.start_counted_at), 'EEEE, MMM d, yyyy')}
                      </span>
                    </p>
                    <p className="text-slate-500">
                      Clock:{' '}
                      <span className="font-semibold tabular-nums text-slate-900">
                        {selectedSession.clock_in_at
                          ? format(new Date(selectedSession.clock_in_at), 'h:mm a')
                          : '—'}
                        {' – '}
                        {selectedSession.clock_out_at
                          ? format(new Date(selectedSession.clock_out_at), 'h:mm a')
                          : 'Open'}
                      </span>
                    </p>
                    <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-slate-500">
                      <p className="flex justify-between">
                        <span>Start</span>
                        <span className="font-medium tabular-nums text-slate-800">
                          {formatCurrency(selectedSession.start_cash_cents)}
                        </span>
                      </p>
                      <p className="flex justify-between">
                        <span>Current</span>
                        <span className="font-medium tabular-nums text-slate-800">
                          {formatCurrencyOptional(selectedSession.current_cash_cents)}
                        </span>
                      </p>
                      <p className="flex justify-between">
                        <span>Drop</span>
                        <span className="font-medium tabular-nums text-slate-800">
                          {formatCurrencyOptional(selectedSession.drop_amount_cents)}
                        </span>
                      </p>
                      <p className="flex justify-between">
                        <span>After drop</span>
                        <span className="font-medium tabular-nums text-slate-800">
                          {selectedSession.end_cash_cents == null
                            ? 'Not counted'
                            : formatCurrency(selectedSession.end_cash_cents)}
                        </span>
                      </p>
                      <p className="flex justify-between">
                        <span>Delta</span>
                        <span
                          className={`font-medium tabular-nums ${getDeltaColor(selectedSession.delta_cents)}`}
                        >
                          {selectedSession.delta_cents == null
                            ? '—'
                            : formatCurrency(selectedSession.delta_cents)}
                        </span>
                      </p>
                    </div>
                    {selectedSession.review_note && (
                      <p className="flex items-center gap-1.5 border-t border-slate-100 pt-2 text-slate-500">
                        <span>Warning</span>
                        <InfoTip content={selectedSession.review_note} label="Warning details" />
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Note (optional)
                    </label>
                    <textarea
                      value={verifyNote}
                      onChange={(e) => setVerifyNote(e.target.value)}
                      rows={2}
                      className="block w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm shadow-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                      placeholder="Optional note for this verification"
                    />
                  </div>
                </div>
                <div className="flex gap-3 border-t border-slate-100 pt-5">
                  <button
                    type="submit"
                    disabled={verifying}
                    className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {verifying ? 'Verifying…' : 'Confirm verified'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowVerifyDialog(false)
                      setSelectedSession(null)
                    }}
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
