'use client'

import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import logger from '@/lib/logger'
import { format } from 'date-fns'

const leaveRequestSchema = z.object({
  type: z.enum(['vacation', 'sick', 'personal', 'other']),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().min(1, 'End date is required'),
  partial_day_hours: z.number().optional(),
  reason: z.string().optional(),
})

type LeaveRequestForm = z.infer<typeof leaveRequestSchema>

interface LeaveRequest {
  id: string
  type: string
  start_date: string
  end_date: string
  status: string
  reason: string | null
  review_comment: string | null
}

export default function MyLeavePage() {
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<LeaveRequestForm>({
    resolver: zodResolver(leaveRequestSchema),
  })

  useEffect(() => {
    fetchRequests()
  }, [])

  const fetchRequests = async () => {
    setLoading(true)
    try {
      const response = await api.get('/leave/my')
      setRequests(response.data.requests || [])
    } catch (error) {
      logger.error('Failed to fetch leave requests', error as Error, { endpoint: '/leave/my' })
    } finally {
      setLoading(false)
    }
  }

  const onSubmit = async (data: LeaveRequestForm) => {
    try {
      await api.post('/leave/request', {
        ...data,
        start_date: new Date(data.start_date).toISOString().split('T')[0],
        end_date: new Date(data.end_date).toISOString().split('T')[0],
      })
      reset()
      setShowForm(false)
      fetchRequests()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to create leave request')
    }
  }

  const getStatusBadge = (status: string) => {
    const statusMap: { [key: string]: { color: string; bg: string } } = {
      'approved': { color: 'text-green-800', bg: 'bg-green-100' },
      'pending': { color: 'text-yellow-800', bg: 'bg-yellow-100' },
      'rejected': { color: 'text-red-800', bg: 'bg-red-100' },
    }
    const style = statusMap[status.toLowerCase()] || { color: 'text-gray-800', bg: 'bg-gray-100' }
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${style.bg} ${style.color}`}>
        {status}
      </span>
    )
  }

  return (
    <Layout>
      <div className="px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">My Leave Requests</h1>
            <p className="text-sm text-gray-600">Request time off and track your leave</p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
          >
            {showForm ? 'Cancel' : 'Request Leave'}
          </button>
        </div>

        {/* Form Card */}
        {showForm && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">New Leave Request</h2>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Leave Type</label>
                <select
                  {...register('type')}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                >
                  <option value="vacation">Vacation</option>
                  <option value="sick">Sick Leave</option>
                  <option value="personal">Personal</option>
                  <option value="other">Other</option>
                </select>
                {errors.type && (
                  <p className="mt-1 text-sm text-red-600">{errors.type.message}</p>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                  <input
                    {...register('start_date')}
                    type="date"
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                  {errors.start_date && (
                    <p className="mt-1 text-sm text-red-600">{errors.start_date.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                  <input
                    {...register('end_date')}
                    type="date"
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                  {errors.end_date && (
                    <p className="mt-1 text-sm text-red-600">{errors.end_date.message}</p>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Reason (optional)</label>
                <textarea
                  {...register('reason')}
                  rows={4}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="Please provide a reason for your leave request..."
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting && <ButtonSpinner />}
                {submitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </form>
          </div>
        )}

        {/* Requests List */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse">
                <div className="h-6 bg-gray-200 rounded mb-4 w-24"></div>
                <div className="h-4 bg-gray-200 rounded mb-2 w-full"></div>
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              </div>
            ))}
          </div>
        ) : requests.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500 font-medium">No leave requests found</p>
            <p className="text-gray-400 text-sm mt-1">Click "Request Leave" to create your first request</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {requests.map((request) => (
              <div key={request.id} className="bg-white rounded-lg border border-gray-200 p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-gray-900 capitalize mb-2">{request.type}</h3>
                    <div>{getStatusBadge(request.status)}</div>
                  </div>
                </div>
                <div className="space-y-2 mb-4">
                  <div className="text-sm text-gray-600">
                    {format(new Date(request.start_date), 'MMM dd')} - {format(new Date(request.end_date), 'MMM dd, yyyy')}
                  </div>
                  {request.reason && (
                    <p className="text-sm text-gray-600 line-clamp-2">{request.reason}</p>
                  )}
                  {request.review_comment && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <p className="text-xs text-gray-500 font-medium mb-1">Review Comment:</p>
                      <p className="text-sm text-gray-700">{request.review_comment}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
