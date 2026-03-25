'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser, User } from '@/lib/auth'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import logger from '@/lib/logger'
import { useDebounce } from '@/hooks/useDebounce'
import { TableSkeleton } from '@/components/LoadingSkeleton'
import { EmployeeRow } from '@/components/EmployeeRow'
import { useToast } from '@/components/Toast'
import { ButtonSpinner } from '@/components/LoadingSpinner'
import { FormField, Input, Select } from '@/components/FormField'
import ConfirmationDialog from '@/components/ConfirmationDialog'

const employeeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  role: z
    .enum(['MAINTENANCE', 'FRONTDESK', 'HOUSEKEEPING', 'RESTAURANT', 'SECURITY', 'MANAGER', 'ADMIN'])
    .default('FRONTDESK'),
  pin: z.string().length(4, 'PIN must be 4 digits').optional(),
  pay_rate: z.string().optional().transform((val) => {
    if (!val || val === '') return undefined
    const num = parseFloat(val)
    return isNaN(num) ? undefined : num
  }).pipe(z.number().min(0).optional().or(z.undefined())),
})

const editEmployeeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  status: z.enum(['active', 'inactive']),
  role: z
    .enum(['MAINTENANCE', 'FRONTDESK', 'HOUSEKEEPING', 'RESTAURANT', 'SECURITY', 'MANAGER', 'ADMIN'])
    .optional(),
  pin: z.string().length(4, 'PIN must be 4 digits').optional().or(z.literal('')),
  pay_rate: z.string().optional(),
})

type EmployeeForm = z.infer<typeof employeeSchema>
type EditEmployeeForm = z.infer<typeof editEmployeeSchema>

interface Employee {
  id: string
  name: string
  email: string
  role: string
  status: 'active' | 'inactive'
  has_pin: boolean
  pay_rate: number | null
  created_at: string
  last_login_at: string | null
  last_punch_at: string | null
  is_clocked_in: boolean | null
}

export default function AdminEmployeesPage() {
  const router = useRouter()
  const toast = useToast()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [deletingEmployee, setDeletingEmployee] = useState<string | null>(null)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [employeeToDelete, setEmployeeToDelete] = useState<{ id: string; name: string } | null>(null)
  
  // Debounce search query
  const debouncedSearchQuery = useDebounce(searchQuery, 300)

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<EmployeeForm>({
    resolver: zodResolver(employeeSchema),
  })

  const {
    register: registerEdit,
    handleSubmit: handleSubmitEdit,
    formState: { errors: editErrors },
    reset: resetEdit,
    setValue: setEditValue,
  } = useForm<EditEmployeeForm>({
    resolver: zodResolver(editEmployeeSchema),
  })

  useEffect(() => {
    // Check if user is admin
    const checkAdminAndFetch = async () => {
      try {
        const user = await getCurrentUser()
        if (!(user.permissions || []).includes('user_management')) {
          router.push('/dashboard')
          return
        }
        fetchEmployees()
      } catch (err) {
        router.push('/login')
      }
    }
    checkAdminAndFetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const fetchEmployees = async () => {
    setLoading(true)
    try {
      const response = await api.get('/users/admin/employees')
      logger.debug('Employees data fetched', { count: response.data?.length })
      setEmployees(response.data || [])
    } catch (error: any) {
      logger.error('Failed to fetch employees', error as Error, { endpoint: '/users/admin/employees' })
      // If 403 Forbidden, redirect to dashboard (user is not admin)
      if (error.response?.status === 403) {
        router.push('/dashboard')
      }
    } finally {
      setLoading(false)
    }
  }

  const closeAddForm = () => {
    setShowForm(false)
    reset()
  }

  const onSubmit = async (data: EmployeeForm) => {
    setSubmitting(true)
    try {
      await api.post('/users/admin/employees', data)
      toast.success('Employee created successfully!')
      reset()
      setShowForm(false)
      fetchEmployees()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to create employee')
    } finally {
      setSubmitting(false)
    }
  }

  const deleteEmployee = (employeeId: string, employeeName: string) => {
    setEmployeeToDelete({ id: employeeId, name: employeeName })
    setShowDeleteConfirm(true)
  }

  const confirmDeleteEmployee = async () => {
    if (!employeeToDelete) return
    setShowDeleteConfirm(false)
    const { id, name } = employeeToDelete
    setEmployeeToDelete(null)
    
    setDeletingEmployee(id)
    try {
      await api.delete(`/users/admin/employees/${id}`)
      toast.success('Employee deleted successfully!')
      fetchEmployees()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to delete employee')
    } finally {
      setDeletingEmployee(null)
    }
  }

  const openEditForm = (employee: Employee) => {
    setEditingEmployee(employee)
    // Reset form with employee data
    resetEdit({
      name: employee.name,
      status: employee.status,
      role:
        employee.role as
          | 'MAINTENANCE'
          | 'FRONTDESK'
          | 'HOUSEKEEPING'
          | 'RESTAURANT'
          | 'SECURITY'
          | 'MANAGER'
          | 'ADMIN',
      pin: '', // Don't pre-fill PIN for security
      pay_rate: employee.pay_rate?.toString() || '',
    })
  }

  const closeEditForm = () => {
    setEditingEmployee(null)
    resetEdit()
  }

  const onEditSubmit = async (data: EditEmployeeForm) => {
    if (!editingEmployee) return

    setUpdating(true)
    try {
      const updateData: any = {
        name: data.name,
        status: data.status,
      }
      
      // Always include role if provided (role is always set in the form)
      if (data.role !== undefined) {
        updateData.role = data.role
      }
      
      // Only include PIN if it was provided
      if (data.pin && data.pin.length === 4) {
        updateData.pin = data.pin
      }
      
      if (data.pay_rate !== undefined) {
        updateData.pay_rate = data.pay_rate || null
      }

      await api.put(`/users/admin/employees/${editingEmployee.id}`, updateData)
      toast.success('Employee updated successfully!')
      closeEditForm()
      fetchEmployees()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to update employee')
    } finally {
      setUpdating(false)
    }
  }

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      // Status filter
      if (statusFilter !== 'all' && emp.status !== statusFilter) {
        return false
      }
      
      // Search filter (debounced)
      if (debouncedSearchQuery.trim()) {
        const query = debouncedSearchQuery.toLowerCase()
        return (
          emp.name.toLowerCase().includes(query) ||
          emp.email.toLowerCase().includes(query)
        )
      }
      
      return true
    })
  }, [employees, statusFilter, debouncedSearchQuery])

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start">
          <div className="mb-6 sm:mb-0">
            <h1 className="text-2xl font-semibold text-slate-900">Employees</h1>
            <p className="mt-1 text-sm text-slate-500">Manage team members, roles, and access.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Add employee
          </button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            type="search"
            placeholder="Search name or email…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 w-full max-w-xs text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            aria-label="Search employees"
          />
          <div className="flex flex-wrap gap-2">
            {(['all', 'active', 'inactive'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  statusFilter === f
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Inactive'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={6} columns={10} />
        ) : (
          <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Clock</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">PIN</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Pay rate</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Created</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Last punch</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-16">
                        <div className="flex flex-col items-center justify-center text-center">
                          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                            <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                            </svg>
                          </div>
                          <p className="text-sm font-medium text-slate-700">No employees found</p>
                          <p className="text-sm text-slate-400 mt-1">Try adjusting search or filters</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredEmployees.map((employee) => (
                      <EmployeeRow
                        key={employee.id}
                        employee={employee}
                        onEdit={openEditForm}
                        onDelete={deleteEmployee}
                        deletingEmployee={deletingEmployee}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Add Employee Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm overflow-y-auto">
            <div className="relative bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-slate-900">New employee</h2>
                <button
                  type="button"
                  onClick={closeAddForm}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors text-xl leading-none"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <FormField label="Name" error={errors.name?.message} required>
                  <Input {...register('name')} error={!!errors.name} />
                </FormField>
                
                <FormField label="Email" error={errors.email?.message} required>
                  <Input {...register('email')} type="email" error={!!errors.email} />
                </FormField>
                
                <FormField label="Role" error={errors.role?.message} required>
                  <Select {...register('role')} error={!!errors.role}>
                    <option value="FRONTDESK">Front Desk</option>
                    <option value="MAINTENANCE">Maintenance</option>
                    <option value="HOUSEKEEPING">Housekeeping</option>
                    <option value="RESTAURANT">Restaurant</option>
                    <option value="SECURITY">Security</option>
                    <option value="MANAGER">Manager</option>
                    <option value="ADMIN">Administrator</option>
                  </Select>
                </FormField>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                  <p className="font-medium mb-1">Password setup</p>
                  <p>The employee will receive an email with a link to set their password.</p>
                </div>
                
                <FormField label="PIN" error={errors.pin?.message} hint="4-digit PIN for kiosk access (optional)">
                  <Input {...register('pin')} type="text" maxLength={4} error={!!errors.pin} />
                </FormField>
                
                <FormField label="Pay Rate" error={errors.pay_rate?.message} hint="Hourly rate in dollars (optional)">
                  <Input {...register('pay_rate')} type="number" step="0.01" min="0" error={!!errors.pay_rate} />
                </FormField>
                
                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={closeAddForm}
                    disabled={submitting}
                    className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {submitting && <ButtonSpinner />}
                    {submitting ? 'Creating…' : 'Create employee'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit Employee Modal */}
        {editingEmployee && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm overflow-y-auto">
            <div className="relative bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Edit employee</h3>
                  <p className="text-sm text-slate-500 mt-1">Update information below</p>
                </div>
                <button
                  type="button"
                  onClick={closeEditForm}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 text-2xl leading-none transition-colors"
                  disabled={updating}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmitEdit(onEditSubmit)} className="p-6">
                <div className="mb-8">
                  <h4 className="text-lg font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-100">
                    Basic information
                  </h4>
                  <div className="space-y-5">
                <FormField label="Name" error={editErrors.name?.message} required>
                  <Input {...registerEdit('name')} error={!!editErrors.name} />
                </FormField>
                
                <FormField label="Email" hint="Email cannot be changed">
                  <Input
                    type="email"
                    value={editingEmployee.email}
                    disabled
                    className="bg-slate-50 text-slate-500 cursor-not-allowed"
                  />
                </FormField>
                
                <FormField label="Status" error={editErrors.status?.message} required>
                  <Select {...registerEdit('status')} error={!!editErrors.status}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Select>
                </FormField>
                
                <FormField label="Role" error={editErrors.role?.message}>
                  <Select {...registerEdit('role')} error={!!editErrors.role}>
                    <option value="FRONTDESK">Front Desk</option>
                    <option value="MAINTENANCE">Maintenance</option>
                    <option value="HOUSEKEEPING">Housekeeping</option>
                    <option value="RESTAURANT">Restaurant</option>
                    <option value="SECURITY">Security</option>
                    <option value="MANAGER">Manager</option>
                    <option value="ADMIN">Administrator</option>
                  </Select>
                </FormField>
                  </div>
                </div>

                {/* Additional Details Section */}
                <div className="mb-8">
                  <h4 className="text-lg font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-100">
                    Additional details
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField 
                  label="PIN" 
                  error={editErrors.pin?.message}
                  hint={editingEmployee.has_pin ? 'Leave empty to keep current PIN, or enter new 4-digit PIN' : 'Enter 4-digit PIN or leave empty'}
                >
                  <Input 
                    {...registerEdit('pin')} 
                    type="text" 
                    maxLength={4} 
                    error={!!editErrors.pin}
                    placeholder="Enter new 4-digit PIN"
                  />
                </FormField>
                
                <FormField label="Pay Rate" error={editErrors.pay_rate?.message} hint="Hourly rate in dollars">
                  <Input {...registerEdit('pay_rate')} type="number" step="0.01" min="0" error={!!editErrors.pay_rate} />
                </FormField>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={closeEditForm}
                    disabled={updating}
                    className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={updating}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {updating && <ButtonSpinner />}
                    {updating ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Employee Confirmation Dialog */}
        <ConfirmationDialog
          isOpen={showDeleteConfirm}
          title="Delete Employee"
          message={employeeToDelete ? `Are you sure you want to delete ${employeeToDelete.name}? This action cannot be undone and will delete all associated time entries, leave requests, and sessions.` : ''}
          confirmText="Delete"
          cancelText="Cancel"
          type="warning"
          onConfirm={confirmDeleteEmployee}
          onCancel={() => {
            setShowDeleteConfirm(false)
            setEmployeeToDelete(null)
          }}
        />
      </div>
    </Layout>
  )
}

