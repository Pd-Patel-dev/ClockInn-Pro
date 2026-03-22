'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser, User } from '@/lib/auth'
import { format, parseISO, addDays } from 'date-fns'
import logger from '@/lib/logger'
import { parseTime24 } from '@/lib/time'
import { useToast } from '@/components/Toast'
import ConfirmationDialog from '@/components/ConfirmationDialog'
import BackButton from '@/components/BackButton'

interface Shift {
  id: string
  employee_id: string
  employee_name: string
  shift_date: string
  start_time: string
  end_time: string
  break_minutes: number
  status: string
  notes?: string
  job_role?: string
  requires_approval: boolean
  approved_by?: string
  approved_at?: string
  created_at: string
  created_by?: string
  updated_at: string
}

export default function ShiftDetailPage() {
  const router = useRouter()
  const params = useParams()
  const toast = useToast()
  const shiftId = params?.id as string

  const [shift, setShift] = useState<Shift | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const currentUser = await getCurrentUser()
        setUser(currentUser)

        const response = await api.get(`/shifts/${shiftId}`)
        setShift(response.data)
      } catch (error: any) {
        if (error.response?.status === 404) {
          setError('Shift not found')
        } else if (error.response?.status === 401) {
          router.push('/login')
        } else {
          logger.error('Failed to fetch shift', error as Error)
          setError('Failed to load shift details')
        }
      } finally {
        setLoading(false)
      }
    }

    if (shiftId) fetchData()
  }, [shiftId, router])

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleDelete = () => {
    if (!shift) return
    setShowDeleteConfirm(true)
  }

  const confirmDelete = async () => {
    if (!shift) return
    setShowDeleteConfirm(false)
    setDeleting(true)
    try {
      await api.delete(`/shifts/${shiftId}`)
      toast.success('Shift deleted successfully')
      router.push('/schedules')
    } catch (error: any) {
      logger.error('Failed to delete shift', error as Error)
      toast.error(error.response?.data?.detail || 'Failed to delete shift')
    } finally {
      setDeleting(false)
    }
  }

  const handleApprove = async () => {
    if (!shift) return

    try {
      const response = await api.post(`/shifts/${shiftId}/approve`)
      setShift(response.data)
      toast.success('Shift approved successfully')
    } catch (error: any) {
      logger.error('Failed to approve shift', error as Error)
      toast.error(error.response?.data?.detail || 'Failed to approve shift')
    }
  }

  const getStatusColor = (status: string) => {
    switch (status.toUpperCase()) {
      case 'PUBLISHED':
        return 'bg-blue-100 text-blue-800'
      case 'APPROVED':
        return 'bg-green-100 text-green-800'
      case 'DRAFT':
        return 'bg-slate-100 text-slate-800'
      case 'CANCELLED':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-slate-100 text-slate-800'
    }
  }

  const isOvernightShift = (shift: Shift) => {
    return shift.end_time <= shift.start_time
  }

  const normalizeShift = (shift: Shift) => {
    const shiftDate = parseISO(shift.shift_date)
    const startParsed = parseTime24(shift.start_time)
    const endParsed = parseTime24(shift.end_time)
    if (!startParsed || !endParsed) {
      const fallback = new Date(shiftDate)
      fallback.setHours(0, 0, 0, 0)
      return { startAt: fallback, endAt: addDays(fallback, 1) }
    }
    const startAt = new Date(shiftDate)
    startAt.setHours(startParsed.hour, startParsed.minute, 0, 0)
    let endAt = new Date(shiftDate)
    endAt.setHours(endParsed.hour, endParsed.minute, 0, 0)
    if (endAt <= startAt) endAt = addDays(endAt, 1)
    return { startAt, endAt }
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

  if (error || !shift) {
    return (
      <Layout>
        <div className="px-4 py-6 sm:px-0">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error || 'Shift not found'}</p>
            <BackButton fallbackHref="/schedules" className="mt-4 text-blue-600 hover:text-blue-800">
              ← Back to Schedules
            </BackButton>
          </div>
        </div>
      </Layout>
    )
  }

  const overnight = isOvernightShift(shift)
  const { startAt, endAt } = normalizeShift(shift)
  const durationHours = (endAt.getTime() - startAt.getTime()) / (1000 * 60 * 60)
  const workHours = durationHours - (shift.break_minutes / 60)

  const isAdmin = user?.role === 'ADMIN'

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        {/* Header */}
        <div className="mb-6">
          <BackButton fallbackHref="/schedules" className="text-blue-600 hover:text-blue-800 mb-4 flex items-center gap-1.5">
            Back to Schedules
          </BackButton>
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Shift Details</h1>
              <p className="text-sm text-slate-600 mt-1">{shift.employee_name}</p>
            </div>
            {isAdmin && (
              <div className="flex space-x-2">
                <button
                  onClick={() => router.push(`/schedules/shift/${shiftId}/edit`)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Edit
                </button>
                {shift.status === 'DRAFT' && (
                  <button
                    onClick={handleApprove}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    Approve
                  </button>
                )}
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Shift Details Card */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column */}
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-slate-500">Employee</label>
                  <p className="mt-1 text-lg text-slate-900">{shift.employee_name}</p>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-500">Date</label>
                  <p className="mt-1 text-lg text-slate-900">
                    {format(parseISO(shift.shift_date), 'EEEE, MMMM d, yyyy')}
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-500">Time</label>
                  <p className="mt-1 text-lg text-slate-900">
                    {format(startAt, 'h:mm a')} - {format(endAt, 'h:mm a')}
                    {overnight && (
                      <span className="ml-2 text-sm text-slate-500">
                        (ends {format(endAt, 'MMM d')})
                      </span>
                    )}
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-500">Status</label>
                  <p className="mt-1">
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(shift.status)}`}>
                      {shift.status.charAt(0) + shift.status.slice(1).toLowerCase()}
                    </span>
                  </p>
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-slate-500">Duration</label>
                  <p className="mt-1 text-lg text-slate-900">
                    {durationHours.toFixed(2)} hours
                    {shift.break_minutes > 0 && (
                      <span className="text-sm text-slate-500 ml-2">
                        ({workHours.toFixed(2)} work hours, {shift.break_minutes} min break)
                      </span>
                    )}
                  </p>
                </div>

                {shift.job_role && (
                  <div>
                    <label className="text-sm font-medium text-slate-500">Job Role</label>
                    <p className="mt-1 text-lg text-slate-900">{shift.job_role}</p>
                  </div>
                )}

                {shift.requires_approval && (
                  <div>
                    <label className="text-sm font-medium text-slate-500">Requires Approval</label>
                    <p className="mt-1 text-lg text-slate-900">Yes</p>
                  </div>
                )}

                {shift.approved_by && shift.approved_at && (
                  <div>
                    <label className="text-sm font-medium text-slate-500">Approved</label>
                    <p className="mt-1 text-lg text-slate-900">
                      {format(parseISO(shift.approved_at), 'MMM d, yyyy h:mm a')}
                    </p>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium text-slate-500">Created</label>
                  <p className="mt-1 text-sm text-slate-600">
                    {format(parseISO(shift.created_at), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
              </div>
            </div>

            {shift.notes && (
              <div className="mt-6 pt-6 border-t border-slate-200">
                <label className="text-sm font-medium text-slate-500">Notes</label>
                <p className="mt-2 text-slate-900 whitespace-pre-wrap">{/* User text: React escapes */}{shift.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        title="Delete Shift"
        message="Are you sure you want to delete this shift?"
        confirmText="Delete"
        cancelText="Cancel"
        type="warning"
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </Layout>
  )
}
