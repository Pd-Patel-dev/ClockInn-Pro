'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser, User } from '@/lib/auth'
import { format } from 'date-fns'
import { useToast } from '@/components/Toast'
import ConfirmationDialog from '@/components/ConfirmationDialog'
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
  collected_cash_cents: number | null
  drop_amount_cents: number | null
  beverages_cash_cents: number | null
  expected_balance_cents: number | null
  delta_cents: number | null
  status: 'OPEN' | 'CLOSED' | 'REVIEW_NEEDED'
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  created_at: string
  clock_in_at: string | null
  clock_out_at: string | null
}

const editSchema = z.object({
  start_cash_cents: z.string().optional(),
  end_cash_cents: z.string().optional(),
  reason: z.string().min(1, 'Reason is required'),
})

type EditForm = z.infer<typeof editSchema>

export default function AdminShiftLogPage() {
  const router = useRouter()
  const toast = useToast()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<CashDrawerSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [fromDate, setFromDate] = useState(format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'))
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [selectedSession, setSelectedSession] = useState<CashDrawerSession | null>(null)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showReviewDialog, setShowReviewDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [reviewNote, setReviewNote] = useState('')
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDetailPanel, setShowDetailPanel] = useState(false)
  const [detailSession, setDetailSession] = useState<CashDrawerSession | null>(null)
  const [shiftNoteDetail, setShiftNoteDetail] = useState<{
    content: string
    beverage_sold?: number | null
    clock_in_at: string | null
    clock_out_at: string | null
  } | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const editForm = useForm<EditForm>({
    resolver: zodResolver(editSchema),
  })

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const currentUser = await getCurrentUser()
        if (currentUser.role !== 'ADMIN') {
          router.push('/dashboard')
          return
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
        params.append('status', statusFilter)
      }
      const response = await api.get(`/admin/cash-drawers?${params.toString()}`)
      setSessions(response.data || [])
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to fetch shift sessions')
    } finally {
      setLoadingSessions(false)
    }
  }, [fromDate, toDate, statusFilter, toast])

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

  const handleReview = (session: CashDrawerSession) => {
    setSelectedSession(session)
    setReviewNote('')
    setShowReviewDialog(true)
  }

  const handleDelete = (session: CashDrawerSession) => {
    setSelectedSession(session)
    setShowDeleteDialog(true)
  }

  const handleViewFullDetails = async (session: CashDrawerSession) => {
    setDetailSession(session)
    setShiftNoteDetail(null)
    setShowDetailPanel(true)
    setLoadingDetail(true)
    try {
      const res = await api.get(`/admin/shift-notes/by-time-entry/${session.time_entry_id}`)
      setShiftNoteDetail({
        content: (res.data as any).content ?? '',
        beverage_sold: (res.data as any).beverage_sold,
        clock_in_at: (res.data as any).clock_in_at ?? null,
        clock_out_at: (res.data as any).clock_out_at ?? null,
      })
    } catch {
      setShiftNoteDetail(null)
    } finally {
      setLoadingDetail(false)
    }
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

  const onSubmitReview = async () => {
    if (!selectedSession) return

    try {
      await api.post(`/admin/cash-drawers/${selectedSession.id}/review`, {
        note: reviewNote,
        status: 'CLOSED',
      })
      toast.success('Shift session reviewed successfully')
      setShowReviewDialog(false)
      setSelectedSession(null)
      setReviewNote('')
      fetchSessions()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to review shift session')
    }
  }

  const handleExport = async (format: 'pdf' | 'xlsx') => {
    setExporting(true)
    try {
      if (!fromDate || !toDate) {
        toast.error('Please select both start and end dates')
        return
      }

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

      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `shift_log_${fromDate}_${toDate}.${format === 'pdf' ? 'pdf' : 'xlsx'}`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      toast.success(`Shift log exported as ${format.toUpperCase()}`)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to export shift log')
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
    if (deltaCents === null) return 'text-gray-500'
    if (deltaCents > 0) return 'text-green-600'
    if (deltaCents < 0) return 'text-red-600'
    return 'text-gray-900'
  }

  const getStatusBadge = (status: string) => {
    const styles = {
      OPEN: 'bg-yellow-100 text-yellow-800',
      CLOSED: 'bg-green-100 text-green-800',
      REVIEW_NEEDED: 'bg-red-100 text-red-800',
    }
    return styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800'
  }

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="px-4 py-8 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">Shift Log</h1>
            <p className="text-sm text-gray-600">View everything for each shift. Click a row to open full details (clock in/out, cash drawer, beverages, shift notes).</p>
          </div>

          {/* Filters */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">From Date</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">To Date</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                >
                  <option value="">All</option>
                  <option value="OPEN">Open</option>
                  <option value="CLOSED">Closed</option>
                  <option value="REVIEW_NEEDED">Review Needed</option>
                </select>
              </div>
              <div className="flex items-end gap-2">
                <button
                  onClick={() => handleExport('pdf')}
                  disabled={exporting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm disabled:opacity-50"
                >
                  {exporting ? 'Exporting...' : 'Export PDF'}
                </button>
                <button
                  onClick={() => handleExport('xlsx')}
                  disabled={exporting}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium text-sm disabled:opacity-50"
                >
                  {exporting ? 'Exporting...' : 'Export Excel'}
                </button>
              </div>
            </div>
          </div>

          {/* Sessions Table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Employee</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Shift</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Start</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">End</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Cash collected</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Drop</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase" title="Total beverage sales for the shift (all payment types)">Beverages Sold</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase" title="Start + Collected - Drop (beverages not included)">Balance</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">+/-</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loadingSessions ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
                    </td>
                  </tr>
                ) : sessions.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-8 text-center text-gray-500 text-sm">
                      No shift sessions found
                    </td>
                  </tr>
                ) : (
                  sessions.map((session) => (
                    <tr
                      key={session.id}
                      onClick={() => handleViewFullDetails(session)}
                      className="hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-3 py-2 text-sm text-gray-900 text-center">
                        {format(new Date(session.start_counted_at), 'MM/dd/yy')}
                      </td>
                      <td className="px-3 py-2 text-sm font-medium text-gray-900 text-center">
                        {session.employee_name}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600 text-center">
                        {session.clock_in_at ? (
                          <>
                            {format(new Date(session.clock_in_at), 'h:mma')}
                            {session.clock_out_at ? (
                              <span className="text-gray-400"> - {format(new Date(session.clock_out_at), 'h:mma')}</span>
                            ) : (
                              <span className="text-yellow-600"> (open)</span>
                            )}
                          </>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-900 text-center">
                        {formatCurrency(session.start_cash_cents)}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-900 text-center">
                        {formatCurrency(session.end_cash_cents)}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-900 text-center">
                        {formatCurrency(session.collected_cash_cents)}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-900 text-center">
                        {formatCurrencyOptional(session.drop_amount_cents)}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-900 text-center">
                        {formatCurrency(session.beverages_cash_cents)}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-900 text-center font-medium" title="Start + Collected - Drop">
                        {formatCurrency(session.expected_balance_cents)}
                      </td>
                      <td className={`px-3 py-2 text-sm font-medium text-center ${getDeltaColor(session.delta_cents)}`}>
                        {session.delta_cents !== null ? (
                          session.delta_cents > 0 ? `+${formatCurrency(session.delta_cents)}` : formatCurrency(session.delta_cents)
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusBadge(session.status)}`}>
                          {session.status === 'REVIEW_NEEDED' ? 'Review' : session.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleViewFullDetails(session); }}
                            className="p-1 text-gray-600 hover:bg-gray-100 rounded"
                            title="View full shift details"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEdit(session); }}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                            title="Edit"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          {session.status === 'REVIEW_NEEDED' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleReview(session); }}
                              className="p-1 text-green-600 hover:bg-green-50 rounded"
                              title="Review"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(session); }}
                            className="p-1 text-red-600 hover:bg-red-50 rounded"
                            title="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Full shift details panel */}
          {showDetailPanel && detailSession && (
            <div className="fixed inset-0 z-50 overflow-hidden">
              <div className="absolute inset-0 bg-gray-600 bg-opacity-50" onClick={() => { setShowDetailPanel(false); setDetailSession(null); setShiftNoteDetail(null); }} />
              <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
                <div className="w-screen max-w-lg bg-white shadow-xl overflow-y-auto">
                  <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                    <h2 className="text-lg font-semibold text-gray-900">Shift details</h2>
                    <button
                      type="button"
                      onClick={() => { setShowDetailPanel(false); setDetailSession(null); setShiftNoteDetail(null); }}
                      className="text-gray-400 hover:text-gray-600 rounded p-1"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  <div className="px-6 py-4 space-y-6">
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Employee &amp; date</h3>
                      <p className="text-base font-medium text-gray-900">{detailSession.employee_name}</p>
                      <p className="text-sm text-gray-600">{format(new Date(detailSession.start_counted_at), 'EEEE, MMM d, yyyy')}</p>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Clock in / Clock out</h3>
                      <p className="text-sm text-gray-900">
                        {detailSession.clock_in_at ? (
                          <>
                            <span className="font-medium">{format(new Date(detailSession.clock_in_at), 'h:mm a')}</span>
                            <span className="text-gray-500"> – </span>
                            {detailSession.clock_out_at ? (
                              <span className="font-medium">{format(new Date(detailSession.clock_out_at), 'h:mm a')}</span>
                            ) : (
                              <span className="text-amber-600">Open</span>
                            )}
                          </>
                        ) : '—'}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Cash drawer</h3>
                      <dl className="grid grid-cols-1 gap-2 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-gray-600">Starting balance</dt>
                          <dd className="font-medium text-gray-900">{formatCurrency(detailSession.start_cash_cents)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-gray-600">Cash collected</dt>
                          <dd className="font-medium text-gray-900">{formatCurrency(detailSession.collected_cash_cents)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-gray-600">Drop amount</dt>
                          <dd className="font-medium text-gray-900">{formatCurrencyOptional(detailSession.drop_amount_cents)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-gray-600">Amount of beverages sold</dt>
                          <dd className="font-medium text-gray-900">{formatCurrency(detailSession.beverages_cash_cents)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-gray-600">Ending balance</dt>
                          <dd className="font-medium text-gray-900">{formatCurrency(detailSession.end_cash_cents)}</dd>
                        </div>
                        <div className="flex justify-between pt-1 border-t border-gray-100">
                          <dt className="text-gray-600">Difference (+/-)</dt>
                          <dd className={`font-medium ${getDeltaColor(detailSession.delta_cents)}`}>
                            {detailSession.delta_cents != null ? (
                              detailSession.delta_cents > 0 ? `+${formatCurrency(detailSession.delta_cents)}` : formatCurrency(detailSession.delta_cents)
                            ) : '—'}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Shift notes</h3>
                      {loadingDetail ? (
                        <div className="py-8 flex justify-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
                        </div>
                      ) : shiftNoteDetail?.content ? (
                        <pre className="whitespace-pre-wrap break-words font-sans text-sm text-gray-800 bg-gray-50 rounded-lg p-4 border border-gray-200 max-h-64 overflow-y-auto overflow-x-hidden">
                          {/* User-supplied: text only (React escapes). Do not use dangerouslySetInnerHTML. */}
                          {shiftNoteDetail.content}
                        </pre>
                      ) : (
                        <p className="text-sm text-gray-500 italic">No shift note for this shift.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Edit Dialog */}
          {showEditDialog && selectedSession && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
              <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md m-4">
                <div className="flex justify-between items-center px-8 py-6 border-b border-gray-200">
                  <h3 className="text-xl font-bold text-gray-900">Edit Shift Session</h3>
                  <button
                    onClick={() => {
                      setShowEditDialog(false)
                      setSelectedSession(null)
                    }}
                    className="text-gray-400 hover:text-gray-600 text-3xl leading-none"
                  >
                    ×
                  </button>
                </div>
                <form onSubmit={editForm.handleSubmit(onSubmitEdit)} className="p-8">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Start Cash ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        {...editForm.register('start_cash_cents')}
                        className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">End Cash ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        {...editForm.register('end_cash_cents')}
                        className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Reason *</label>
                      <textarea
                        {...editForm.register('reason')}
                        rows={3}
                        className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter reason for editing"
                      />
                      {editForm.formState.errors.reason && (
                        <p className="mt-1 text-sm text-red-600">{editForm.formState.errors.reason.message}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-4 pt-6 mt-8 border-t border-gray-200">
                    <button
                      type="submit"
                      className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm"
                    >
                      Save Changes
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowEditDialog(false)
                        setSelectedSession(null)
                      }}
                      className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-semibold text-sm"
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

          {showReviewDialog && selectedSession && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
              <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md m-4">
                <div className="flex justify-between items-center px-8 py-6 border-b border-gray-200">
                  <h3 className="text-xl font-bold text-gray-900">Review Shift Session</h3>
                  <button
                    onClick={() => {
                      setShowReviewDialog(false)
                      setSelectedSession(null)
                    }}
                    className="text-gray-400 hover:text-gray-600 text-3xl leading-none"
                  >
                    ×
                  </button>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); onSubmitReview(); }} className="p-8">
                  <div className="space-y-4 mb-6">
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-600 mb-2">Employee: <span className="font-semibold">{selectedSession.employee_name}</span></p>
                      <p className="text-sm text-gray-600 mb-2">Start Cash: <span className="font-semibold">{formatCurrency(selectedSession.start_cash_cents)}</span></p>
                      <p className="text-sm text-gray-600 mb-2">End Cash: <span className="font-semibold">{formatCurrency(selectedSession.end_cash_cents)}</span></p>
                      <p className="text-sm text-gray-600">Delta: <span className={`font-semibold ${selectedSession.delta_cents && selectedSession.delta_cents < 0 ? 'text-red-600' : ''}`}>{formatCurrency(selectedSession.delta_cents)}</span></p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Review Note</label>
                      <textarea
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.target.value)}
                        rows={3}
                        className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter review notes (optional)"
                      />
                    </div>
                  </div>
                  <div className="flex gap-4 pt-6 border-t border-gray-200">
                    <button
                      type="submit"
                      className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold text-sm"
                    >
                      Approve & Close
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowReviewDialog(false)
                        setSelectedSession(null)
                      }}
                      className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-semibold text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
