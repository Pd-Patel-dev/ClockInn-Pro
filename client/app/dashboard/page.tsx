'use client'

import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import { getCurrentUser, User } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { format } from 'date-fns'
import logger from '@/lib/logger'

interface Employee {
  id: string
  name: string
  email: string
  status: string
  last_punch_at: string | null
  is_clocked_in: boolean | null
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [totalEmployees, setTotalEmployees] = useState(0)
  const [activeToday, setActiveToday] = useState(0)
  const [pendingLeave, setPendingLeave] = useState(0)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loadingStats, setLoadingStats] = useState(true)

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const currentUser = await getCurrentUser()
        setUser(currentUser)
        if (currentUser.role === 'ADMIN') {
          fetchStats()
        }
      } catch (error) {
        router.push('/login')
      } finally {
        setLoading(false)
      }
    }
    fetchUser()
  }, [router])

  const fetchStats = async () => {
    setLoadingStats(true)
    try {
      // Fetch employees
      const employeesResponse = await api.get('/users/admin/employees?limit=1000')
      const employeesList = employeesResponse.data || []
      setTotalEmployees(employeesList.length)
      
      // Count active today (clocked in)
      const activeCount = employeesList.filter((emp: Employee) => emp.is_clocked_in === true).length
      setActiveToday(activeCount)
      
      // Set employees list (limit to 10 for display)
      setEmployees(employeesList.slice(0, 10))
      
      // Fetch pending leave requests
      try {
        const leaveResponse = await api.get('/leave/admin/leave?status=pending&limit=1')
        setPendingLeave(leaveResponse.data?.total || 0)
      } catch (error) {
        // If leave endpoint fails, just set to 0
        setPendingLeave(0)
      }
    } catch (error: any) {
      logger.error('Failed to fetch dashboard stats', error as Error, { endpoint: 'dashboard' })
    } finally {
      setLoadingStats(false)
    }
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

  if (!user) {
    return null
  }

  const isEmployee = ['MAINTENANCE', 'FRONTDESK', 'HOUSEKEEPING'].includes(user.role)
  const isAdmin = user.role === 'ADMIN'

  const employeeQuickActions = [
    {
      title: 'Punch In/Out',
      description: 'Clock in or out for your shift',
      href: '/punch',
      color: 'from-blue-500 to-blue-600',
    },
    {
      title: 'Time Logs',
      description: 'View your time entries',
      href: '/logs',
      color: 'from-green-500 to-green-600',
    },
    {
      title: 'Leave Requests',
      description: 'Request time off',
      href: '/leave',
      color: 'from-purple-500 to-purple-600',
    },
  ]

  const adminQuickActions = [
    {
      title: 'Employees',
      description: 'Manage your team',
      href: '/employees',
      color: 'from-indigo-500 to-indigo-600',
    },
    {
      title: 'Schedules',
      description: 'Manage shift schedules',
      href: '/schedules',
      color: 'from-pink-500 to-pink-600',
    },
    {
      title: 'Time Entries',
      description: 'View all time entries',
      href: '/time-entries',
      color: 'from-blue-500 to-blue-600',
    },
    {
      title: 'Payroll',
      description: 'Generate payroll',
      href: '/payroll',
      color: 'from-green-500 to-green-600',
    },
    {
      title: 'Leave Requests',
      description: 'Review leave requests',
      href: '/leave-requests',
      color: 'from-yellow-500 to-yellow-600',
    },
    {
      title: 'Reports',
      description: 'Generate reports',
      href: '/reports',
      color: 'from-purple-500 to-purple-600',
    },
    {
      title: 'Settings',
      description: 'Company settings',
      href: '/settings',
      color: 'from-gray-500 to-gray-600',
    },
  ]

  const quickActions = isEmployee ? employeeQuickActions : adminQuickActions

  const formatLastPunch = (lastPunchAt: string | null) => {
    if (!lastPunchAt) return 'Never'
    const date = new Date(lastPunchAt)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)
    
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} min ago`
    if (diffHours < 24) return `${diffHours} hr ago`
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return format(date, 'MMM dd, yyyy HH:mm')
  }

  return (
    <Layout>
      <div className="px-4 py-8 sm:px-6 lg:px-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Welcome back, {user.name}
            </h1>
            <p className="text-gray-600">
              {isAdmin ? 'Manage your team and track attendance' : 'Track your time and manage your schedule'}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <div className="text-sm text-gray-500">
                <span>Role: <span className="font-medium text-gray-700">{user.role}</span></span>
                <span className="mx-2">•</span>
                <span>Company: <span className="font-medium text-gray-700">{user.company_name}</span></span>
              </div>
              <div className="flex items-center gap-2">
                {user.email_verified && !user.verification_required ? (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                    <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Email Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">
                    <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    Email Not Verified
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {quickActions.map((action, index) => (
              <Link
                key={index}
                href={action.href}
                className="bg-white rounded-lg border border-gray-200 p-5 hover:border-blue-500 hover:bg-blue-50 transition-colors"
              >
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {action.title}
                </h3>
                <p className="text-sm text-gray-600">{action.description}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* Stats Cards */}
        {isAdmin && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <p className="text-sm text-gray-600 mb-1">Total Employees</p>
                {loadingStats ? (
                  <div className="animate-pulse h-8 w-16 bg-gray-200 rounded"></div>
                ) : (
                  <p className="text-2xl font-semibold text-gray-900">{totalEmployees}</p>
                )}
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <p className="text-sm text-gray-600 mb-1">Active Today</p>
                {loadingStats ? (
                  <div className="animate-pulse h-8 w-16 bg-gray-200 rounded"></div>
                ) : (
                  <p className="text-2xl font-semibold text-gray-900">{activeToday}</p>
                )}
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <p className="text-sm text-gray-600 mb-1">Pending Leave</p>
                {loadingStats ? (
                  <div className="animate-pulse h-8 w-16 bg-gray-200 rounded"></div>
                ) : (
                  <p className="text-2xl font-semibold text-gray-900">{pendingLeave}</p>
                )}
              </div>
            </div>

            {/* Employees List */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="p-5 border-b border-gray-200">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-semibold text-gray-900">Recent Employees</h2>
                  <Link
                    href="/employees"
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    View All
                  </Link>
                </div>
              </div>
              {loadingStats ? (
                <div className="p-12 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="mt-4 text-sm text-gray-600">Loading employees...</p>
                </div>
              ) : employees.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-gray-500">No employees found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Employee
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Punch Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Last Punch
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {employees.map((employee) => (
                        <tr
                          key={employee.id}
                          onClick={() => router.push(`/employees/${employee.id}`)}
                          className="hover:bg-gray-50 transition-colors cursor-pointer"
                        >
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="flex-shrink-0 h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold">
                                {employee.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="ml-4">
                                <div className="text-sm font-medium text-gray-900">{employee.name}</div>
                                <div className="text-sm text-gray-500">{employee.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                              employee.status === 'active'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}>
                              {employee.status ? employee.status.charAt(0).toUpperCase() + employee.status.slice(1).toLowerCase() : employee.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {employee.is_clocked_in ? (
                              <span className="px-2 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">
                                Clocked In
                              </span>
                            ) : (
                              <span className="px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-800">
                                Clocked Out
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                            {formatLastPunch(employee.last_punch_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
