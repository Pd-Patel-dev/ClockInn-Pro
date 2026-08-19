'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import { format } from 'date-fns'
import logger from '@/lib/logger'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useToast } from '@/components/Toast'
import ConfirmationDialog from '@/components/ConfirmationDialog'
import BackButton from '@/components/BackButton'
import EmployeeForm, {
  editEmployeeSchema,
  EditEmployeeFormValues,
  EMPLOYEE_ROLE_OPTIONS,
  toUpdatePayload,
} from '@/components/employees/EmployeeForm'

interface Employee {
  id: string
  name: string
  email: string
  role: string
  status: string
  pay_rate: number | null
  preferred_name?: string | null
  phone?: string | null
  job_role?: string | null
  has_pin: boolean
  last_punch_at: string | null
  last_login_at: string | null
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

type ManualEntryForm = z.infer<typeof manualEntrySchema>
type EditEntryForm = z.infer<typeof editEntrySchema>

function roleLabel(role: string) {
  return EMPLOYEE_ROLE_OPTIONS.find((r) => r.value === role)?.label || role
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </dt>
      <dd className="mt-1.5 text-sm font-medium text-slate-900 break-words">{value ?? '—'}</dd>
    </div>
  )
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: string
}) {
  return (
    <div className="min-w-0 px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tracking-tight text-slate-900 tabular-nums truncate">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default function EmployeeDetailPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const employeeId = params?.id as string
  const toast = useToast()
  const isValidEmployeeId = Boolean(employeeId && UUID_RE.test(employeeId))

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
  const [resettingPassword, setResettingPassword] = useState(false)
  const pageSize = 20

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

  const editEmployeeForm = useForm<EditEmployeeFormValues>({
    resolver: zodResolver(editEmployeeSchema),
  })

  const populateEditForm = (data: Employee) => {
    editEmployeeForm.reset({
      name: data.name,
      preferred_name: data.preferred_name || '',
      phone: data.phone || '',
      status: (data.status as 'active' | 'inactive') || 'active',
      role: data.role as EditEmployeeFormValues['role'],
      pin: '',
      job_role: data.job_role || '',
      pay_rate: data.pay_rate?.toString() || '',
    })
  }

  const closeEditEmployeeForm = () => {
    setShowEditEmployee(false)
    if (employee) populateEditForm(employee)
    router.replace(`/employees/${employeeId}`, { scroll: false })
  }

  useEffect(() => {
    if (!employeeId) return
    if (employeeId === 'new') {
      router.replace('/employees/create')
      return
    }
    if (!isValidEmployeeId) {
      setLoading(false)
      setError('Invalid employee link')
      return
    }

    const checkAdmin = async () => {
      try {
        const user = await getCurrentUser()
        if (!(user.permissions || []).includes('user_management')) {
          router.push('/dashboard')
          return
        }
        fetchEmployee()
        fetchEntries()
      } catch {
        router.push('/login')
      }
    }
    checkAdmin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, employeeId, isValidEmployeeId])

  useEffect(() => {
    if (searchParams.get('edit') === '1') {
      setShowEditEmployee(true)
    }
  }, [searchParams])

  useEffect(() => {
    if (isValidEmployeeId) {
      fetchEntries()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, employeeId, isValidEmployeeId])

  const fetchEmployee = async () => {
    try {
      const response = await api.get(`/users/admin/employees/${employeeId}`)
      setEmployee(response.data)
      if (response.data) {
        populateEditForm(response.data)
      }
    } catch (err: any) {
      logger.error('Failed to fetch employee', err as Error, { employeeId })
      if (err.response?.status === 404) {
        setError('Employee not found')
      } else {
        setError(err.response?.data?.detail || 'Failed to load employee details')
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
    } catch (err: any) {
      logger.error('Failed to fetch time entries', err as Error, { employeeId })
    } finally {
      setLoadingEntries(false)
    }
  }

  const onSubmitManual = async (data: ManualEntryForm) => {
    try {
      const clockIn = new Date(`${data.clock_in_at}T${data.clock_in_time}`)
      const clockOut =
        data.clock_out_at && data.clock_out_time
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
    } catch (err: any) {
      logger.error('Failed to create manual entry', err as Error)
      setError(err.response?.data?.detail || 'Failed to create time entry')
    }
  }

  const onSubmitEdit = async (data: EditEntryForm) => {
    if (!editingEntry) return

    try {
      const clockIn = new Date(`${data.clock_in_at}T${data.clock_in_time}`)
      const clockOut =
        data.clock_out_at && data.clock_out_time
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
    } catch (err: any) {
      logger.error('Failed to edit entry', err as Error)
      setError(err.response?.data?.detail || 'Failed to edit time entry')
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
    } catch (err: any) {
      logger.error('Failed to delete entry', err as Error)
      toast.error(err.response?.data?.detail || 'Failed to delete time entry')
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

  const onSubmitEditEmployee = async (data: EditEmployeeFormValues) => {
    setUpdating(true)
    try {
      const updateData = toUpdatePayload(data) as Record<string, unknown>

      if (data.pin !== undefined) {
        if (data.pin.trim() === '' && employee?.has_pin) {
          // leave empty = keep existing PIN (do not send)
          delete updateData.pin
        } else if (data.pin.trim().length === 4) {
          updateData.pin = data.pin.trim()
        } else {
          delete updateData.pin
        }
      }

      if (data.pay_rate === undefined || data.pay_rate.trim() === '') {
        // omit clearing pay rate unless explicitly set
      }

      await api.put(`/users/admin/employees/${employeeId}`, updateData)

      toast.success('Employee updated successfully!')
      setShowEditEmployee(false)
      router.replace(`/employees/${employeeId}`, { scroll: false })
      fetchEmployee()
      setError(null)
    } catch (err: any) {
      logger.error('Failed to update employee', err as Error)
      const errorMessage =
        err.response?.data?.detail || err.response?.data?.message || 'Failed to update employee'
      toast.error(Array.isArray(errorMessage) ? errorMessage.join(', ') : errorMessage)
    } finally {
      setUpdating(false)
    }
  }

  const handleResetPassword = async () => {
    const newPassword = window.prompt(
      'Enter a new temporary password (min 8 characters). The employee can change it after logging in.'
    )
    if (!newPassword) return
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setResettingPassword(true)
    try {
      await api.post(
        `/users/admin/employees/${employeeId}/reset-password?new_password=${encodeURIComponent(newPassword)}`
      )
      toast.success('Password reset successfully')
    } catch (err: any) {
      logger.error('Failed to reset password', err as Error)
      toast.error(err.response?.data?.detail || 'Failed to reset password')
    } finally {
      setResettingPassword(false)
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
          <BackButton fallbackHref="/employees">Employees</BackButton>
          <div className="mt-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
            <p>{error}</p>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="relative px-4 py-8 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-4 h-56 overflow-hidden"
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(15,23,42,0.06),_transparent_65%)]" />
          <div
            className="absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgb(226 232 240 / 0.55) 1px, transparent 1px), linear-gradient(to bottom, rgb(226 232 240 / 0.55) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
              maskImage: 'linear-gradient(to bottom, black, transparent)',
            }}
          />
        </div>

        <div className="relative space-y-6">
        <div>
          <BackButton fallbackHref="/employees">Employees</BackButton>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl">
            <p className="text-sm">{error}</p>
          </div>
        )}

        {employee && (
          <>
            {/* Profile hero */}
            <div className="overflow-hidden rounded-2xl border border-slate-800/10 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.45)]">
              <div className="relative bg-slate-900 px-5 py-6 sm:px-7 sm:py-7 text-white">
                <div
                  aria-hidden
                  className="absolute inset-0 opacity-40"
                  style={{
                    backgroundImage:
                      'radial-gradient(circle at 12% 20%, rgba(45,212,191,0.28), transparent 42%), radial-gradient(circle at 88% 10%, rgba(59,130,246,0.22), transparent 36%)',
                  }}
                />
                <div
                  aria-hidden
                  className="absolute inset-y-0 right-0 w-1/2 opacity-[0.07]"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(-32deg, transparent, transparent 10px, white 10px, white 11px)',
                  }}
                />

                <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4 sm:gap-5 min-w-0">
                    <div className="relative flex-shrink-0">
                      <div className="flex h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem] items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20 backdrop-blur-sm text-2xl font-semibold tracking-tight">
                        {(employee.preferred_name || employee.name).charAt(0).toUpperCase()}
                      </div>
                      {employee.is_clocked_in && (
                        <span
                          className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-emerald-400 ring-2 ring-slate-900"
                          title="Clocked in"
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight truncate">
                        {employee.name}
                      </h1>
                      {employee.preferred_name && (
                        <p className="mt-0.5 text-sm text-slate-300">
                          Goes by {employee.preferred_name}
                        </p>
                      )}
                      <p className="mt-1 text-sm text-slate-400 truncate">{employee.email}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                            employee.status === 'active'
                              ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/30'
                              : 'bg-white/10 text-slate-300 ring-white/15'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              employee.status === 'active' ? 'bg-emerald-300' : 'bg-slate-400'
                            }`}
                          />
                          {employee.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                        <span className="inline-flex rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-slate-200 ring-1 ring-inset ring-white/15">
                          {roleLabel(employee.role)}
                        </span>
                        {employee.is_clocked_in && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-medium text-amber-100 ring-1 ring-inset ring-amber-300/30">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse" />
                            On shift
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {!showEditEmployee && (
                    <div className="flex flex-wrap gap-2 sm:shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          populateEditForm(employee)
                          setShowEditEmployee(true)
                        }}
                        className="px-4 py-2 rounded-lg bg-white text-slate-900 text-sm font-semibold hover:bg-slate-100 transition-colors"
                      >
                        Edit profile
                      </button>
                      <button
                        type="button"
                        onClick={handleResetPassword}
                        disabled={resettingPassword}
                        className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm font-medium ring-1 ring-inset ring-white/20 hover:bg-white/15 transition-colors disabled:opacity-50"
                      >
                        {resettingPassword ? 'Resetting…' : 'Reset password'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {!showEditEmployee && (
                <div className="grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 divide-slate-100 bg-white border-t border-slate-800/5">
                  <Metric
                    label="Pay rate"
                    value={
                      employee.pay_rate != null ? `$${employee.pay_rate.toFixed(2)}` : '—'
                    }
                    hint={employee.pay_rate != null ? 'per hour' : undefined}
                  />
                  <Metric
                    label="Job title"
                    value={employee.job_role || '—'}
                  />
                  <Metric
                    label="Kiosk PIN"
                    value={employee.has_pin ? 'Set' : 'Not set'}
                  />
                  <Metric
                    label="Last punch"
                    value={
                      employee.last_punch_at
                        ? format(new Date(employee.last_punch_at), 'MMM d · HH:mm')
                        : 'Never'
                    }
                  />
                </div>
              )}
            </div>

            {showEditEmployee ? (
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 backdrop-blur-sm p-5 sm:p-6 shadow-sm">
                <div className="mb-5">
                  <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                    Edit employee
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Update profile details, then save changes.
                  </p>
                </div>
                <form onSubmit={editEmployeeForm.handleSubmit(onSubmitEditEmployee)}>
                  <EmployeeForm
                    mode="edit"
                    register={editEmployeeForm.register}
                    errors={editEmployeeForm.formState.errors}
                    emailReadOnly={employee.email}
                    hasPin={employee.has_pin}
                    submitting={updating}
                    onCancel={closeEditEmployeeForm}
                  />
                </form>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
                <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Profile details</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Contact, access, and employment info
                    </p>
                  </div>
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6 p-5 sm:p-6">
                  <DetailItem label="Full name" value={employee.name} />
                  <DetailItem label="Preferred name" value={employee.preferred_name || '—'} />
                  <DetailItem label="Email" value={employee.email} />
                  <DetailItem label="Phone" value={employee.phone || '—'} />
                  <DetailItem label="Role" value={roleLabel(employee.role)} />
                  <DetailItem
                    label="Status"
                    value={employee.status === 'active' ? 'Active' : 'Inactive'}
                  />
                  <DetailItem label="Job title" value={employee.job_role || '—'} />
                  <DetailItem
                    label="Hourly pay"
                    value={
                      employee.pay_rate != null ? `$${employee.pay_rate.toFixed(2)}/hr` : '—'
                    }
                  />
                  <DetailItem label="PIN" value={employee.has_pin ? 'Set' : 'Not set'} />
                  <DetailItem
                    label="Last login"
                    value={
                      employee.last_login_at
                        ? format(new Date(employee.last_login_at), 'MMM dd, yyyy · HH:mm')
                        : 'Never'
                    }
                  />
                  <DetailItem
                    label="Created"
                    value={
                      employee.created_at
                        ? format(new Date(employee.created_at), 'MMM dd, yyyy')
                        : '—'
                    }
                  />
                </dl>
              </div>
            )}
          </>
        )}

        {/* Add Manual Entry Modal */}
        {showManualForm && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
            <div className="relative bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl m-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold text-slate-900">Add Manual Time Entry</h3>
                <button
                  onClick={closeManualForm}
                  className="text-slate-400 hover:text-slate-600 text-2xl"
                >
                  ×
                </button>
              </div>
              <form onSubmit={manualForm.handleSubmit(onSubmitManual)} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Clock In Date
                    </label>
                    <input
                      type="date"
                      {...manualForm.register('clock_in_at')}
                      className="block w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                    {manualForm.formState.errors.clock_in_at && (
                      <p className="mt-1 text-sm text-red-600">
                        {manualForm.formState.errors.clock_in_at.message}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Clock In Time
                    </label>
                    <input
                      type="time"
                      {...manualForm.register('clock_in_time')}
                      className="block w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                    {manualForm.formState.errors.clock_in_time && (
                      <p className="mt-1 text-sm text-red-600">
                        {manualForm.formState.errors.clock_in_time.message}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Clock Out Date (Optional)
                    </label>
                    <input
                      type="date"
                      {...manualForm.register('clock_out_at')}
                      className="block w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Clock Out Time (Optional)
                    </label>
                    <input
                      type="time"
                      {...manualForm.register('clock_out_time')}
                      className="block w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Break Minutes
                    </label>
                    <input
                      type="number"
                      {...manualForm.register('break_minutes')}
                      className="block w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Note (Optional)
                    </label>
                    <input
                      type="text"
                      {...manualForm.register('note')}
                      className="block w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  </div>
                </div>
                <div className="flex gap-3 pt-4 border-t border-slate-200">
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                  >
                    Create Entry
                  </button>
                  <button
                    type="button"
                    onClick={closeManualForm}
                    className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 font-medium"
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
            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl m-4">
              <div className="flex justify-between items-center px-8 py-6 border-b border-slate-200">
                <div>
                  <h3 className="text-2xl font-bold text-slate-900">Edit Time Entry</h3>
                  <p className="text-sm text-slate-500 mt-1">Update the time entry details below</p>
                </div>
                <button
                  onClick={closeEditForm}
                  className="text-slate-400 hover:text-slate-600 text-3xl leading-none transition-colors"
                  disabled={deletingEntry}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <form onSubmit={editForm.handleSubmit(onSubmitEdit)} className="p-8">
                <div className="mb-8">
                  <h4 className="text-lg font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
                    Clock In
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-3">
                        Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        {...editForm.register('clock_in_at')}
                        className="block w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        disabled={deletingEntry}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-3">
                        Time <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="time"
                        {...editForm.register('clock_in_time')}
                        className="block w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        disabled={deletingEntry}
                      />
                    </div>
                  </div>
                </div>

                <div className="mb-8">
                  <h4 className="text-lg font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
                    Clock Out
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-3">
                        Date <span className="text-slate-400 text-xs font-normal">(Optional)</span>
                      </label>
                      <input
                        type="date"
                        {...editForm.register('clock_out_at')}
                        className="block w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        disabled={deletingEntry}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-3">
                        Time <span className="text-slate-400 text-xs font-normal">(Optional)</span>
                      </label>
                      <input
                        type="time"
                        {...editForm.register('clock_out_time')}
                        className="block w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        disabled={deletingEntry}
                      />
                    </div>
                  </div>
                </div>

                <div className="mb-8">
                  <h4 className="text-lg font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
                    Additional Information
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-3">
                        Break Minutes
                      </label>
                      <input
                        type="number"
                        {...editForm.register('break_minutes')}
                        min="0"
                        className="block w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        disabled={deletingEntry}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-slate-700 mb-3">
                        Edit Reason <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        {...editForm.register('edit_reason')}
                        placeholder="Enter reason for editing this time entry"
                        className="block w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        disabled={deletingEntry}
                      />
                      {editForm.formState.errors.edit_reason && (
                        <p className="mt-2 text-sm text-red-600 font-medium">
                          {editForm.formState.errors.edit_reason.message}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 pt-6 mt-8 border-t border-slate-200">
                  <button
                    type="submit"
                    disabled={deletingEntry}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm disabled:opacity-50"
                  >
                    Save Changes
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteEntry}
                    disabled={deletingEntry}
                    className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold text-sm disabled:opacity-50"
                  >
                    {deletingEntry ? 'Deleting...' : 'Delete'}
                  </button>
                  <button
                    type="button"
                    onClick={closeEditForm}
                    disabled={deletingEntry}
                    className="px-6 py-3 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 font-semibold text-sm disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Time Entries Section */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
          <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Time entries</h2>
              <p className="text-xs text-slate-500 mt-0.5">Punch history for this employee</p>
            </div>
            {!showManualForm && !editingEntry && (
              <button
                onClick={() => setShowManualForm(true)}
                className="px-3.5 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 font-medium text-sm transition-colors"
              >
                Add manual entry
              </button>
            )}
          </div>

          {loadingEntries ? (
            <div className="p-12 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-sm text-slate-600">Loading entries...</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                        Clock In
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                        Clock Out
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                        Hours
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                        Break
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-200">
                    {entries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center">
                          <p className="text-slate-500">No time entries found</p>
                        </td>
                      </tr>
                    ) : (
                      entries.map((entry) => (
                        <tr key={entry.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                            {entry.clock_in_at_local
                              ? entry.clock_in_at_local.split(' ')[0]
                              : format(new Date(entry.clock_in_at), 'MMM dd, yyyy')}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                            {entry.clock_in_at_local
                              ? entry.clock_in_at_local.split(' ')[1]?.substring(0, 5)
                              : format(new Date(entry.clock_in_at), 'HH:mm')}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                            {entry.clock_out_at_local ? (
                              entry.clock_out_at_local.split(' ')[1]?.substring(0, 5)
                            ) : entry.clock_out_at ? (
                              format(new Date(entry.clock_out_at), 'HH:mm')
                            ) : (
                              <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold">
                                Open
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-900">
                            {calculateHours(entry)} hrs
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                            {entry.break_minutes} min
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span
                              className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                entry.status === 'closed'
                                  ? 'bg-green-100 text-green-800'
                                  : entry.status === 'open'
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-slate-100 text-slate-800'
                              }`}
                            >
                              {entry.status
                                ? entry.status.charAt(0).toUpperCase() +
                                  entry.status.slice(1).toLowerCase()
                                : entry.status}
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

              {total > 0 && (
                <div className="p-4 border-t border-slate-200">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-sm text-slate-700">
                      Showing <span className="font-medium">{startEntry}</span> to{' '}
                      <span className="font-medium">{endEntry}</span> of{' '}
                      <span className="font-medium">{total}</span> entries
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentPage(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="px-3 py-1 border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>
                      <span className="px-3 py-1 text-sm text-slate-700">
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1 border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
      </div>

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
