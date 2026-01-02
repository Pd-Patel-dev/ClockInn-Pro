'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import logger from '@/lib/logger'

const payrollGenerateSchema = z.object({
  payroll_type: z.enum(['WEEKLY', 'BIWEEKLY']),
  start_date: z.string().min(1, 'Start date is required'),
  include_inactive: z.boolean().default(false),
})

type PayrollGenerateForm = z.infer<typeof payrollGenerateSchema>

interface PayrollRunSummary {
  id: string
  payroll_type: 'WEEKLY' | 'BIWEEKLY'
  period_start_date: string
  period_end_date: string
  status: 'DRAFT' | 'FINALIZED' | 'VOID'
  generated_at: string
  total_regular_hours: number | string
  total_overtime_hours: number | string
  total_gross_pay_cents: number
  employee_count: number
}


export default function AdminPayrollPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [payrollRuns, setPayrollRuns] = useState<PayrollRunSummary[]>([])
  const [showGenerateForm, setShowGenerateForm] = useState(false)
  const [filters, setFilters] = useState({
    from_date: '',
    to_date: '',
    status: '',
    payroll_type: '',
  })

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<PayrollGenerateForm>({
    resolver: zodResolver(payrollGenerateSchema),
    defaultValues: {
      payroll_type: 'WEEKLY',
      include_inactive: false,
    },
  })

  const payrollType = watch('payroll_type')

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
      logger.error('Failed to fetch payroll runs', error as Error, { endpoint: '/admin/payroll/runs' })
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
        fetchPayrollRuns()
      } catch (err: any) {
        logger.error('Authentication error', err as Error, { action: 'fetchPayrollRuns' })
        router.push('/login')
      }
    }
    checkAdminAndFetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, filters])

  const handleViewPayrollRun = (runId: string) => {
    router.push(`/admin/payroll/${runId}`)
  }

  const onSubmit = async (data: PayrollGenerateForm) => {
    setGenerating(true)
    try {
      const response = await api.post('/admin/payroll/runs/generate', {
        payroll_type: data.payroll_type,
        start_date: data.start_date,
        include_inactive: data.include_inactive,
      })
      setShowGenerateForm(false)
      reset()
      fetchPayrollRuns()
      // Navigate to the newly created payroll run
      router.push(`/admin/payroll/${response.data.id}`)
    } catch (error: any) {
      logger.error('Failed to generate payroll', error as Error, { endpoint: '/admin/payroll/runs/generate' })
      toast.error(error.response?.data?.detail || 'Failed to generate payroll')
    } finally {
      setGenerating(false)
    }
  }

  const handleClearFilters = () => {
    setFilters({ from_date: '', to_date: '', status: '', payroll_type: '' })
  }



  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`
  }


  const calculateEndDate = (startDate: string, type: 'WEEKLY' | 'BIWEEKLY') => {
    if (!startDate) return ''
    const start = new Date(startDate)
    const days = type === 'WEEKLY' ? 6 : 13
    const end = new Date(start)
    end.setDate(end.getDate() + days)
    return end.toISOString().split('T')[0]
  }

  const startDate = watch('start_date')
  const computedEndDate = calculateEndDate(startDate, payrollType)

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Payroll</h1>
          <button
            onClick={() => setShowGenerateForm(!showGenerateForm)}
            className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
          >
            {showGenerateForm ? 'Cancel' : 'Generate Payroll'}
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
              <input
                type="date"
                value={filters.from_date}
                onChange={(e) => setFilters({ ...filters, from_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
              <input
                type="date"
                value={filters.to_date}
                onChange={(e) => setFilters({ ...filters, to_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
              >
                <option value="">All</option>
                <option value="DRAFT">Draft</option>
                <option value="FINALIZED">Finalized</option>
                <option value="VOID">Void</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payroll Type</label>
              <select
                value={filters.payroll_type}
                onChange={(e) => setFilters({ ...filters, payroll_type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
              >
                <option value="">All</option>
                <option value="WEEKLY">Weekly</option>
                <option value="BIWEEKLY">Biweekly</option>
              </select>
            </div>
          </div>
          <div className="mt-4">
            <button
              onClick={() => setFilters({ from_date: '', to_date: '', status: '', payroll_type: '' })}
              className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Clear Filters
            </button>
          </div>
        </div>

        {showGenerateForm && (
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Generate New Payroll</h2>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Payroll Type</label>
                <select
                  {...register('payroll_type')}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                >
                  <option value="WEEKLY">Weekly</option>
                  <option value="BIWEEKLY">Biweekly</option>
                </select>
                {errors.payroll_type && (
                  <p className="mt-1 text-sm text-red-600">{errors.payroll_type.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Start Date</label>
                <input
                  {...register('start_date')}
                  type="date"
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                />
                {errors.start_date && (
                  <p className="mt-1 text-sm text-red-600">{errors.start_date.message}</p>
                )}
              </div>

              {computedEndDate && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">End Date (computed)</label>
                  <input
                    type="date"
                    value={computedEndDate}
                    disabled
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-100 text-gray-500 sm:text-sm cursor-not-allowed"
                  />
                </div>
              )}

              <div>
                <label className="flex items-center">
                  <input
                    {...register('include_inactive')}
                    type="checkbox"
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">Include inactive employees</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={generating}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <ButtonSpinner />
                    Generating...
                  </>
                ) : (
                  'Generate Payroll'
                )}
              </button>
            </form>
          </div>
        )}

        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : (
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold">Payroll Runs</h2>
            </div>
            <div className="divide-y divide-gray-200">
              {payrollRuns.length === 0 ? (
                <div className="px-6 py-4 text-center text-gray-500">No payroll runs found</div>
              ) : (
                payrollRuns.map((run) => (
                  <Link
                    key={run.id}
                    href={`/admin/payroll/${run.id}`}
                    className="block px-6 py-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium">
                          {run.payroll_type} - {new Date(run.period_start_date).toLocaleDateString()} to{' '}
                          {new Date(run.period_end_date).toLocaleDateString()}
                        </div>
                        <div className="text-sm text-gray-500 mt-1">
                          {run.employee_count} employees • {formatCurrency(run.total_gross_pay_cents)} total
                        </div>
                      </div>
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          run.status === 'FINALIZED'
                            ? 'bg-green-100 text-green-800'
                            : run.status === 'VOID'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {run.status}
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        )}

      </div>
    </Layout>
  )
}

