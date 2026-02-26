'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import { useToast } from '@/components/Toast'
import { LoadingSpinner, ButtonSpinner } from '@/components/LoadingSpinner'
import logger from '@/lib/logger'

interface Permission {
  id: string
  name: string
  display_name: string
  description: string | null
  category: string
  created_at: string
}

interface PermissionCategory {
  category: string
  permissions: Permission[]
}

interface RolePermission {
  role: string
  permissions: Permission[]
  is_company_specific: boolean
}

const ROLES = [
  { value: 'FRONTDESK', label: 'Front Desk', color: 'bg-teal-600' },
  { value: 'MAINTENANCE', label: 'Maintenance', color: 'bg-orange-600' },
  { value: 'HOUSEKEEPING', label: 'Housekeeping', color: 'bg-green-600' },
  { value: 'ADMIN', label: 'Admin', color: 'bg-purple-600' },
]

const CATEGORY_LABELS: Record<string, string> = {
  TIME_ENTRIES: 'Time Entries',
  EMPLOYEES: 'Employees',
  SCHEDULES: 'Schedules',
  PAYROLL: 'Payroll',
  REPORTS: 'Reports',
  SETTINGS: 'Settings',
  LEAVE_REQUESTS: 'Leave Requests',
  CASH_DRAWER: 'Cash Drawer',
  ADMIN: 'Administration',
}

export default function RolesPermissionsPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [permissions, setPermissions] = useState<PermissionCategory[]>([])
  const [selectedRole, setSelectedRole] = useState<string>('FRONTDESK')
  const [rolePermissions, setRolePermissions] = useState<RolePermission | null>(null)
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set())

  useEffect(() => {
    const checkAdminAndFetch = async () => {
      try {
        const user = await getCurrentUser()
        if (user.role !== 'ADMIN') {
          router.push('/dashboard')
          return
        }
        await fetchPermissions()
        await fetchRolePermissions()
      } catch (err) {
        logger.error('Failed to check admin', err as Error)
        router.push('/login')
      }
    }
    checkAdminAndFetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  useEffect(() => {
    if (selectedRole) {
      fetchRolePermissions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRole])

  const fetchPermissions = async () => {
    try {
      const response = await api.get('/admin/permissions/by-category')
      setPermissions(response.data)
    } catch (error: any) {
      logger.error('Failed to fetch permissions', error)
      toast.error('Failed to load permissions')
    }
  }

  const fetchRolePermissions = async () => {
    setLoading(true)
    try {
      const response = await api.get(`/admin/roles/${selectedRole}/permissions`)
      setRolePermissions(response.data)
      setSelectedPermissions(new Set(response.data.permissions.map((p: Permission) => p.id)))
    } catch (error: any) {
      logger.error('Failed to fetch role permissions', error)
      toast.error('Failed to load role permissions')
    } finally {
      setLoading(false)
    }
  }

  const handlePermissionToggle = (permissionId: string) => {
    const newSelected = new Set(selectedPermissions)
    if (newSelected.has(permissionId)) {
      newSelected.delete(permissionId)
    } else {
      newSelected.add(permissionId)
    }
    setSelectedPermissions(newSelected)
  }

  const handleCategoryToggle = (category: string, checked: boolean) => {
    const newSelected = new Set(selectedPermissions)
    const categoryPerms = permissions.find(p => p.category === category)
    if (categoryPerms) {
      categoryPerms.permissions.forEach(perm => {
        if (checked) {
          newSelected.add(perm.id)
        } else {
          newSelected.delete(perm.id)
        }
      })
    }
    setSelectedPermissions(newSelected)
  }

  const isCategoryFullySelected = (category: string) => {
    const categoryPerms = permissions.find(p => p.category === category)
    if (!categoryPerms || categoryPerms.permissions.length === 0) return false
    return categoryPerms.permissions.every(perm => selectedPermissions.has(perm.id))
  }

  const isCategoryPartiallySelected = (category: string) => {
    const categoryPerms = permissions.find(p => p.category === category)
    if (!categoryPerms || categoryPerms.permissions.length === 0) return false
    const selectedCount = categoryPerms.permissions.filter(perm => selectedPermissions.has(perm.id)).length
    return selectedCount > 0 && selectedCount < categoryPerms.permissions.length
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.put(`/admin/roles/${selectedRole}/permissions`, {
        permission_ids: Array.from(selectedPermissions),
      })
      toast.success('Permissions saved successfully!')
    } catch (error: any) {
      logger.error('Failed to save role permissions', error)
      toast.error(error.response?.data?.detail || 'Failed to save permissions')
    } finally {
      setSaving(false)
    }
  }

  const selectedRoleInfo = ROLES.find(r => r.value === selectedRole)

  if (loading && !rolePermissions) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner />
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Roles & Permissions</h1>
          <p className="text-gray-600 mt-1">Manage what each role can access</p>
        </div>

        {/* Role Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {ROLES.map((role) => (
            <button
              key={role.value}
              onClick={() => setSelectedRole(role.value)}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                selectedRole === role.value
                  ? `${role.color} text-white shadow-md`
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {role.label}
            </button>
          ))}
        </div>

        {/* Permissions Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {/* Card Header */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {selectedRoleInfo?.label} Permissions
              </h2>
              <p className="text-sm text-gray-500">
                {selectedPermissions.size} permissions enabled
              </p>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-teal-600 text-white rounded-lg font-medium text-sm hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
            >
              {saving ? (
                <>
                  <ButtonSpinner />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>

          {/* Permissions List */}
          <div className="divide-y divide-gray-100">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <LoadingSpinner />
              </div>
            ) : (
              permissions.map((category) => {
                const isFullySelected = isCategoryFullySelected(category.category)
                const isPartiallySelected = isCategoryPartiallySelected(category.category)
                const categorySelectedCount = category.permissions.filter(p => selectedPermissions.has(p.id)).length

                return (
                  <div key={category.category} className="px-6 py-4">
                    {/* Category Header */}
                    <div className="flex items-center justify-between mb-3">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isFullySelected}
                          onChange={(e) => handleCategoryToggle(category.category, e.target.checked)}
                          className="w-5 h-5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                          ref={(input) => {
                            if (input) {
                              input.indeterminate = isPartiallySelected
                            }
                          }}
                        />
                        <span className="font-semibold text-gray-900">
                          {CATEGORY_LABELS[category.category] || category.category}
                        </span>
                      </label>
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                        {categorySelectedCount}/{category.permissions.length}
                      </span>
                    </div>

                    {/* Permissions Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pl-8">
                      {category.permissions.map((permission) => (
                        <label
                          key={permission.id}
                          className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedPermissions.has(permission.id)}
                            onChange={() => handlePermissionToggle(permission.id)}
                            className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                          />
                          <span className="text-sm text-gray-700">{permission.display_name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
