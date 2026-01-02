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
import { LoadingSpinner, ButtonSpinner } from '@/components/LoadingSpinner'
import { FormField, Input, Select } from '@/components/FormField'

const employeeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  pin: z.string().length(4, 'PIN must be 4 digits').optional(),
  job_role: z.string().optional(),
  pay_rate: z.string().optional().transform((val) => {
    if (!val || val === '') return undefined
    const num = parseFloat(val)
    return isNaN(num) ? undefined : num
  }).pipe(z.number().min(0).optional().or(z.undefined())),
})

const editEmployeeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  status: z.enum(['active', 'inactive']),
  pin: z.string().length(4, 'PIN must be 4 digits').optional().or(z.literal('')),
  job_role: z.string().optional(),
  pay_rate: z.string().optional(),
})

type EmployeeForm = z.infer<typeof employeeSchema>
type EditEmployeeForm = z.infer<typeof editEmployeeSchema>

interface Employee {
  id: string
  name: string
  email: string
  status: 'active' | 'inactive'
  has_pin: boolean
  job_role: string | null
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
        if (user.role !== 'ADMIN') {
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

  const deleteEmployee = async (employeeId: string, employeeName: string) => {
    if (!confirm(`Are you sure you want to delete ${employeeName}? This action cannot be undone and will delete all associated time entries, leave requests, and sessions.`)) {
      return
    }
    
    setDeletingEmployee(employeeId)
    try {
      await api.delete(`/users/admin/employees/${employeeId}`)
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
    setEditValue('name', employee.name)
    setEditValue('status', employee.status)
    setEditValue('pin', '') // Don't pre-fill PIN for security
    setEditValue('job_role', employee.job_role || '')
    setEditValue('pay_rate', employee.pay_rate?.toString() || '')
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
      
      // Only include PIN if it was provided
      if (data.pin && data.pin.length === 4) {
        updateData.pin = data.pin
      }
      
      // Include job_role and pay_rate
      if (data.job_role !== undefined) {
        updateData.job_role = data.job_role || null
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
          emp.email.toLowerCase().includes(query) ||
          (emp.job_role && emp.job_role.toLowerCase().includes(query))
        )
      }
      
      return true
    })
  }, [employees, statusFilter, debouncedSearchQuery])

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Employees</h1>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
          >
            {showForm ? 'Cancel' : 'Add Employee'}
          </button>
        </div>

        {/* Search and Filters */}
        <div className="mb-4 space-y-3">
          {/* Search Input */}
          <div>
            <input
              type="text"
              placeholder="Search by name, email, or job role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
            />
          </div>
          
          {/* Status Filter */}
          <div className="flex gap-2">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                statusFilter === 'all'
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                statusFilter === 'active'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setStatusFilter('inactive')}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                statusFilter === 'inactive'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Inactive
            </button>
          </div>
        </div>
        {showForm && (
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">New Employee</h2>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <FormField label="Name" error={errors.name?.message} required>
                <Input {...register('name')} error={!!errors.name} />
              </FormField>
              
              <FormField label="Email" error={errors.email?.message} required>
                <Input {...register('email')} type="email" error={!!errors.email} />
              </FormField>
              
              <FormField label="Password" error={errors.password?.message} required>
                <Input {...register('password')} type="password" error={!!errors.password} />
              </FormField>
              
              <FormField label="PIN" error={errors.pin?.message} hint="4-digit PIN for kiosk access (optional)">
                <Input {...register('pin')} type="text" maxLength={4} error={!!errors.pin} />
              </FormField>
              
              <FormField label="Job Role" error={errors.job_role?.message} hint="e.g., Manager, Developer, Sales">
                <Input {...register('job_role')} type="text" error={!!errors.job_role} />
              </FormField>
              
              <FormField label="Pay Rate" error={errors.pay_rate?.message} hint="Hourly rate in dollars (optional)">
                <Input {...register('pay_rate')} type="number" step="0.01" min="0" error={!!errors.pay_rate} />
              </FormField>
              
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {submitting && <ButtonSpinner />}
                {submitting ? 'Creating...' : 'Create Employee'}
              </button>
            </form>
          </div>
        )}
        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : (
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Clock Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Has PIN
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Job Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Pay Rate
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created At
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Punch
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-4 text-center text-gray-500">
                      No employees found
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

        {/* Edit Employee Modal */}
        {editingEmployee && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
            <div className="relative bg-white rounded-lg shadow-xl p-6 w-full max-w-md m-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Edit Employee</h2>
                <button
                  onClick={closeEditForm}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
              <form onSubmit={handleSubmitEdit(onEditSubmit)} className="space-y-4">
                <FormField label="Name" error={editErrors.name?.message} required>
                  <Input {...registerEdit('name')} error={!!editErrors.name} />
                </FormField>
                
                <FormField label="Email" hint="Email cannot be changed">
                  <Input
                    type="email"
                    value={editingEmployee.email}
                    disabled
                    className="bg-gray-100 text-gray-500 cursor-not-allowed"
                  />
                </FormField>
                
                <FormField label="Status" error={editErrors.status?.message} required>
                  <Select {...registerEdit('status')} error={!!editErrors.status}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Select>
                </FormField>
                
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
                
                <FormField label="Job Role" error={editErrors.job_role?.message} hint="e.g., Manager, Developer, Sales">
                  <Input {...registerEdit('job_role')} type="text" error={!!editErrors.job_role} />
                </FormField>
                
                <FormField label="Pay Rate" error={editErrors.pay_rate?.message} hint="Hourly rate in dollars">
                  <Input {...registerEdit('pay_rate')} type="number" step="0.01" min="0" error={!!editErrors.pay_rate} />
                </FormField>
                <div className="flex gap-3 pt-4">
                  <button
                    type="submit"
                    disabled={updating}
                    className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {updating && <ButtonSpinner />}
                    {updating ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    type="button"
                    onClick={closeEditForm}
                    disabled={updating}
                    className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

