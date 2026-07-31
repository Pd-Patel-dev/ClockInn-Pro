'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import logger from '@/lib/logger'
import { DeveloperAuthLoading, useDeveloperAuth } from '@/components/developer/useDeveloperAuth'
import { PortalUserTable } from '@/components/developer/PortalUserTable'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Input'

export default function DeveloperTenantUsersPage() {
  const { user, loading: authLoading } = useDeveloperAuth()
  const [rows, setRows] = useState<Parameters<typeof PortalUserTable>[0]['rows']>([])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const params: Record<string, string | boolean> = { exclude_developers: true }
        if (search.trim()) params.q = search.trim()
        if (roleFilter) params.role = roleFilter
        const res = await api.get('/developer/users', { params })
        if (!cancelled) setRows(Array.isArray(res.data) ? res.data : [])
      } catch (e) {
        if (!cancelled) {
          setRows([])
          logger.error('Failed to load users', e as Error)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    const t = setTimeout(load, search ? 250 : 0)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [authLoading, user, search, roleFilter])

  if (authLoading) return <DeveloperAuthLoading />

  return (
    <div className="mx-auto max-w-6xl">
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Company accounts only (admins, managers, and staff). Developers are listed under Developers.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row">
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email…"
              className="flex-1"
            />
            <Select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="sm:w-48"
            >
              <option value="">All roles</option>
              <option value="ADMIN">ADMIN</option>
              <option value="MANAGER">MANAGER</option>
              <option value="FRONTDESK">FRONTDESK</option>
              <option value="HOUSEKEEPING">HOUSEKEEPING</option>
              <option value="MAINTENANCE">MAINTENANCE</option>
              <option value="RESTAURANT">RESTAURANT</option>
              <option value="SECURITY">SECURITY</option>
            </Select>
          </div>
          {loading ? (
            <p className="text-sm text-foreground-muted">Loading users…</p>
          ) : (
            <PortalUserTable
              rows={rows}
              showCompany
              emptyLabel="No users found."
              countLabel="user(s)"
            />
          )}
        </CardBody>
      </Card>
    </div>
  )
}
