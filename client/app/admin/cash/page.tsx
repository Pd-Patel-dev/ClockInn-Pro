'use client'

import { useEffect, useState } from 'react'
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
  beverages_cash_cents: number | null
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

export default function AdminCashDrawerPage() {
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
  const [reviewNote, setReviewNote] = useState('')
  const [exporting, setExporting] = useState(false)

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
        fetchSessions()
      } catch (error) {
        router.push('/login')
      } finally {
        setLoading(false)
      }
    }
    fetchUser()
  }, [router])

  const fetchSessions = async () => {
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
      toast.error(error.response?.data?.detail || 'Failed to fetch cash drawer sessions')
    } finally {
      setLoadingSessions(false)
    }
  }

  useEffect(() => {
    if (user) {
      fetchSessions()
    }
  }, [fromDate, toDate, statusFilter, user])

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
      toast.success('Cash drawer session updated successfully')
      setShowEditDialog(false)
      setSelectedSession(null)
      fetchSessions()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to update cash drawer session')
    }
  }

  const onSubmitReview = async () => {
    if (!selectedSession) return

    try {
      await api.post(`/admin/cash-drawers/${selectedSession.id}/review`, {
        note: reviewNote,
        status: 'CLOSED',
      })
      toast.success('Cash drawer session reviewed successfully')
      setShowReviewDialog(false)
      setSelectedSession(null)
      setReviewNote('')
      fetchSessions()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to review cash drawer session')
    }
  }

  const handleExport = async (format: 'pdf' | 'xlsx') => {
    setExporting(true)
    try {
      const params = new URLSearchParams({
        format,
        from_date: fromDate,
        to_date: toDate,
      })
      if (statusFilter) {
        params.append('status', statusFilter)
      }

      const response = await api.post(`/admin/cash-drawers/export?${params.toString()}`, {}, {
        responseType: 'blob',
      })

      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `cash_drawer_${fromDate}_${toDate}.${format === 'pdf' ? 'pdf' : 'xlsx'}`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      toast.success(`Cash drawer report exported as ${format.toUpperCase()}`)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to export cash drawer report')
    } finally {
      setExporting(false)
    }
  }

  const formatCurrency = (cents: number | null) => {
    if (cents === null) return 'N/A'
    return `$${(cents / 100).toFixed(2)}`
  }

  const getDeltaLabel = (deltaCents: number | null) => {
    if (deltaCents === null) return 'N/A'
    if (deltaCents > 0) return 'Over'
    if (deltaCents < 0) return 'Short'
    return 'Even'
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
        <div className="max-w-[1800px] mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">Cash Drawer Management</h1>
            <p className="text-sm text-gray-600">View and manage cash drawer sessions</p>
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
            <div className="overflow-x-auto">
              <table className="w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shift Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shift Times</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Start Cash</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Collected Cash</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Beverages Cash</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">End Cash</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Over/Short</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loadingSessions ? (
                    <tr>
                      <td colSpan={10} className="px-6 py-12 text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                      </td>
                    </tr>
                  ) : sessions.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-6 py-12 text-center text-gray-500">
                        No cash drawer sessions found
                      </td>
                    </tr>
                  ) : (
                    sessions.map((session) => (
                      <tr key={session.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {format(new Date(session.start_counted_at), 'MMM dd, yyyy')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {session.employee_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {session.clock_in_at ? (
                            <div>
                              <div className="font-medium">In: {format(new Date(session.clock_in_at), 'h:mm a')}</div>
                              {session.clock_out_at ? (
                                <div className="text-xs text-gray-500">Out: {format(new Date(session.clock_out_at), 'h:mm a')}</div>
                              ) : (
                                <div className="text-xs text-yellow-600">Still Clocked In</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400">N/A</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                          {formatCurrency(session.start_cash_cents)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                          {formatCurrency(session.collected_cash_cents)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                          {formatCurrency(session.beverages_cash_cents)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                          {formatCurrency(session.end_cash_cents)}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm font-bold text-right ${getDeltaColor(session.delta_cents)}`}>
                          <div className="flex items-center justify-end gap-2">
                            <span className={`px-2 py-1 rounded text-xs font-semibold ${
                              session.delta_cents && session.delta_cents > 0 
                                ? 'bg-green-100 text-green-800' 
                                : session.delta_cents && session.delta_cents < 0
                                ? 'bg-red-100 text-red-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}>
                              {getDeltaLabel(session.delta_cents)}
                            </span>
                            <span>{formatCurrency(session.delta_cents)}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusBadge(session.status)}`}>
                            {session.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                          <div className="flex gap-2 justify-center">
                            <button
                              onClick={() => handleEdit(session)}
                              className="text-blue-600 hover:text-blue-700 font-medium"
                            >
                              Edit
                            </button>
                            {session.status === 'REVIEW_NEEDED' && (
                              <button
                                onClick={() => handleReview(session)}
                                className="text-green-600 hover:text-green-700 font-medium"
                              >
                                Review
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Edit Dialog */}
          {showEditDialog && selectedSession && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
              <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md m-4">
                <div className="flex justify-between items-center px-8 py-6 border-b border-gray-200">
                  <h3 className="text-xl font-bold text-gray-900">Edit Cash Drawer Session</h3>
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

          {/* Review Dialog */}
          {showReviewDialog && selectedSession && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
              <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md m-4">
                <div className="flex justify-between items-center px-8 py-6 border-b border-gray-200">
                  <h3 className="text-xl font-bold text-gray-900">Review Cash Drawer Session</h3>
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
