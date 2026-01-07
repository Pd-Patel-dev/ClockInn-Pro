'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser, User } from '@/lib/auth'
import logger from '@/lib/logger'

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
  email_service: {
    initialized: boolean
    has_credentials: boolean
    sender_email: string
    token_valid?: boolean
    token_expired?: boolean
    has_refresh_token?: boolean
    token_expires_at?: string
    token_expires_in_seconds?: number
    token_expires_in_hours?: number
  }
  configuration: {
    database_configured: boolean
    database_info?: any
    secret_key_configured: boolean
    gmail_credentials_configured: boolean
    gmail_token_configured: boolean
    gmail_credentials_source?: string
    gmail_token_source?: string
    cors_origins_configured: boolean
    cors_origins?: string[]
    frontend_url?: string
    refresh_token_expire_days: number
    access_token_expire_minutes?: number
    rate_limit_enabled?: boolean
    rate_limit_per_minute?: number
  }
}

interface SystemInfo {
  python_version: string
  platform: string
  system: string
  processor: string
  server_time: string
  timezone: string
  environment: any
  email_service: any
  security: any
}

interface HealthStatus {
  status: string
  timestamp: string
  service: {
    name: string
    version: string
    uptime: {
      seconds: number
      hours: number
      days: number
      formatted: string
    }
  }
  system: any
  database: any
  configuration: any
}

interface RecentActivity {
  activity: Array<{
    type: string
    timestamp: string
    details: any
  }>
  count: number
}

export default function DeveloperPortalPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null)
  const [recentActivity, setRecentActivity] = useState<RecentActivity | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'stats' | 'system' | 'activity' | 'email'>('overview')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const checkDeveloperAndFetch = async () => {
      try {
        const currentUser = await getCurrentUser()
        setUser(currentUser)
        
        if (currentUser.role !== 'DEVELOPER') {
          router.push('/dashboard')
          return
        }
        
        await fetchAllData()
      } catch (err: any) {
        logger.error('Authentication error', err as Error, { action: 'developer_portal' })
        router.push('/login')
      } finally {
        setLoading(false)
      }
    }
    checkDeveloperAndFetch()
  }, [router])

  const [gmailHealth, setGmailHealth] = useState<any>(null)

  const fetchAllData = async () => {
    setRefreshing(true)
    try {
      const [statsRes, systemRes, healthRes, activityRes, gmailHealthRes] = await Promise.all([
        api.get('/developer/stats').catch(() => null),
        api.get('/developer/system-info').catch(() => null),
        api.get('/health').catch(() => null),
        api.get('/developer/recent-activity').catch(() => null),
        api.get('/admin/gmail/health').catch(() => null),
      ])
      
      if (statsRes) setStats(statsRes.data)
      if (systemRes) setSystemInfo(systemRes.data)
      if (healthRes) setHealthStatus(healthRes.data)
      if (activityRes) setRecentActivity(activityRes.data)
      if (gmailHealthRes) setGmailHealth(gmailHealthRes.data)
    } catch (error: any) {
      logger.error('Failed to fetch developer portal data', error as Error)
    } finally {
      setRefreshing(false)
    }
  }

  const formatTimestamp = (timestamp: string) => {
    if (!timestamp) return 'N/A'
    try {
      return new Date(timestamp).toLocaleString()
    } catch {
      return timestamp
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

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Developer Portal</h1>
            <p className="text-sm text-gray-600 mt-1">System monitoring and administration</p>
          </div>
          <button
            onClick={fetchAllData}
            disabled={refreshing}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {['overview', 'stats', 'system', 'activity', 'email'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`py-4 px-1 border-b-2 font-medium text-sm capitalize ${
                  activeTab === tab
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab === 'overview' ? 'Overview' : tab}
              </button>
            ))}
          </nav>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && healthStatus && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Service Status */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Service Status</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Status</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    healthStatus.status === 'healthy' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {healthStatus.status.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Uptime</span>
                  <span className="text-sm font-medium">{healthStatus.service?.uptime?.formatted || 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Version</span>
                  <span className="text-sm font-medium">{healthStatus.service?.version || 'N/A'}</span>
                </div>
              </div>
            </div>

            {/* Database Status */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Database</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Status</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    healthStatus.database?.status === 'connected' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {healthStatus.database?.status?.toUpperCase() || 'UNKNOWN'}
                  </span>
                </div>
                {healthStatus.database?.version && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Version</span>
                    <span className="text-sm font-medium">
                      {healthStatus.database.version.major}.{healthStatus.database.version.minor}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Stats */}
            {stats && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Quick Stats</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Total Users</span>
                    <span className="text-sm font-medium">{stats.total_users}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Companies</span>
                    <span className="text-sm font-medium">{stats.total_companies}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Active Sessions</span>
                    <span className="text-sm font-medium">{stats.active_sessions}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stats Tab */}
        {activeTab === 'stats' && stats && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">Total Users</h3>
                <p className="text-3xl font-bold text-gray-900">{stats.total_users}</p>
                <p className="text-sm text-gray-500 mt-2">{stats.active_users} active</p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">Companies</h3>
                <p className="text-3xl font-bold text-gray-900">{stats.total_companies}</p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">Time Entries</h3>
                <p className="text-3xl font-bold text-gray-900">{stats.total_time_entries}</p>
                <p className="text-sm text-gray-500 mt-2">{stats.today_time_entries} today</p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">Active Sessions</h3>
                <p className="text-3xl font-bold text-gray-900">{stats.active_sessions}</p>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">User Breakdown</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Admins</p>
                  <p className="text-2xl font-bold">{stats.admin_users}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Employees</p>
                  <p className="text-2xl font-bold">{stats.employee_users}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Developers</p>
                  <p className="text-2xl font-bold">{stats.developer_users}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Verified</p>
                  <p className="text-2xl font-bold">{stats.verified_users}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* System Tab */}
        {activeTab === 'system' && systemInfo && healthStatus && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">System Information</h3>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm font-medium text-gray-600">Platform</dt>
                  <dd className="mt-1 text-sm text-gray-900">{systemInfo.platform}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-600">System</dt>
                  <dd className="mt-1 text-sm text-gray-900">{systemInfo.system}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-600">Processor</dt>
                  <dd className="mt-1 text-sm text-gray-900">{systemInfo.processor || 'N/A'}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-600">Python Version</dt>
                  <dd className="mt-1 text-sm text-gray-900">{systemInfo.python_version}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-600">Server Time</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatTimestamp(systemInfo.server_time)}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-600">Uptime</dt>
                  <dd className="mt-1 text-sm text-gray-900">{healthStatus.service?.uptime?.formatted || 'N/A'}</dd>
                </div>
              </dl>
            </div>

            {/* Database Information */}
            {stats && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Database Information</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Connection Status</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      stats.database_status === 'connected' 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {stats.database_status?.toUpperCase() || 'UNKNOWN'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Configured</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      stats.configuration?.database_configured 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {stats.configuration?.database_configured ? 'Yes' : 'No'}
                    </span>
                  </div>
                  {stats.configuration?.database_info && (
                    <>
                      {stats.configuration.database_info.provider && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Provider</span>
                          <span className="text-sm font-medium capitalize">
                            {stats.configuration.database_info.provider}
                          </span>
                        </div>
                      )}
                      {stats.configuration.database_info.host && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Host</span>
                          <span className="text-sm font-medium">
                            {stats.configuration.database_info.host}
                          </span>
                        </div>
                      )}
                      {stats.configuration.database_info.port && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Port</span>
                          <span className="text-sm font-medium">
                            {stats.configuration.database_info.port}
                          </span>
                        </div>
                      )}
                      {stats.configuration.database_info.database && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Database Name</span>
                          <span className="text-sm font-medium">
                            {stats.configuration.database_info.database}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  {stats.database_error && (
                    <div className="mt-3 pt-3 border-t">
                      <span className="text-xs text-red-600">Error: {stats.database_error}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Configuration Status</h3>
              <div className="space-y-3">
                {Object.entries(stats?.configuration || {}).map(([key, value]) => {
                  // Skip database_info as it's displayed in the Database Information section above
                  if (key === 'database_info') return null
                  
                  return (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-sm text-gray-600 capitalize">
                        {key.replace(/_/g, ' ')}
                      </span>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        value ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {typeof value === 'boolean' ? (value ? 'Configured' : 'Not Configured') : String(value)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Activity Tab */}
        {activeTab === 'activity' && recentActivity && (
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Recent Activity</h3>
            <div className="space-y-3">
              {recentActivity.activity.length > 0 ? (
                recentActivity.activity.map((activity, index) => (
                  <div key={index} className="border-l-4 border-blue-500 pl-4 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium capitalize">{activity.type.replace(/_/g, ' ')}</span>
                      <span className="text-sm text-gray-500">{formatTimestamp(activity.timestamp)}</span>
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      {activity.details.email && <span>Email: {activity.details.email}</span>}
                      {activity.details.role && <span className="ml-4">Role: {activity.details.role}</span>}
                      {activity.details.status && <span className="ml-4">Status: {activity.details.status}</span>}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-center py-8">No recent activity</p>
              )}
            </div>
          </div>
        )}

        {/* Email Tab */}
        {activeTab === 'email' && stats && (
          <div className="space-y-6">
            {/* Gmail Health Status */}
            {gmailHealth && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Gmail API Health</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Status</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      gmailHealth.status === 'healthy' 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {gmailHealth.status?.toUpperCase() || 'UNKNOWN'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Initialized</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      gmailHealth.initialized 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {gmailHealth.initialized ? 'Yes' : 'No'}
                    </span>
                  </div>
                  {gmailHealth.needs_reauthorization !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Needs Re-authorization</span>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        gmailHealth.needs_reauthorization 
                          ? 'bg-yellow-100 text-yellow-800' 
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {gmailHealth.needs_reauthorization ? 'Yes' : 'No'}
                      </span>
                    </div>
                  )}
                  {gmailHealth.message && (
                    <div className="mt-3 pt-3 border-t">
                      <span className="text-xs text-gray-600">{gmailHealth.message}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Email Service Status */}
            {stats.email_service && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Email Service Status</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Initialized</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      stats.email_service.initialized 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {stats.email_service.initialized ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Has Credentials</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      stats.email_service.has_credentials 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {stats.email_service.has_credentials ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Sender Email</span>
                    <span className="text-sm font-medium">{stats.email_service.sender_email || 'N/A'}</span>
                  </div>
                  {stats.email_service.token_valid !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Token Valid</span>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        stats.email_service.token_valid 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {stats.email_service.token_valid ? 'Yes' : 'No'}
                      </span>
                    </div>
                  )}
                  {stats.email_service.token_expired !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Token Expired</span>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        stats.email_service.token_expired 
                          ? 'bg-red-100 text-red-800' 
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {stats.email_service.token_expired ? 'Yes' : 'No'}
                      </span>
                    </div>
                  )}
                  {stats.email_service.has_refresh_token !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Has Refresh Token</span>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        stats.email_service.has_refresh_token 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {stats.email_service.has_refresh_token ? 'Yes' : 'No'}
                      </span>
                    </div>
                  )}
                  {stats.email_service.token_expires_at && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Token Expires At</span>
                      <span className="text-xs font-medium">{formatTimestamp(stats.email_service.token_expires_at)}</span>
                    </div>
                  )}
                  {stats.email_service.token_expires_in_hours !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Token Expires In</span>
                      <span className={`text-xs font-medium ${
                        stats.email_service.token_expires_in_hours < 1 
                          ? 'text-red-600' 
                          : stats.email_service.token_expires_in_hours < 24 
                          ? 'text-yellow-600' 
                          : 'text-gray-600'
                      }`}>
                        {stats.email_service.token_expires_in_hours.toFixed(1)} hours
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Gmail Configuration */}
            {stats.configuration && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Gmail Configuration</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Credentials Configured</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      stats.configuration.gmail_credentials_configured 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {stats.configuration.gmail_credentials_configured ? 'Yes' : 'No'}
                    </span>
                  </div>
                  {stats.configuration.gmail_credentials_source && (
                    <div className="flex items-center justify-between ml-4">
                      <span className="text-xs text-gray-500">Source</span>
                      <span className="text-xs font-medium capitalize">{stats.configuration.gmail_credentials_source}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Token Configured</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      stats.configuration.gmail_token_configured 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {stats.configuration.gmail_token_configured ? 'Yes' : 'No'}
                    </span>
                  </div>
                  {stats.configuration.gmail_token_source && (
                    <div className="flex items-center justify-between ml-4">
                      <span className="text-xs text-gray-500">Source</span>
                      <span className="text-xs font-medium capitalize">{stats.configuration.gmail_token_source}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {(!stats.email_service && !stats.configuration) && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-sm text-yellow-800">Email service data is not available. Please try refreshing the page.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}

