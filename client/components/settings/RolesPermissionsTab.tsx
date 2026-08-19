'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import { LoadingSpinner, ButtonSpinner } from '@/components/LoadingSpinner'
import logger from '@/lib/logger'
import { InfoTip } from '@/components/ui/InfoTip'

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
  { value: 'FRONTDESK', label: 'Front Desk' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'HOUSEKEEPING', label: 'Housekeeping' },
  { value: 'ADMIN', label: 'Admin' },
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

export default function RolesPermissionsTab() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [permissions, setPermissions] = useState<PermissionCategory[]>([])
  const [selectedRole, setSelectedRole] = useState<string>('FRONTDESK')
  const [rolePermissions, setRolePermissions] = useState<RolePermission | null>(null)
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set())

  useEffect(() => {
    const load = async () => {
      try {
        const response = await api.get('/admin/permissions/by-category')
        setPermissions(response.data)
      } catch (error: any) {
        logger.error('Failed to fetch permissions', error)
        toast.error('Failed to load permissions')
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
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
    fetchRolePermissions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRole])

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
    const categoryPerms = permissions.find((p) => p.category === category)
    if (categoryPerms) {
      categoryPerms.permissions.forEach((perm) => {
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
    const categoryPerms = permissions.find((p) => p.category === category)
    if (!categoryPerms || categoryPerms.permissions.length === 0) return false
    return categoryPerms.permissions.every((perm) => selectedPermissions.has(perm.id))
  }

  const isCategoryPartiallySelected = (category: string) => {
    const categoryPerms = permissions.find((p) => p.category === category)
    if (!categoryPerms || categoryPerms.permissions.length === 0) return false
    const selectedCount = categoryPerms.permissions.filter((perm) =>
      selectedPermissions.has(perm.id)
    ).length
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

  const selectedRoleInfo = ROLES.find((r) => r.value === selectedRole)

  if (loading && !rolePermissions) {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="-mx-1 overflow-x-auto pb-1">
        <div className="flex min-w-max flex-wrap items-center gap-2 px-1">
          {ROLES.map((role) => (
            <button
              key={role.value}
              type="button"
              onClick={() => setSelectedRole(role.value)}
              className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                selectedRole === role.value
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              {role.label}
            </button>
          ))}
          <InfoTip
            label="Roles"
            content="Select a role, then enable the permissions that role should have. Changes apply after you save."
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              {selectedRoleInfo?.label} Permissions
              <InfoTip
                label="Role permissions"
                content="Toggle what this role can access in ClockInn. Admins typically keep full access; front desk and other roles get only what they need."
              />
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {selectedPermissions.size} permissions enabled
            </p>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
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

        <div className="divide-y divide-slate-100">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : (
            permissions.map((category) => {
              const isFullySelected = isCategoryFullySelected(category.category)
              const isPartiallySelected = isCategoryPartiallySelected(category.category)
              const categorySelectedCount = category.permissions.filter((p) =>
                selectedPermissions.has(p.id)
              ).length

              return (
                <div key={category.category} className="px-5 py-4 sm:px-6">
                  <div className="mb-3 flex items-center justify-between">
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isFullySelected}
                        onChange={(e) => handleCategoryToggle(category.category, e.target.checked)}
                        className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                        ref={(input) => {
                          if (input) {
                            input.indeterminate = isPartiallySelected
                          }
                        }}
                      />
                      <span className="font-semibold text-slate-900">
                        {CATEGORY_LABELS[category.category] || category.category}
                      </span>
                    </label>
                    <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-500">
                      {categorySelectedCount}/{category.permissions.length}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2 pl-8 sm:grid-cols-2 lg:grid-cols-3">
                    {category.permissions.map((permission) => (
                      <label
                        key={permission.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg p-2 hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPermissions.has(permission.id)}
                          onChange={() => handlePermissionToggle(permission.id)}
                          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                        />
                        <span className="text-sm text-slate-700">{permission.display_name}</span>
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
  )
}
