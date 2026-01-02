'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser, User } from '@/lib/auth'
import { format } from 'date-fns'
import logger from '@/lib/logger'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

interface Employee {
  id: string
  name: string
  email: string
  status: string
  job_role: string | null
  pay_rate: number | null
  has_pin: boolean
  last_punch_at: string | null
  is_clocked_in: boolean | null
  created_at: string
}

interface TimeEntry {
  id: string
  clock_in_at: string
  clock_out_at: string | null
  break_minutes: number
  status: string
  rounded_hours: number | null
  clock_in_at_local: string | null
  clock_out_at_local: string | null
}

const manualEntrySchema = z.object({
  clock_in_at: z.string().min(1, 'Clock in time is required'),
  clock_in_time: z.string().min(1, 'Clock in time is required'),
  clock_out_at: z.string().optional(),
  clock_out_time: z.string().optional(),
  break_minutes: z.string().transform((val) => parseInt(val) || 0),
  note: z.string().optional(),
})

const editEntrySchema = z.object({
  clock_in_at: z.string().min(1, 'Clock in date is required'),
  clock_in_time: z.string().min(1, 'Clock in time is required'),
  clock_out_at: z.string().optional(),
  clock_out_time: z.string().optional(),
  break_minutes: z.string().transform((val) => parseInt(val) || 0),
  edit_reason: z.string().min(1, 'Edit reason is required'),
})

const editEmployeeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  status: z.enum(['active', 'inactive']),
  pin: z.string().length(4, 'PIN must be 4 digits').optional().or(z.literal('')),
  job_role: z.string().optional(),
  pay_rate: z.string().optional(),
})

type ManualEntryForm = z.infer<typeof manualEntrySchema>
type EditEntryForm = z.infer<typeof editEntrySchema>
type EditEmployeeForm = z.infer<typeof editEmployeeSchema>

export default function EmployeeDetailPage() {
  const router = useRouter()
  const params = useParams()
  const employeeId = params?.id as string

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingEntries, setLoadingEntries] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showManualForm, setShowManualForm] = useState(false)
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null)
  const [showEditEmployee, setShowEditEmployee] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 20

  const manualForm = useForm<ManualEntryForm>({
    resolver: zodResolver(manualEntrySchema),
    defaultValues: {
      clock_in_at: new Date().toISOString().split('T')[0],
      clock_in_time: new Date().toTimeString().slice(0, 5),
      break_minutes: '0',
    },
  })

  const editForm = useForm<EditEntryForm>({
    resolver: zodResolver(editEntrySchema),
  })

  const editEmployeeForm = useForm<EditEmployeeForm>({
    resolver: zodResolver(editEmployeeSchema),
  })

  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const user = await getCurrentUser()
        if (user.role !== 'ADMIN') {
          router.push('/dashboard')
          return
        }
        fetchEmployee()
        fetchEntries()
      } catch (err) {
        router.push('/login')
      }
    }
    checkAdmin()
  }, [router, employeeId])

  useEffect(() => {
    if (employeeId) {
      fetchEntries()
    }
  }, [currentPage, employeeId])

  const fetchEmployee = async () => {
    try {
      const response = await api.get(`/users/admin/employees/${employeeId}`)
      setEmployee(response.data)
      // Populate edit form with current values
      if (response.data) {
        editEmployeeForm.reset({
          name: response.data.name,
          status: response.data.status as 'active' | 'inactive',
          pin: '',
          job_role: response.data.job_role || '',
          pay_rate: response.data.pay_rate?.toString() || '',
        })
      }
    } catch (error: any) {
      logger.error('Failed to fetch employee', error as Error, { employeeId })
      if (error.response?.status === 404) {
        setError('Employee not found')
      } else {
        setError('Failed to load employee details')
      }
    } finally {
      setLoading(false)
    }
  }

  const fetchEntries = async () => {
    setLoadingEntries(true)
    try {
      const params = new URLSearchParams()
      params.append('employee_id', employeeId)
      params.append('skip', ((currentPage - 1) * pageSize).toString())
      params.append('limit', pageSize.toString())
      
      const response = await api.get(`/time/admin/time?${params.toString()}`)
      setEntries(response.data.entries || [])
      setTotal(response.data.total || 0)
    } catch (error: any) {
      logger.error('Failed to fetch time entries', error as Error, { employeeId })
    } finally {
      setLoadingEntries(false)
    }
  }

  const onSubmitManual = async (data: ManualEntryForm) => {
    try {
      const clockIn = new Date(`${data.clock_in_at}T${data.clock_in_time}`)
      const clockOut = data.clock_out_at && data.clock_out_time
        ? new Date(`${data.clock_out_at}T${data.clock_out_time}`)
        : null

      await api.post('/time/admin/time/manual', {
        employee_id: employeeId,
        clock_in_at: clockIn.toISOString(),
        clock_out_at: clockOut?.toISOString() || null,
        break_minutes: parseInt(data.break_minutes.toString()),
        note: data.note || null,
      })

      manualForm.reset()
      setShowManualForm(false)
      fetchEntries()
    } catch (error: any) {
      logger.error('Failed to create manual entry', error as Error)
      setError(error.response?.data?.detail || 'Failed to create time entry')
    }
  }

  const onSubmitEdit = async (data: EditEntryForm) => {
    if (!editingEntry) return

    try {
      const clockIn = new Date(`${data.clock_in_at}T${data.clock_in_time}`)
      const clockOut = data.clock_out_at && data.clock_out_time
        ? new Date(`${data.clock_out_at}T${data.clock_out_time}`)
        : null

      await api.put(`/time/admin/time/${editingEntry.id}`, {
        clock_in_at: clockIn.toISOString(),
        clock_out_at: clockOut?.toISOString() || null,
        break_minutes: parseInt(data.break_minutes.toString()),
        edit_reason: data.edit_reason,
      })

      editForm.reset()
      setEditingEntry(null)
      fetchEntries()
    } catch (error: any) {
      logger.error('Failed to edit entry', error as Error)
      setError(error.response?.data?.detail || 'Failed to edit time entry')
    }
  }

  const handleEditClick = (entry: TimeEntry) => {
    const clockIn = new Date(entry.clock_in_at)
    const clockOut = entry.clock_out_at ? new Date(entry.clock_out_at) : null

    editForm.reset({
      clock_in_at: clockIn.toISOString().split('T')[0],
      clock_in_time: clockIn.toTimeString().slice(0, 5),
      clock_out_at: clockOut ? clockOut.toISOString().split('T')[0] : '',
      clock_out_time: clockOut ? clockOut.toTimeString().slice(0, 5) : '',
      break_minutes: entry.break_minutes.toString(),
      edit_reason: '',
    })
    setEditingEntry(entry)
  }

  const onSubmitEditEmployee = async (data: EditEmployeeForm) => {
    try {
      const updateData: any = {
        name: data.name,
        status: data.status,
      }

      // Only include job_role if it has a value
      if (data.job_role && data.job_role.trim() !== '') {
        updateData.job_role = data.job_role.trim()
      } else {
        updateData.job_role = null
      }

      // Handle PIN: send new 4-digit PIN, empty string to clear, or omit to keep current
      if (data.pin !== undefined) {
        if (data.pin.trim() === '' && employee?.has_pin) {
          // User wants to clear PIN
          updateData.pin = ''
        } else if (data.pin.trim().length === 4) {
          // User wants to set new PIN
          updateData.pin = data.pin.trim()
        }
        // If pin is empty and employee doesn't have PIN, we don't send it (no change needed)
      }

      // Only include pay_rate if it has a value
      if (data.pay_rate && data.pay_rate.trim() !== '') {
        const payRateValue = parseFloat(data.pay_rate)
        if (!isNaN(payRateValue) && payRateValue >= 0) {
          updateData.pay_rate = payRateValue
        }
      } else {
        updateData.pay_rate = null
      }

      await api.put(`/users/admin/employees/${employeeId}`, updateData)
      
      setShowEditEmployee(false)
      fetchEmployee()
      setError(null)
    } catch (error: any) {
      logger.error('Failed to update employee', error as Error)
      const errorMessage = error.response?.data?.detail || error.response?.data?.message || 'Failed to update employee'
      setError(Array.isArray(errorMessage) ? errorMessage.join(', ') : errorMessage)
    }
  }

  const calculateHours = (entry: TimeEntry) => {
    if (entry.rounded_hours !== null && entry.rounded_hours !== undefined) {
      return entry.rounded_hours.toFixed(2)
    }
    if (!entry.clock_out_at) return '0.00'
    const inTime = new Date(entry.clock_in_at)
    const outTime = new Date(entry.clock_out_at)
    const diffMs = outTime.getTime() - inTime.getTime()
    const diffHours = (diffMs - entry.break_minutes * 60 * 1000) / (1000 * 60 * 60)
    return diffHours.toFixed(2)
  }

  const totalPages = Math.ceil(total / pageSize)
  const startEntry = total === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const endEntry = Math.min(currentPage * pageSize, total)

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    )
  }

  if (error && !employee) {
    return (
      <Layout>
        <div className="px-4 py-8 sm:px-6 lg:px-8">
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
            <p>{error}</p>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="text-sm text-blue-600 hover:text-blue-700 mb-4"
          >
            ← Back
          </button>
          <h1 className="text-2xl font-semibold text-gray-900 mb-1">Employee Details</h1>
          <p className="text-sm text-gray-600">View and manage employee information and time entries</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-6">
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Employee Info Card */}
        {employee && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center">
                <div className="flex-shrink-0 h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-xl">
                  {employee.name.charAt(0).toUpperCase()}
                </div>
                <div className="ml-4">
                  <h2 className="text-xl font-semibold text-gray-900">{employee.name}</h2>
                  <p className="text-sm text-gray-600">{employee.email}</p>
                  <div className="mt-2 flex items-center gap-4 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                      employee.status === 'active'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {employee.status}
                    </span>
                    {employee.is_clocked_in && (
                      <span className="px-2 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">
                        Clocked In
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {!showEditEmployee && (
                <button
                  onClick={() => setShowEditEmployee(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
                >
                  Edit Employee
                </button>
              )}
            </div>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-gray-600">Job Role</p>
                <p className="text-sm font-medium text-gray-900">{employee.job_role || 'N/A'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Pay Rate</p>
                <p className="text-sm font-medium text-gray-900">
                  {employee.pay_rate ? `$${employee.pay_rate.toFixed(2)}/hr` : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Last Punch</p>
                <p className="text-sm font-medium text-gray-900">
                  {employee.last_punch_at
                    ? format(new Date(employee.last_punch_at), 'MMM dd, yyyy HH:mm')
                    : 'Never'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Edit Employee Form */}
        {showEditEmployee && employee && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit Employee</h3>
            <form onSubmit={editEmployeeForm.handleSubmit(onSubmitEditEmployee)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Name *</label>
                  <input
                    type="text"
                    {...editEmployeeForm.register('name')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                  {editEmployeeForm.formState.errors.name && (
                    <p className="mt-1 text-sm text-red-600">{editEmployeeForm.formState.errors.name.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status *</label>
                  <select
                    {...editEmployeeForm.register('status')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                  {editEmployeeForm.formState.errors.status && (
                    <p className="mt-1 text-sm text-red-600">{editEmployeeForm.formState.errors.status.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">PIN (leave empty to keep current, or enter new 4-digit PIN)</label>
                  <input
                    type="text"
                    maxLength={4}
                    {...editEmployeeForm.register('pin')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="Leave empty to keep current"
                  />
                  {editEmployeeForm.formState.errors.pin && (
                    <p className="mt-1 text-sm text-red-600">{editEmployeeForm.formState.errors.pin.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Job Role</label>
                  <input
                    type="text"
                    {...editEmployeeForm.register('job_role')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Pay Rate</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    {...editEmployeeForm.register('pay_rate')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowEditEmployee(false)
                    editEmployeeForm.reset()
                  }}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Manual Entry Form */}
        {showManualForm && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Manual Time Entry</h3>
            <form onSubmit={manualForm.handleSubmit(onSubmitManual)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Clock In Date</label>
                  <input
                    type="date"
                    {...manualForm.register('clock_in_at')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Clock In Time</label>
                  <input
                    type="time"
                    {...manualForm.register('clock_in_time')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Clock Out Date (Optional)</label>
                  <input
                    type="date"
                    {...manualForm.register('clock_out_at')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Clock Out Time (Optional)</label>
                  <input
                    type="time"
                    {...manualForm.register('clock_out_time')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Break Minutes</label>
                  <input
                    type="number"
                    {...manualForm.register('break_minutes')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Note (Optional)</label>
                  <input
                    type="text"
                    {...manualForm.register('note')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  Create Entry
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowManualForm(false)
                    manualForm.reset()
                  }}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Edit Entry Form */}
        {editingEntry && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit Time Entry</h3>
            <form onSubmit={editForm.handleSubmit(onSubmitEdit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Clock In Date</label>
                  <input
                    type="date"
                    {...editForm.register('clock_in_at')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Clock In Time</label>
                  <input
                    type="time"
                    {...editForm.register('clock_in_time')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Clock Out Date (Optional)</label>
                  <input
                    type="date"
                    {...editForm.register('clock_out_at')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Clock Out Time (Optional)</label>
                  <input
                    type="time"
                    {...editForm.register('clock_out_time')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Break Minutes</label>
                  <input
                    type="number"
                    {...editForm.register('break_minutes')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Edit Reason *</label>
                  <input
                    type="text"
                    {...editForm.register('edit_reason')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingEntry(null)
                    editForm.reset()
                  }}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Time Entries Section */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="p-5 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-900">Time Entries</h2>
            {!showManualForm && !editingEntry && (
              <button
                onClick={() => setShowManualForm(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
              >
                Add Manual Entry
              </button>
            )}
          </div>

          {loadingEntries ? (
            <div className="p-12 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-sm text-gray-600">Loading entries...</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Clock In
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Clock Out
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Hours
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Break
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {entries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center">
                          <p className="text-gray-500">No time entries found</p>
                        </td>
                      </tr>
                    ) : (
                      entries.map((entry) => (
                        <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {entry.clock_in_at_local
                              ? entry.clock_in_at_local.split(' ')[0]
                              : format(new Date(entry.clock_in_at), 'MMM dd, yyyy')}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                            {entry.clock_in_at_local
                              ? entry.clock_in_at_local.split(' ')[1]?.substring(0, 5)
                              : format(new Date(entry.clock_in_at), 'HH:mm')}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                            {entry.clock_out_at_local ? (
                              entry.clock_out_at_local.split(' ')[1]?.substring(0, 5)
                            ) : entry.clock_out_at ? (
                              format(new Date(entry.clock_out_at), 'HH:mm')
                            ) : (
                              <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold">Open</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                            {calculateHours(entry)} hrs
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                            {entry.break_minutes} min
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                              entry.status === 'closed' ? 'bg-green-100 text-green-800' :
                              entry.status === 'open' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {entry.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <button
                              onClick={() => handleEditClick(entry)}
                              className="text-blue-600 hover:text-blue-700 font-medium"
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {total > 0 && (
                <div className="p-4 border-t border-gray-200">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-sm text-gray-700">
                      Showing <span className="font-medium">{startEntry}</span> to <span className="font-medium">{endEntry}</span> of{' '}
                      <span className="font-medium">{total}</span> entries
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentPage(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="px-3 py-1 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>
                      <span className="px-3 py-1 text-sm text-gray-700">
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  )
}

