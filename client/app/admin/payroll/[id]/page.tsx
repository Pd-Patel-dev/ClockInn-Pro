'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import logger from '@/lib/logger'
import { useToast } from '@/components/Toast'
import { ButtonSpinner } from '@/components/LoadingSpinner'

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
  details_json?: any
}

interface PayrollRun {
  id: string
  company_id: string
  payroll_type: 'WEEKLY' | 'BIWEEKLY'
  period_start_date: string
  period_end_date: string
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
        logger.error('Authentication error', err as Error, { action: 'fetchPayrollRun', payrollId: params.id })
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
      logger.error('Failed to fetch payroll run', error as Error, { endpoint: `/admin/payroll/runs/${params.id}` })
      if (error.response?.status === 404) {
        toast.error('Payroll run not found')
        router.push('/admin/payroll')
      } else if (error.response?.status === 403) {
        router.push('/dashboard')
      } else {
        toast.error(error.response?.data?.detail || 'Failed to fetch payroll run')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleFinalize = async () => {
    if (!confirm('Are you sure you want to finalize this payroll run? This action cannot be undone.')) {
      return
    }
    setFinalizing(true)
    try {
      await api.post(`/admin/payroll/runs/${payrollRunId}/finalize`, {})
      toast.success('Payroll run finalized successfully!')
      fetchPayrollRun()
    } catch (error: any) {
      logger.error('Failed to finalize payroll', error as Error, { endpoint: `/admin/payroll/runs/${params.id}/finalize` })
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
      logger.error('Failed to void payroll', error as Error, { endpoint: `/admin/payroll/runs/${params.id}/void` })
      toast.error(error.response?.data?.detail || 'Failed to void payroll')
    } finally {
      setVoiding(false)
    }
  }

  const handleExport = async (format: 'pdf' | 'xlsx') => {
    setExporting(true)
    try {
      const response = await api.post(
        `/admin/payroll/runs/${payrollRunId}/export?format=${format}`,
        {},
        { responseType: 'blob' }
      )
      const blob = new Blob([response.data])
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `payroll_${payrollRunId}.${format === 'pdf' ? 'pdf' : 'xlsx'}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      toast.success(`Payroll exported as ${format.toUpperCase()} successfully!`)
    } catch (error: any) {
      logger.error('Failed to export payroll', error as Error, { endpoint: `/admin/payroll/runs/${params.id}/export` })
      toast.error(error.response?.data?.detail || 'Failed to export payroll')
    } finally {
      setExporting(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this payroll run? This action cannot be undone.')) {
      return
    }
    setDeleting(true)
    try {
      await api.delete(`/admin/payroll/runs/${payrollRunId}`)
      toast.success('Payroll run deleted successfully!')
      // Success - redirect to payroll list
      router.push('/admin/payroll')
    } catch (error: any) {
      logger.error('Failed to delete payroll', error as Error, { endpoint: `/admin/payroll/runs/${payrollRunId}` })
      const errorMessage = error.response?.data?.detail || error.message || 'Failed to delete payroll'
      toast.error(errorMessage)
    } finally {
      setDeleting(false)
    }
  }

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`
  }

  const formatDecimalHours = (minutes: number) => {
    return (minutes / 60).toFixed(2)
  }

  const formatHoursDecimal = (hours: number | string) => {
    return Number(hours).toFixed(2)
  }

  if (loading) {
    return (
      <Layout>
        <div className="px-4 py-6 sm:px-0">
          <div className="text-center py-8">Loading...</div>
        </div>
      </Layout>
    )
  }

  if (!payrollRun) {
    return (
      <Layout>
        <div className="px-4 py-6 sm:px-0">
          <div className="text-center py-8 text-gray-500">Payroll run not found</div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <div className="mb-6">
          <button
            onClick={() => router.push('/admin/payroll')}
            className="mb-4 text-primary-600 hover:text-primary-700 flex items-center"
          >
            ← Back to Payroll Runs
          </button>
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold">Payroll Details</h1>
              <p className="text-gray-600 mt-1">
                {payrollRun.payroll_type} - {new Date(payrollRun.period_start_date).toLocaleDateString()} to{' '}
                {new Date(payrollRun.period_end_date).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleExport('pdf')}
                disabled={exporting}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {exporting && <ButtonSpinner />}
                Export PDF
              </button>
              <button
                onClick={() => handleExport('xlsx')}
                disabled={exporting}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {exporting && <ButtonSpinner />}
                Export Excel
              </button>
              {payrollRun.status === 'DRAFT' && (
                <>
                  <button
                    onClick={handleFinalize}
                    disabled={finalizing}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {finalizing && <ButtonSpinner />}
                    {finalizing ? 'Finalizing...' : 'Finalize'}
                  </button>
                  <button
                    onClick={() => setShowVoidModal(true)}
                    disabled={voiding || finalizing || deleting}
                    className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Void
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {deleting && <ButtonSpinner />}
                    {deleting ? 'Deleting...' : 'Delete'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-gray-500">Status</div>
              <span
                className={`inline-block mt-1 px-2 py-1 text-xs font-semibold rounded-full ${
                  payrollRun.status === 'FINALIZED'
                    ? 'bg-green-100 text-green-800'
                    : payrollRun.status === 'VOID'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-yellow-100 text-yellow-800'
                }`}
              >
                {payrollRun.status}
              </span>
            </div>
            <div>
              <div className="text-sm text-gray-500">Generated At</div>
              <div className="mt-1 font-medium">
                {new Date(payrollRun.generated_at).toLocaleString()}
              </div>
            </div>
            {payrollRun.generated_by_name && (
              <div>
                <div className="text-sm text-gray-500">Generated By</div>
                <div className="mt-1 font-medium">{payrollRun.generated_by_name}</div>
              </div>
            )}
            <div>
              <div className="text-sm text-gray-500">Timezone</div>
              <div className="mt-1 font-medium">{payrollRun.timezone}</div>
            </div>
          </div>
        </div>

        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold">Employee Line Items</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reg Hrs</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">OT Hrs</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reg Pay</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">OT Pay</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Exc</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {payrollRun.line_items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-sm text-gray-900">{item.employee_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{formatDecimalHours(item.regular_minutes)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{formatDecimalHours(item.overtime_minutes)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{formatCurrency(item.pay_rate_cents)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{formatCurrency(item.regular_pay_cents)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{formatCurrency(item.overtime_pay_cents)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(item.total_pay_cents)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {item.exceptions_count > 0 ? (
                        <span className="text-red-600 font-semibold">{item.exceptions_count}</span>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-4 py-3 text-sm">TOTALS</td>
                  <td className="px-4 py-3 text-sm">{formatHoursDecimal(payrollRun.total_regular_hours)}</td>
                  <td className="px-4 py-3 text-sm">{formatHoursDecimal(payrollRun.total_overtime_hours)}</td>
                  <td className="px-4 py-3 text-sm"></td>
                  <td className="px-4 py-3 text-sm"></td>
                  <td className="px-4 py-3 text-sm"></td>
                  <td className="px-4 py-3 text-sm">{formatCurrency(payrollRun.total_gross_pay_cents)}</td>
                  <td className="px-4 py-3 text-sm"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Void Modal */}
        {showVoidModal && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
            <div className="relative bg-white rounded-lg shadow-xl p-6 w-full max-w-md m-4">
              <h2 className="text-xl font-semibold mb-4">Void Payroll Run</h2>
              <p className="text-sm text-gray-600 mb-4">Please provide a reason for voiding this payroll run:</p>
              <textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                rows={4}
                placeholder="Reason for voiding..."
              />
              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleVoid}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                >
                  Void
                </button>
                <button
                  onClick={() => {
                    setShowVoidModal(false)
                    setVoidReason('')
                  }}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

