'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import logger from '@/lib/logger'
import { format, startOfWeek, endOfWeek } from 'date-fns'
import BackButton from '@/components/BackButton'
import ConfirmationDialog from '@/components/ConfirmationDialog'

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
}

function EditWeekShiftsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const employeeId = searchParams.get('employee_id')
  const weekStartStr = searchParams.get('week_start')

  const [shifts, setShifts] = useState<Shift[]>([])
  const [employeeName, setEmployeeName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [shiftToDelete, setShiftToDelete] = useState<Shift | null>(null)

  const weekStart = weekStartStr ? startOfWeek(new Date(weekStartStr), { weekStartsOn: 1 }) : startOfWeek(new Date(), { weekStartsOn: 1 })
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

  const refetchShifts = async () => {
    if (!employeeId || !weekStartStr) return
    const start = format(weekStart, 'yyyy-MM-dd')
    const end = format(weekEnd, 'yyyy-MM-dd')
    try {
      const params = new URLSearchParams()
      params.set('start_date', start)
      params.set('end_date', end)
      params.set('employee_id', employeeId)
      params.set('limit', '500')
      const res = await api.get(`/shifts?${params.toString()}`)
      const data = res.data
      let list: Shift[] = []
      if (Array.isArray(data)) {
        list = data
      } else if (data && Array.isArray(data.shifts)) {
        list = data.shifts
      } else if (data && Array.isArray(data.items)) {
        list = data.items
      }
      setShifts(list)
      const first = list[0]
      if (first?.employee_name) setEmployeeName(first.employee_name)
    } catch (err: unknown) {
      logger.error('Failed to fetch shifts', err as Error)
      toast.error('Failed to load shifts')
    }
  }

  useEffect(() => {
    if (!employeeId || !weekStartStr) {
      toast.error('Missing employee or week')
      router.replace('/schedules')
      return
    }

    let isMounted = true
    setLoading(true)
    const run = async () => {
      await refetchShifts()
      if (isMounted) setLoading(false)
    }
    run()
    return () => { isMounted = false }
    // Refetch only when URL params change; omit router/toast to avoid extra fetches from reference changes
  }, [employeeId, weekStartStr])

  const formatTime = (t: string) => {
    if (!t) return '—'
    const parts = String(t).trim().split(':')
    const h = parts[0] ? parseInt(parts[0], 10) : 0
    const m = parts[1] !== undefined ? parseInt(parts[1], 10) : 0
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const handleDeleteClick = (shift: Shift) => {
    setShiftToDelete(shift)
  }

  const confirmDelete = async () => {
    if (!shiftToDelete) return
    setDeletingId(shiftToDelete.id)
    setShiftToDelete(null)
    try {
      await api.delete(`/shifts/${shiftToDelete.id}`)
      toast.success('Shift deleted')
      await refetchShifts()
    } catch (err: unknown) {
      logger.error('Failed to delete shift', err as Error)
      toast.error('Failed to delete shift')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-gray-50 to-indigo-50/30">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6">
            <BackButton fallbackHref="/schedules" className="text-sm font-medium text-gray-600 hover:text-gray-900 mb-4 inline-flex items-center gap-1">
              Back to Schedule
            </BackButton>
            <h1 className="text-2xl font-bold text-gray-900">Edit shifts</h1>
            <p className="mt-1 text-sm text-gray-500">
              {employeeName || 'Employee'} · Week of {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
            </p>
          </div>

          {loading ? (
            <div className="bg-white/80 rounded-2xl border border-white/60 p-8 text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-500/60 border-t-transparent mx-auto" />
              <p className="mt-3 text-gray-600">Loading shifts...</p>
            </div>
          ) : shifts.length === 0 ? (
            <div className="bg-white/80 rounded-2xl border border-white/60 p-8 text-center">
              <p className="text-gray-600">No shifts this week for this employee.</p>
              <button
                type="button"
                onClick={() => router.push(`/schedules/week?employee_id=${employeeId}&week_start=${format(weekStart, 'yyyy-MM-dd')}`)}
                className="mt-4 px-4 py-2 rounded-xl bg-blue-500/90 text-white text-sm font-medium hover:bg-blue-600"
              >
                Create shifts for this week
              </button>
            </div>
          ) : (
            <ul className="space-y-3">
              {shifts
                .sort((a, b) => {
                  const d = a.shift_date.localeCompare(b.shift_date)
                  return d !== 0 ? d : (a.start_time || '').localeCompare(b.start_time || '')
                })
                .map((shift) => (
                  <li
                    key={shift.id}
                    className="flex items-center justify-between gap-4 bg-white/80 rounded-xl border border-white/60 p-4 shadow-[inset_2px_2px_4px_rgba(0,0,0,0.03)]"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        {format(new Date(shift.shift_date), 'EEE, MMM d')}
                      </p>
                      <p className="text-sm text-gray-600">
                        {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
                        {shift.break_minutes ? ` · ${shift.break_minutes}m break` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => router.push(`/schedules/shift/${shift.id}/edit`)}
                        className="py-2 px-4 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400/50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteClick(shift)}
                        disabled={deletingId === shift.id}
                        className="py-2 px-4 rounded-lg bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-300/50 disabled:opacity-50"
                        title="Delete shift"
                      >
                        {deletingId === shift.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmationDialog
        isOpen={!!shiftToDelete}
        title="Delete shift"
        message={
          shiftToDelete
            ? `Delete the shift on ${format(new Date(shiftToDelete.shift_date), 'EEE, MMM d')} (${formatTime(shiftToDelete.start_time)} – ${formatTime(shiftToDelete.end_time)})? This cannot be undone.`
            : ''
        }
        confirmText="Delete"
        cancelText="Cancel"
        type="error"
        onConfirm={confirmDelete}
        onCancel={() => setShiftToDelete(null)}
        showCancel={true}
      />
    </Layout>
  )
}

export default function EditWeekShiftsPage() {
  return (
    <Suspense
      fallback={
        <Layout>
          <div className="min-h-screen bg-gradient-to-br from-slate-100 via-gray-50 to-indigo-50/30 flex items-center justify-center">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-500/60 border-t-transparent" />
          </div>
        </Layout>
      }
    >
      <EditWeekShiftsContent />
    </Suspense>
  )
}
