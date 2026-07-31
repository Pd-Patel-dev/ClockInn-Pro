'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import logger from '@/lib/logger'
import { DeveloperAuthLoading, useDeveloperAuth } from '@/components/developer/useDeveloperAuth'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'

interface SystemStats {
  total_users: number
  active_users: number
  admin_users: number
  employee_users: number
  developer_users: number
  verified_users: number
  total_companies: number
  active_sessions: number
  total_time_entries: number
  today_time_entries: number
  database_status: string
  database_error?: string
  configuration: Record<string, unknown>
}

interface SystemInfo {
  python_version: string
  platform: string
  system: string
  processor: string
  server_time: string
}

interface HealthStatus {
  status: string
  service: {
    version: string
    uptime: { formatted: string }
  }
  database: { status?: string; version?: { major: number; minor: number } }
}

function formatTimestamp(timestamp: string) {
  if (!timestamp) return 'N/A'
  try {
    return new Date(timestamp).toLocaleString()
  } catch {
    return timestamp
  }
}

export default function DeveloperSystemPage() {
  const { user, loading: authLoading } = useDeveloperAuth()
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = async () => {
    setRefreshing(true)
    try {
      const [statsRes, systemRes, healthRes] = await Promise.all([
        api.get('/developer/stats').catch(() => null),
        api.get('/developer/system-info').catch(() => null),
        api.get('/health').catch(() => null),
      ])
      if (statsRes) setStats(statsRes.data)
      if (systemRes) setSystemInfo(systemRes.data)
      if (healthRes) setHealth(healthRes.data)
    } catch (e) {
      logger.error('Failed to fetch system data', e as Error)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (authLoading || !user) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user])

  if (authLoading) return <DeveloperAuthLoading />

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">System Health</h1>
          <p className="text-sm text-foreground-muted">Service status, platform stats, and configuration</p>
        </div>
        <Button variant="secondary" loading={refreshing} onClick={load}>
          Refresh
        </Button>
      </div>

      {health && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Service</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-muted">Status</span>
                <Badge variant={health.status === 'healthy' ? 'success' : 'danger'} dot>
                  {health.status.toUpperCase()}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-muted">Uptime</span>
                <span className="font-medium">{health.service?.uptime?.formatted || 'N/A'}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-muted">Version</span>
                <span className="font-medium">{health.service?.version || 'N/A'}</span>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Database</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-muted">Connection</span>
                <Badge variant={health.database?.status === 'connected' ? 'success' : 'danger'} dot>
                  {(health.database?.status || 'unknown').toUpperCase()}
                </Badge>
              </div>
              {health.database?.version && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-foreground-muted">Version</span>
                  <span className="font-medium">
                    {health.database.version.major}.{health.database.version.minor}
                  </span>
                </div>
              )}
            </CardBody>
          </Card>
          {stats && (
            <Card>
              <CardHeader>
                <CardTitle>Quick stats</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-foreground-muted">Users</span>
                  <span className="font-medium">{stats.total_users}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground-muted">Companies</span>
                  <span className="font-medium">{stats.total_companies}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground-muted">Sessions</span>
                  <span className="font-medium">{stats.active_sessions}</span>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {stats && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Total users', value: stats.total_users, sub: `${stats.active_users} active` },
              { label: 'Companies', value: stats.total_companies, sub: '' },
              { label: 'Time entries', value: stats.total_time_entries, sub: `${stats.today_time_entries} today` },
              { label: 'Active sessions', value: stats.active_sessions, sub: '' },
            ].map((item) => (
              <Card key={item.label}>
                <CardBody>
                  <p className="text-sm text-foreground-muted">{item.label}</p>
                  <p className="mt-1 text-3xl font-bold text-foreground">{item.value}</p>
                  {item.sub && <p className="mt-1 text-xs text-foreground-subtle">{item.sub}</p>}
                </CardBody>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>User breakdown</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {[
                  ['Admins', stats.admin_users],
                  ['Employees', stats.employee_users],
                  ['Developers', stats.developer_users],
                  ['Verified', stats.verified_users],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <p className="text-sm text-foreground-muted">{label}</p>
                    <p className="text-2xl font-bold text-foreground">{value}</p>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </>
      )}

      {systemInfo && health && (
        <Card>
          <CardHeader>
            <CardTitle>System information</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid gap-4 md:grid-cols-2">
              {[
                ['Platform', systemInfo.platform],
                ['System', systemInfo.system],
                ['Processor', systemInfo.processor || 'N/A'],
                ['Python', systemInfo.python_version],
                ['Server time', formatTimestamp(systemInfo.server_time)],
                ['Uptime', health.service?.uptime?.formatted || 'N/A'],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-sm font-medium text-foreground-muted">{label}</dt>
                  <dd className="mt-1 text-sm text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      )}

      {stats && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Database information</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-muted">Connection status</span>
                <Badge variant={stats.database_status === 'connected' ? 'success' : 'danger'} dot>
                  {(stats.database_status || 'unknown').toUpperCase()}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-muted">Configured</span>
                <Badge variant={stats.configuration?.database_configured ? 'success' : 'danger'}>
                  {stats.configuration?.database_configured ? 'Yes' : 'No'}
                </Badge>
              </div>
              {stats.database_error && (
                <p className="text-xs text-red-600 dark:text-red-400">Error: {stats.database_error}</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Configuration status</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {Object.entries(stats.configuration || {}).map(([key, value]) => {
                if (
                  key === 'database_info' ||
                  key.startsWith('gmail_') ||
                  key === 'email_configured' ||
                  key === 'email_service'
                ) {
                  return null
                }
                return (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-foreground-muted">{key.replace(/_/g, ' ')}</span>
                    <Badge variant={value ? 'success' : 'danger'}>
                      {typeof value === 'boolean' ? (value ? 'Configured' : 'Not configured') : String(value)}
                    </Badge>
                  </div>
                )
              })}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
