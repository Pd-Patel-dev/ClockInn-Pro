'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser, User } from '@/lib/auth'
import logger from '@/lib/logger'
import { useToast } from '@/components/Toast'

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
}

/** Normalize API date to YYYY-MM-DD for input[type="date"] */
function toDateString(v: string | undefined): string {
  if (!v) return ''
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

/** Normalize API time to HH:MM for input[type="time"] (browsers use 24h) */
function toTimeString(v: string | undefined): string {
  if (!v) return ''
  const s = String(v).trim()
  const match = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (match) {
    const h = match[1].padStart(2, '0')
    const m = match[2]
    return `${h}:${m}`
  }
  return ''
}

/** Time for API: send HH:MM to match create-shift (backend accepts it) */
function toApiTime(v: string): string {
  const s = (v || '').trim()
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(':')
    return `${h.padStart(2, '0')}:${m}`
  }
  return '00:00'
}

export default function EditShiftPage() {
  const router = useRouter()
  const params = useParams()
  const toast = useToast()
  const shiftId = params?.id as string

  const [shift, setShift] = useState<Shift | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [formData, setFormData] = useState({
    shift_date: '',
    start_time: '',
    end_time: '',
    break_minutes: 0,
    notes: '',
    job_role: '',
    status: 'DRAFT',
    requires_approval: false,
  })

  useEffect(() => {
    const fetchData = async () => {
      try {
        const currentUser = await getCurrentUser()
        setUser(currentUser)
        if (currentUser.role !== 'ADMIN') {
          setError('You do not have permission to edit shifts')
          setLoading(false)
          return
        }

        const response = await api.get(`/shifts/${shiftId}`)
        const s = response.data
        setShift(s)
        setFormData({
          shift_date: toDateString(s.shift_date),
          start_time: toTimeString(s.start_time),
          end_time: toTimeString(s.end_time),
          break_minutes: Number(s.break_minutes) || 0,
          notes: s.notes ?? '',
          job_role: s.job_role ?? '',
          status: s.status ?? 'DRAFT',
          requires_approval: Boolean(s.requires_approval),
        })
        setFieldErrors({})
      } catch (err: unknown) {
        const e = err as { response?: { status: number } }
        if (e.response?.status === 404) setError('Shift not found')
        else if (e.response?.status === 401) router.push('/login')
        else {
          logger.error('Failed to fetch shift', err as Error)
          setError('Failed to load shift')
        }
      } finally {
        setLoading(false)
      }
    }

    if (shiftId) fetchData()
  }, [shiftId, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!shift) return
    setFieldErrors({})

    const breakVal = parseInt(String(formData.break_minutes), 10)
    const breakMinutes = isNaN(breakVal) || breakVal < 0 ? 0 : breakVal

    setSaving(true)
    try {
      await api.put(`/shifts/${shiftId}`, {
        shift_date: formData.shift_date || undefined,
        start_time: toApiTime(formData.start_time),
        end_time: toApiTime(formData.end_time),
        break_minutes: breakMinutes,
        notes: formData.notes.trim() || undefined,
        job_role: formData.job_role.trim() || undefined,
        status: formData.status,
        requires_approval: formData.requires_approval,
      })
      toast.success('Shift updated successfully')
      router.push(`/schedules/${shiftId}`)
    } catch (err: unknown) {
      const ax = err as { response?: { status: number; data?: { detail?: string | Array<{ loc?: (string | number)[]; msg?: string }> } } }
      logger.error('Failed to update shift', err as Error)

      const detail = ax.response?.data?.detail
      if (ax.response?.status === 422 && Array.isArray(detail)) {
        const next: Record<string, string> = {}
        for (const e of detail) {
          const loc = e.loc ?? []
          const field = loc.filter((x) => x !== 'body' && typeof x === 'string')[0] ?? 'form'
          next[field] = e.msg ?? 'Invalid value'
        }
        setFieldErrors(next)
        toast.error('Please fix the errors below.')
      } else {
        const msg = typeof detail === 'string' ? detail : 'Failed to update shift'
        toast.error(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      </Layout>
    )
  }

  if (error || !shift) {
    return (
      <Layout>
        <div className="px-4 py-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error || 'Shift not found'}</p>
            <button
              onClick={() => router.push('/schedules')}
              className="mt-4 text-blue-600 hover:text-blue-800"
            >
              ← Back to Schedules
            </button>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0 max-w-2xl">
        <button
          onClick={() => router.push(`/schedules/${shiftId}`)}
          className="text-blue-600 hover:text-blue-800 mb-4 flex items-center"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Shift
        </button>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Edit Shift</h1>
        <p className="text-sm text-gray-600 mb-6">{shift.employee_name}</p>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-6 space-y-5">
            {Object.keys(fieldErrors).length > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                Please correct the fields below and save again.
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Date</label>
              <input
                type="date"
                value={formData.shift_date}
                onChange={(e) => setFormData({ ...formData, shift_date: e.target.value })}
                className={`block w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${fieldErrors.shift_date ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                required
              />
              {fieldErrors.shift_date && <p className="mt-1 text-sm text-red-600">{fieldErrors.shift_date}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Start Time</label>
                <input
                  type="time"
                  value={formData.start_time}
                  onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                  className={`block w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${fieldErrors.start_time ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                  required
                />
                {fieldErrors.start_time && <p className="mt-1 text-sm text-red-600">{fieldErrors.start_time}</p>}
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">End Time</label>
                <input
                  type="time"
                  value={formData.end_time}
                  onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                  className={`block w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${fieldErrors.end_time ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                  required
                />
                <p className="mt-1 text-xs text-gray-500">For overnight shifts use end time next day (e.g. 07:00)</p>
                {fieldErrors.end_time && <p className="mt-1 text-sm text-red-600">{fieldErrors.end_time}</p>}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Break (minutes)</label>
              <input
                type="number"
                min={0}
                value={formData.break_minutes}
                onChange={(e) => setFormData({ ...formData, break_minutes: parseInt(e.target.value, 10) || 0 })}
                className={`block w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${fieldErrors.break_minutes ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
              />
              {fieldErrors.break_minutes && <p className="mt-1 text-sm text-red-600">{fieldErrors.break_minutes}</p>}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className={`block w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${fieldErrors.status ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
              >
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="APPROVED">Approved</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
              {fieldErrors.status && <p className="mt-1 text-sm text-red-600">{fieldErrors.status}</p>}
            </div>

            <div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.requires_approval}
                  onChange={(e) => setFormData({ ...formData, requires_approval: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-semibold text-gray-700">Requires approval</span>
              </label>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Job role</label>
              <input
                type="text"
                value={formData.job_role}
                onChange={(e) => setFormData({ ...formData, job_role: e.target.value })}
                className="block w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Optional"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                className="block w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                placeholder="Optional notes"
              />
            </div>
          </div>

          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => router.push(`/schedules/${shiftId}`)}
              className="px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  )
}
