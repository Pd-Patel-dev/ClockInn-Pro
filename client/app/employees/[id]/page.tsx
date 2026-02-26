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
import { useToast } from '@/components/Toast'
import ConfirmationDialog from '@/components/ConfirmationDialog'
import { FormField, Input, Select } from '@/components/FormField'
import { ButtonSpinner } from '@/components/LoadingSpinner'

interface Employee {
  id: string
  name: string
  email: string
  status: string
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
  role: z.enum(['MAINTENANCE', 'FRONTDESK', 'HOUSEKEEPING', 'ADMIN']).optional(),
  pin: z.string().length(4, 'PIN must be 4 digits').optional().or(z.literal('')),
  pay_rate: z.string().optional(),
})

type ManualEntryForm = z.infer<typeof manualEntrySchema>
type EditEntryForm = z.infer<typeof editEntrySchema>
type EditEmployeeForm = z.infer<typeof editEmployeeSchema>

export default function EmployeeDetailPage() {
  const router = useRouter()
  const params = useParams()
  const employeeId = params?.id as string
  const toast = useToast()

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
  const [deletingEntry, setDeletingEntry] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [updating, setUpdating] = useState(false)
  const pageSize = 20

  const closeEditEmployeeForm = () => {
    setShowEditEmployee(false)
    editEmployeeForm.reset()
  }

  const manualForm = useForm<ManualEntryForm>({
    resolver: zodResolver(manualEntrySchema),
    defaultValues: {
      clock_in_at: new Date().toISOString().split('T')[0],
      clock_in_time: new Date().toTimeString().slice(0, 5),
      break_minutes: 0,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, employeeId])

  useEffect(() => {
    if (employeeId) {
      fetchEntries()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          role: response.data.role as 'MAINTENANCE' | 'FRONTDESK' | 'HOUSEKEEPING' | 'ADMIN',
          pin: '',
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

      toast.success('Manual time entry created successfully')
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

      toast.success('Time entry updated successfully')
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
      break_minutes: entry.break_minutes,
      edit_reason: '',
    })
    setEditingEntry(entry)
  }

  const handleDeleteEntry = () => {
    if (!editingEntry) return
    setShowDeleteConfirm(true)
  }

  const confirmDeleteEntry = async () => {
    if (!editingEntry) return
    setShowDeleteConfirm(false)
    setDeletingEntry(true)
    try {
      await api.delete(`/time/admin/time/${editingEntry.id}`)
      toast.success('Time entry deleted successfully')
      setEditingEntry(null)
      editForm.reset()
      fetchEntries()
    } catch (error: any) {
      logger.error('Failed to delete entry', error as Error)
      toast.error(error.response?.data?.detail || 'Failed to delete time entry')
    } finally {
      setDeletingEntry(false)
    }
  }

  const closeEditForm = () => {
    setEditingEntry(null)
    editForm.reset()
  }

  const closeManualForm = () => {
    setShowManualForm(false)
    manualForm.reset()
  }

  const onSubmitEditEmployee = async (data: EditEmployeeForm) => {
    setUpdating(true)
    try {
      const updateData: any = {
        name: data.name,
        status: data.status,
      }

      // Include role if provided
      if (data.role !== undefined) {
        updateData.role = data.role
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
      
      toast.success('Employee updated successfully!')
      setShowEditEmployee(false)
      editEmployeeForm.reset()
      fetchEmployee()
      setError(null)
    } catch (error: any) {
      logger.error('Failed to update employee', error as Error)
      const errorMessage = error.response?.data?.detail || error.response?.data?.message || 'Failed to update employee'
      toast.error(Array.isArray(errorMessage) ? errorMessage.join(', ') : errorMessage)
    } finally {
      setUpdating(false)
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
                      {employee.status ? employee.status.charAt(0).toUpperCase() + employee.status.slice(1).toLowerCase() : employee.status}
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

        {/* Edit Employee Modal */}
        {showEditEmployee && employee && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl m-4">
              {/* Header */}
              <div className="flex justify-between items-center px-8 py-6 border-b border-gray-200">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">Edit Employee</h3>
                  <p className="text-sm text-gray-500 mt-1">Update employee information below</p>
                </div>
                <button
                  onClick={closeEditEmployeeForm}
                  className="text-gray-400 hover:text-gray-600 text-3xl leading-none transition-colors"
                  disabled={updating}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              {/* Form Content */}
              <form onSubmit={editEmployeeForm.handleSubmit(onSubmitEditEmployee)} className="p-8">
                {/* Basic Information Section */}
                <div className="mb-8">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-200">
                    Basic Information
                  </h4>
                  <div className="space-y-5">
                    <FormField label="Name" error={editEmployeeForm.formState.errors.name?.message} required>
                      <Input {...editEmployeeForm.register('name')} error={!!editEmployeeForm.formState.errors.name} />
                    </FormField>
                    
                    <FormField label="Email" hint="Email cannot be changed">
                      <Input
                        type="email"
                        value={employee.email}
                        disabled
                        className="bg-gray-100 text-gray-500 cursor-not-allowed"
                      />
                    </FormField>
                    
                    <FormField label="Status" error={editEmployeeForm.formState.errors.status?.message} required>
                      <Select {...editEmployeeForm.register('status')} error={!!editEmployeeForm.formState.errors.status}>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </Select>
                    </FormField>
                    
                    <FormField label="Role" error={editEmployeeForm.formState.errors.role?.message}>
                      <Select {...editEmployeeForm.register('role')} error={!!editEmployeeForm.formState.errors.role}>
                        <option value="FRONTDESK">Front Desk</option>
                        <option value="MAINTENANCE">Maintenance</option>
                        <option value="HOUSEKEEPING">Housekeeping</option>
                        <option value="ADMIN">Admin</option>
                      </Select>
                    </FormField>
                  </div>
                </div>

                {/* Additional Details Section */}
                <div className="mb-8">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-200">
                    Additional Details
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField 
                      label="PIN" 
                      error={editEmployeeForm.formState.errors.pin?.message}
                      hint={employee.has_pin ? 'Leave empty to keep current PIN, or enter new 4-digit PIN' : 'Enter 4-digit PIN or leave empty'}
                    >
                      <Input 
                        {...editEmployeeForm.register('pin')} 
                        type="text" 
                        maxLength={4} 
                        error={!!editEmployeeForm.formState.errors.pin}
                        placeholder="Enter new 4-digit PIN"
                      />
                    </FormField>
                    
                    <FormField label="Pay Rate" error={editEmployeeForm.formState.errors.pay_rate?.message} hint="Hourly rate in dollars">
                      <Input {...editEmployeeForm.register('pay_rate')} type="number" step="0.01" min="0" error={!!editEmployeeForm.formState.errors.pay_rate} />
                    </FormField>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-4 pt-6 mt-8 border-t border-gray-200">
                  <button
                    type="submit"
                    disabled={updating}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-md flex items-center justify-center gap-2"
                  >
                    {updating && <ButtonSpinner />}
                    {updating ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    type="button"
                    onClick={closeEditEmployeeForm}
                    disabled={updating}
                    className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add Manual Entry Modal */}
        {showManualForm && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
            <div className="relative bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl m-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold text-gray-900">Add Manual Time Entry</h3>
                <button
                  onClick={closeManualForm}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
              <form onSubmit={manualForm.handleSubmit(onSubmitManual)} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Clock In Date</label>
                    <input
                      type="date"
                      {...manualForm.register('clock_in_at')}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                    {manualForm.formState.errors.clock_in_at && (
                      <p className="mt-1 text-sm text-red-600">{manualForm.formState.errors.clock_in_at.message}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Clock In Time</label>
                    <input
                      type="time"
                      {...manualForm.register('clock_in_time')}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                    {manualForm.formState.errors.clock_in_time && (
                      <p className="mt-1 text-sm text-red-600">{manualForm.formState.errors.clock_in_time.message}</p>
                    )}
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
                <div className="flex gap-3 pt-4 border-t border-gray-200">
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                  >
                    Create Entry
                  </button>
                  <button
                    type="button"
                    onClick={closeManualForm}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit Entry Modal */}
        {editingEntry && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl m-4">
              {/* Header */}
              <div className="flex justify-between items-center px-8 py-6 border-b border-gray-200">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">Edit Time Entry</h3>
                  <p className="text-sm text-gray-500 mt-1">Update the time entry details below</p>
                </div>
                <button
                  onClick={closeEditForm}
                  className="text-gray-400 hover:text-gray-600 text-3xl leading-none transition-colors"
                  disabled={deletingEntry}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              {/* Form Content */}
              <form onSubmit={editForm.handleSubmit(onSubmitEdit)} className="p-8">
                {/* Clock In Section */}
                <div className="mb-8">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-200">
                    Clock In
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-3">
                        Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        {...editForm.register('clock_in_at')}
                        className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm transition-all shadow-sm hover:border-gray-400"
                        disabled={deletingEntry}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-3">
                        Time <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="time"
                        {...editForm.register('clock_in_time')}
                        className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm transition-all shadow-sm hover:border-gray-400"
                        disabled={deletingEntry}
                      />
                    </div>
                  </div>
                </div>

                {/* Clock Out Section */}
                <div className="mb-8">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-200">
                    Clock Out
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-3">
                        Date <span className="text-gray-400 text-xs font-normal">(Optional)</span>
                      </label>
                      <input
                        type="date"
                        {...editForm.register('clock_out_at')}
                        className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm transition-all shadow-sm hover:border-gray-400"
                        disabled={deletingEntry}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-3">
                        Time <span className="text-gray-400 text-xs font-normal">(Optional)</span>
                      </label>
                      <input
                        type="time"
                        {...editForm.register('clock_out_time')}
                        className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm transition-all shadow-sm hover:border-gray-400"
                        disabled={deletingEntry}
                      />
                    </div>
                  </div>
                </div>

                {/* Additional Information Section */}
                <div className="mb-8">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-200">
                    Additional Information
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-3">
                        Break Minutes
                      </label>
                      <input
                        type="number"
                        {...editForm.register('break_minutes')}
                        min="0"
                        className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm transition-all shadow-sm hover:border-gray-400"
                        disabled={deletingEntry}
                      />
                      <p className="mt-2 text-xs text-gray-500">Total break time in minutes</p>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-gray-700 mb-3">
                        Edit Reason <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        {...editForm.register('edit_reason')}
                        placeholder="Enter reason for editing this time entry"
                        className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm transition-all shadow-sm hover:border-gray-400"
                        disabled={deletingEntry}
                      />
                      {editForm.formState.errors.edit_reason && (
                        <p className="mt-2 text-sm text-red-600 font-medium">
                          {editForm.formState.errors.edit_reason.message}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-gray-500">Please provide a reason for making changes to this entry</p>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-4 pt-6 mt-8 border-t border-gray-200">
                  <button
                    type="submit"
                    disabled={deletingEntry}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-md"
                  >
                    Save Changes
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteEntry}
                    disabled={deletingEntry}
                    className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold text-sm shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-md"
                  >
                    {deletingEntry ? 'Deleting...' : 'Delete'}
                  </button>
                  <button
                    type="button"
                    onClick={closeEditForm}
                    disabled={deletingEntry}
                    className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
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
                              {entry.status ? entry.status.charAt(0).toUpperCase() + entry.status.slice(1).toLowerCase() : entry.status}
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

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        title="Delete Time Entry"
        message="Are you sure you want to delete this time entry? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        type="warning"
        onConfirm={confirmDeleteEntry}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </Layout>
  )
}

