'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Layout from '@/components/Layout'
import PageAtmosphere from '@/components/PageAtmosphere'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import logger from '@/lib/logger'
import { format, parseISO, differenceInCalendarDays } from 'date-fns'

interface LeaveRequest {
  id: string
  employee_name: string
  type: string
  start_date: string
  end_date: string
  status: string
  reason: string | null
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected'

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function formatLeaveType(type: string) {
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDate(value: string) {
  try {
    return format(parseISO(value), 'MMM d, yyyy')
  } catch {
    return value
  }
}

function daySpan(start: string, end: string) {
  try {
    const days = differenceInCalendarDays(parseISO(end), parseISO(start)) + 1
    return days === 1 ? '1 day' : `${days} days`
  } catch {
    return '—'
  }
}

function statusStyles(status: string) {
  switch (status) {
    case 'approved':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200/80'
    case 'rejected':
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
  value: number
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

export default function AdminLeavePage() {
  const toast = useToast()
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [processing, setProcessing] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null)
  const [rejectComment, setRejectComment] = useState('')

  useEffect(() => {
    fetchRequests()
  }, [])

  const fetchRequests = async () => {
    setLoading(true)
    try {
      const response = await api.get('/leave/admin/leave')
      setRequests(response.data.requests || [])
    } catch (error) {
      logger.error('Failed to fetch leave requests', error as Error, {
        endpoint: '/leave/admin/leave',
      })
      toast.error('Could not load leave requests')
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (id: string) => {
    setProcessing(id)
    try {
      await api.put(`/leave/admin/leave/${id}/approve`, {})
      toast.success('Leave request approved')
      fetchRequests()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to approve request')
    } finally {
      setProcessing(null)
    }
  }

  const openReject = (request: LeaveRequest) => {
    setRejectTarget(request)
    setRejectComment('')
  }

  const closeReject = () => {
    if (processing) return
    setRejectTarget(null)
    setRejectComment('')
  }

  const confirmReject = async () => {
    if (!rejectTarget) return
    const id = rejectTarget.id
    setProcessing(id)
    try {
      const comment = rejectComment.trim()
      await api.put(`/leave/admin/leave/${id}/reject`, {
        review_comment: comment || null,
      })
      toast.success('Leave request rejected')
      setRejectTarget(null)
      setRejectComment('')
      fetchRequests()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to reject request')
    } finally {
      setProcessing(null)
    }
  }

  const stats = useMemo(() => {
    const pending = requests.filter((r) => r.status === 'pending').length
    const approved = requests.filter((r) => r.status === 'approved').length
    const rejected = requests.filter((r) => r.status === 'rejected').length
    return { total: requests.length, pending, approved, rejected }
  }, [requests])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return requests.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (!q) return true
      return (
        r.employee_name.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        (r.reason || '').toLowerCase().includes(q)
      )
    })
  }, [requests, statusFilter, searchQuery])

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
              <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Team · Time off
                  </p>
                  <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight">
                    Leave requests
                  </h1>
                  <p className="mt-2 max-w-lg text-sm text-slate-300 leading-relaxed">
                    Review pending time off, approve what looks right, and keep the schedule in sync.
                  </p>
                </div>
                {stats.pending > 0 && (
                  <div className="shrink-0 sm:text-right">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      Awaiting review
                    </p>
                    <p className="mt-2 text-3xl sm:text-4xl font-semibold tabular-nums tracking-tight leading-none text-amber-200">
                      {stats.pending}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Total" value={stats.total} hint="All requests" />
            <StatCard
              label="Pending"
              value={stats.pending}
              hint={stats.pending > 0 ? 'Needs action' : 'All clear'}
              tone="warning"
            />
            <StatCard
              label="Approved"
              value={stats.approved}
              hint="Confirmed time off"
              tone="success"
            />
            <StatCard
              label="Rejected"
              value={stats.rejected}
              hint="Declined"
              tone="danger"
            />
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
                placeholder="Search employee, type, or reason…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
                aria-label="Search leave requests"
              />
            </div>
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStatusFilter(f)}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                    statusFilter === f
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Inbox</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {filtered.length} {filtered.length === 1 ? 'request' : 'requests'}
                  {statusFilter !== 'all' || searchQuery.trim() ? ' matching filters' : ''}
                </p>
              </div>
            </div>

            {loading ? (
              <div className="p-4 space-y-2" role="status" aria-label="Loading">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
                  <svg
                    className="h-6 w-6 text-slate-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7V3m8 4V3M5 11h14M5 19h14M5 11a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2v-8z"
                    />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-slate-800">No leave requests found</p>
                <p className="mt-1 text-sm text-slate-400">Try adjusting search or filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80">
                      <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Employee
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Type
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Dates
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Duration
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Status
                      </th>
                      <th className="px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((request) => {
                      const pending = request.status === 'pending'
                      const busy = processing === request.id
                      return (
                        <tr
                          key={request.id}
                          className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80 transition-colors"
                        >
                          <td className="px-5 py-3.5 align-middle">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xs font-semibold text-white shadow-sm">
                                {initials(request.employee_name)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900 truncate">
                                  {request.employee_name}
                                </p>
                                {request.reason ? (
                                  <p className="mt-0.5 text-xs text-slate-500 truncate max-w-[220px]">
                                    {request.reason}
                                  </p>
                                ) : (
                                  <p className="mt-0.5 text-xs text-slate-400">No reason given</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 align-middle text-center">
                            <span className="inline-flex text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200/80">
                              {formatLeaveType(request.type)}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 align-middle text-center text-xs text-slate-600">
                            <span className="font-medium text-slate-800">
                              {formatDate(request.start_date)}
                            </span>
                            <span className="mx-1.5 text-slate-300">→</span>
                            <span className="font-medium text-slate-800">
                              {formatDate(request.end_date)}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 align-middle text-center text-sm font-medium text-slate-800 tabular-nums">
                            {daySpan(request.start_date, request.end_date)}
                          </td>
                          <td className="px-4 py-3.5 align-middle text-center">
                            <span
                              className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-md ring-1 ring-inset capitalize ${statusStyles(request.status)}`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  request.status === 'approved'
                                    ? 'bg-emerald-500'
                                    : request.status === 'rejected'
                                      ? 'bg-red-500'
                                      : 'bg-amber-400'
                                }`}
                              />
                              {request.status}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 align-middle text-center">
                            {pending ? (
                              <div className="inline-flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleApprove(request.id)}
                                  disabled={busy}
                                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                                >
                                  {busy ? '…' : 'Approve'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openReject(request)}
                                  disabled={busy}
                                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 disabled:opacity-50 transition-all"
                                >
                                  Reject
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
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
      </div>

      {rejectTarget &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
            role="presentation"
            onClick={closeReject}
          >
            <div
              className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
              role="dialog"
              aria-modal="true"
              aria-labelledby="reject-leave-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="reject-leave-title" className="text-sm font-semibold text-slate-900">
                Reject leave request
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Reject {rejectTarget.employee_name}&apos;s {formatLeaveType(rejectTarget.type)}{' '}
                request ({formatDate(rejectTarget.start_date)} – {formatDate(rejectTarget.end_date)}
                ). An optional note is sent to the employee.
              </p>
              <label className="mt-4 block">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Reason (optional)
                </span>
                <textarea
                  value={rejectComment}
                  onChange={(e) => setRejectComment(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="e.g. Overlapping coverage needed that week"
                  className="mt-1.5 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                />
              </label>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={closeReject}
                  disabled={processing === rejectTarget.id}
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmReject}
                  disabled={processing === rejectTarget.id}
                  className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {processing === rejectTarget.id ? 'Rejecting…' : 'Reject'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </Layout>
  )
}
