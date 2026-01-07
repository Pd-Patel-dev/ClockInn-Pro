'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import logger from '@/lib/logger'
import { useToast } from '@/components/Toast'
import { ButtonSpinner } from '@/components/LoadingSpinner'

const companyNameSchema = z.object({
  name: z.string().min(1, 'Company name is required').max(255, 'Company name is too long'),
})

const companySettingsSchema = z.object({
  timezone: z.string().min(1, 'Timezone is required'),
  payroll_week_start_day: z.number().int().min(0).max(6),
  biweekly_anchor_date: z.string().optional().nullable(),
  overtime_enabled: z.boolean(),
  overtime_threshold_hours_per_week: z.number().int().min(1).max(168),
  overtime_multiplier_default: z.string().transform((val) => {
    if (!val || val === '') return '1.5'
    const num = parseFloat(val)
    return isNaN(num) ? '1.5' : num.toString()
  }).pipe(z.string()),
  rounding_policy: z.enum(['none', '5', '10', '15']),
  breaks_paid: z.boolean(),
})

type CompanyNameForm = z.infer<typeof companyNameSchema>
type CompanySettingsForm = z.infer<typeof companySettingsSchema>

interface CompanySettings {
  timezone: string
  payroll_week_start_day: number
  biweekly_anchor_date: string | null
  overtime_enabled: boolean
  overtime_threshold_hours_per_week: number
  overtime_multiplier_default: number
  rounding_policy: string
  breaks_paid: boolean
}

interface AdminInfo {
  id: string
  name: string
  email: string
  created_at: string
  last_login_at: string | null
}

interface CompanyInfo {
  id: string
  name: string
  slug: string
  kiosk_enabled: boolean
  created_at: string
  settings: CompanySettings
  admin: AdminInfo | null
}

export default function AdminSettingsPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null)
  const [activeTab, setActiveTab] = useState<'info' | 'payroll' | 'email'>('info')
  const [gmailHealth, setGmailHealth] = useState<any>(null)
  const [checkingGmail, setCheckingGmail] = useState(false)
  const [kioskUrl, setKioskUrl] = useState<string>('')

  const {
    register: registerName,
    handleSubmit: handleSubmitName,
    formState: { errors: nameErrors },
    reset: resetName,
    setValue: setValueName,
  } = useForm<CompanyNameForm>({
    resolver: zodResolver(companyNameSchema),
  })

  const {
    control: controlSettings,
    handleSubmit: handleSubmitSettings,
    formState: { errors: settingsErrors },
    reset: resetSettings,
  } = useForm<CompanySettingsForm>({
    resolver: zodResolver(companySettingsSchema),
  })

  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    const checkAdminAndFetch = async () => {
      try {
        const currentUser = await getCurrentUser()
        setUser(currentUser)
        if (currentUser.role !== 'ADMIN' && currentUser.role !== 'DEVELOPER') {
          router.push('/dashboard')
          return
        }
        fetchCompanyInfo()
        // Set default tab for developers (email service only)
        if (currentUser.role === 'DEVELOPER') {
          setActiveTab('email')
          checkGmailHealth()
        }
      } catch (err: any) {
        logger.error('Authentication error', err as Error, { action: 'fetchCompanyInfo' })
        router.push('/login')
      }
    }
    checkAdminAndFetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // Set kiosk URL on client side to avoid hydration mismatch
  useEffect(() => {
    if (companyInfo?.slug && typeof window !== 'undefined') {
      setKioskUrl(`${window.location.origin}/kiosk/${companyInfo.slug}`)
    }
  }, [companyInfo?.slug])

  const checkGmailHealth = async () => {
    setCheckingGmail(true)
    try {
      const response = await api.get('/admin/gmail/health')
      setGmailHealth(response.data)
    } catch (error: any) {
      logger.error('Failed to check Gmail health', error as Error)
      toast.error('Failed to check Gmail service status')
      setGmailHealth({ status: 'error', message: 'Failed to check status' })
    } finally {
      setCheckingGmail(false)
    }
  }

  const handleUpdateGmailToken = async (tokenJson: string) => {
    try {
      await api.post('/admin/gmail/update-token', { token_json: tokenJson })
      toast.success('Gmail token updated successfully!')
      checkGmailHealth()
    } catch (error: any) {
      logger.error('Failed to update Gmail token', error as Error)
      toast.error(error.response?.data?.detail || 'Failed to update Gmail token')
    }
  }

  const handleTestGmail = async () => {
    const testEmail = prompt('Enter email address to send test email to:')
    if (!testEmail) return
    
    try {
      await api.post(`/admin/gmail/test-send?test_email=${encodeURIComponent(testEmail)}`)
      toast.success(`Test email sent to ${testEmail}`)
    } catch (error: any) {
      logger.error('Failed to send test email', error as Error)
      toast.error(error.response?.data?.detail || 'Failed to send test email')
    }
  }

  const fetchCompanyInfo = async () => {
    setLoading(true)
    try {
      // Only fetch company info for admins (developers don't need it)
      if (user?.role === 'ADMIN') {
        const response = await api.get('/admin/company')
        setCompanyInfo(response.data)
        
        // Reset form with fetched values
        resetSettings({
          timezone: response.data.settings.timezone,
          payroll_week_start_day: response.data.settings.payroll_week_start_day,
          biweekly_anchor_date: response.data.settings.biweekly_anchor_date ? (typeof response.data.settings.biweekly_anchor_date === 'string' ? response.data.settings.biweekly_anchor_date.split('T')[0] : response.data.settings.biweekly_anchor_date) : '',
          overtime_enabled: response.data.settings.overtime_enabled,
          overtime_threshold_hours_per_week: response.data.settings.overtime_threshold_hours_per_week,
          overtime_multiplier_default: response.data.settings.overtime_multiplier_default.toString(),
          rounding_policy: response.data.settings.rounding_policy as 'none' | '5' | '10' | '15',
          breaks_paid: response.data.settings.breaks_paid ?? false,
        })
        
        setValueName('name', response.data.name)
      }
    } catch (error: any) {
      logger.error('Failed to fetch company info', error as Error, { endpoint: '/admin/company' })
      if (error.response?.status === 403) {
        router.push('/dashboard')
      } else {
        toast.error(error.response?.data?.detail || 'Failed to fetch company information')
      }
    } finally {
      setLoading(false)
    }
  }

  const onSubmitName = async (data: CompanyNameForm) => {
    setSaving(true)
    try {
      const response = await api.put('/admin/company/name', data)
      setCompanyInfo(response.data)
      toast.success('Company name updated successfully!')
    } catch (error: any) {
      logger.error('Failed to update company name', error as Error, { endpoint: '/admin/company/name' })
      toast.error(error.response?.data?.detail || 'Failed to update company name')
    } finally {
      setSaving(false)
    }
  }

  const onSubmitSettings = async (data: CompanySettingsForm) => {
    setSaving(true)
    try {
      const updateData: any = {
        timezone: data.timezone,
        payroll_week_start_day: data.payroll_week_start_day,
        biweekly_anchor_date: data.biweekly_anchor_date || null,
        overtime_enabled: data.overtime_enabled,
        overtime_threshold_hours_per_week: data.overtime_threshold_hours_per_week,
        overtime_multiplier_default: parseFloat(data.overtime_multiplier_default),
        rounding_policy: data.rounding_policy,
        breaks_paid: data.breaks_paid,
      }
      
      logger.debug('Updating settings', { updateData })
      
      const response = await api.put('/admin/company/settings', updateData)
      logger.debug('Settings updated successfully', { response: response.data })
      
      // Update company info state FIRST
      setCompanyInfo(response.data)
      
      // Force a small delay then reset form to ensure state is updated
      setTimeout(() => {
        resetSettings({
          timezone: response.data.settings.timezone,
          payroll_week_start_day: response.data.settings.payroll_week_start_day,
          biweekly_anchor_date: response.data.settings.biweekly_anchor_date ? (typeof response.data.settings.biweekly_anchor_date === 'string' ? response.data.settings.biweekly_anchor_date.split('T')[0] : response.data.settings.biweekly_anchor_date) : '',
          overtime_enabled: response.data.settings.overtime_enabled,
          overtime_threshold_hours_per_week: response.data.settings.overtime_threshold_hours_per_week,
          overtime_multiplier_default: response.data.settings.overtime_multiplier_default.toString(),
          rounding_policy: response.data.settings.rounding_policy as 'none' | '5' | '10' | '15',
          breaks_paid: response.data.settings.breaks_paid ?? false,
        }, { keepDefaultValues: false })
      }, 50)
      
      // Also re-fetch to ensure we have the absolute latest data
      setTimeout(() => {
        fetchCompanyInfo()
      }, 200)
      
      toast.success('Company settings updated successfully!')
    } catch (error: any) {
      logger.error('Failed to update company settings', error as Error, { 
        endpoint: '/admin/company/settings',
        errorDetails: error.response?.data 
      })
      toast.error(error.response?.data?.detail || 'Failed to update company settings')
    } finally {
      setSaving(false)
    }
  }

  const weekDays = [
    { value: 0, label: 'Monday' },
    { value: 1, label: 'Tuesday' },
    { value: 2, label: 'Wednesday' },
    { value: 3, label: 'Thursday' },
    { value: 4, label: 'Friday' },
    { value: 5, label: 'Saturday' },
    { value: 6, label: 'Sunday' },
  ]

  const timezones = [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Phoenix',
    'America/Anchorage',
    'Pacific/Honolulu',
    'UTC',
  ]

  if (loading) {
    return (
      <Layout>
        <div className="px-4 py-6 sm:px-0">
          <div className="text-center py-8">Loading...</div>
        </div>
      </Layout>
    )
  }

  if (!companyInfo && user?.role === 'ADMIN') {
    return (
      <Layout>
        <div className="px-4 py-6 sm:px-0">
          <div className="text-center py-8 text-gray-500">Company information not found</div>
        </div>
      </Layout>
    )
  }
  

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <h1 className="text-2xl font-bold mb-6">Company Settings</h1>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {user?.role === 'ADMIN' && (
              <>
                <button
                  onClick={() => setActiveTab('info')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'info'
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Company Information
                </button>
                <button
                  onClick={() => setActiveTab('payroll')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'payroll'
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Payroll Settings
                </button>
              </>
            )}
            {user?.role === 'DEVELOPER' && (
              <button
                onClick={() => {
                  setActiveTab('email')
                  checkGmailHealth()
                }}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'email'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Email Service
              </button>
            )}
          </nav>
        </div>

        {/* Company Information Tab - Admin Only */}
        {activeTab === 'info' && user?.role === 'ADMIN' && (
          <div className="space-y-6">
            {/* Kiosk URL Section */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-lg font-medium text-blue-900 mb-2">Kiosk URL</h3>
              <p className="text-sm text-blue-700 mb-3">
                Share this URL with your employees for clock-in/clock-out. This URL is unique to your company.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  readOnly
                  value={kioskUrl}
                  className="flex-1 px-3 py-2 bg-white border border-blue-300 rounded-md text-sm font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (kioskUrl) {
                      navigator.clipboard.writeText(kioskUrl)
                      toast.success('Kiosk URL copied to clipboard!')
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                >
                  Copy URL
                </button>
              </div>
              {!companyInfo.kiosk_enabled && (
                <p className="text-sm text-red-600 mt-2">
                  ⚠️ Kiosk is currently disabled for your company.
                </p>
              )}
            </div>

            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Company Information</h2>
              <form onSubmit={handleSubmitName(onSubmitName)} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Company Name</label>
                <input
                  {...registerName('name')}
                  type="text"
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                />
                {nameErrors.name && (
                  <p className="mt-1 text-sm text-red-600">{nameErrors.name.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Company ID</label>
                <input
                  type="text"
                  value={companyInfo.id}
                  disabled
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-100 text-gray-500 sm:text-sm cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Created At</label>
                <input
                  type="text"
                  value={new Date(companyInfo.created_at).toLocaleString()}
                  disabled
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-100 text-gray-500 sm:text-sm cursor-not-allowed"
                />
              </div>

              {companyInfo.admin && (
                <>
                  <div className="border-t border-gray-200 pt-6 mt-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Administrator Information</h3>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Admin Name</label>
                    <input
                      type="text"
                      value={companyInfo.admin.name}
                      disabled
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-100 text-gray-500 sm:text-sm cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Admin Email</label>
                    <input
                      type="text"
                      value={companyInfo.admin.email}
                      disabled
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-100 text-gray-500 sm:text-sm cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Admin ID</label>
                    <input
                      type="text"
                      value={companyInfo.admin.id}
                      disabled
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-100 text-gray-500 sm:text-sm cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Account Created At</label>
                    <input
                      type="text"
                      value={new Date(companyInfo.admin.created_at).toLocaleString()}
                      disabled
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-100 text-gray-500 sm:text-sm cursor-not-allowed"
                    />
                  </div>

                  {companyInfo.admin.last_login_at && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Last Login</label>
                      <input
                        type="text"
                        value={new Date(companyInfo.admin.last_login_at).toLocaleString()}
                        disabled
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-100 text-gray-500 sm:text-sm cursor-not-allowed"
                      />
                    </div>
                  )}
                </>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
          </div>
        )}

        {/* Email Service Tab - Developer Only */}
        {activeTab === 'email' && user?.role === 'DEVELOPER' && (
          <div className="space-y-6">
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Gmail API Configuration</h2>
              <p className="text-sm text-gray-600 mb-6">
                Manage Gmail API authentication for sending verification emails. The refresh token expires after 6 months of non-use.
              </p>

              {/* Health Status */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium">Service Status</h3>
                  <button
                    onClick={checkGmailHealth}
                    disabled={checkingGmail}
                    className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
                  >
                    {checkingGmail ? 'Checking...' : 'Refresh Status'}
                  </button>
                </div>
                
                {gmailHealth && (
                  <div className={`p-4 rounded-lg border ${
                    gmailHealth.status === 'healthy' 
                      ? 'bg-green-50 border-green-200' 
                      : 'bg-red-50 border-red-200'
                  }`}>
                    <div className="flex items-center">
                      <div className={`w-3 h-3 rounded-full mr-3 ${
                        gmailHealth.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'
                      }`}></div>
                      <div>
                        <p className={`font-medium ${
                          gmailHealth.status === 'healthy' ? 'text-green-800' : 'text-red-800'
                        }`}>
                          {gmailHealth.status === 'healthy' ? 'Operational' : 'Error'}
                        </p>
                        <p className={`text-sm ${
                          gmailHealth.status === 'healthy' ? 'text-green-700' : 'text-red-700'
                        }`}>
                          {gmailHealth.message}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {gmailHealth?.needs_reauthorization && (
                  <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <h4 className="font-medium text-yellow-900 mb-2">Re-authorization Required</h4>
                    <p className="text-sm text-yellow-800 mb-4">
                      The Gmail refresh token has expired. Follow these steps to re-authorize:
                    </p>
                    <ol className="list-decimal list-inside text-sm text-yellow-800 space-y-2 mb-4">
                      <li>Visit <a href="https://developers.google.com/oauthplayground/" target="_blank" rel="noopener noreferrer" className="underline">Google OAuth 2.0 Playground</a></li>
                      <li><strong>⚠️ CRITICAL:</strong> Click the Settings icon (⚙️) and check &quot;Use your own OAuth credentials&quot;</li>
                      <li>Enter your Client ID and Client Secret from Google Cloud Console</li>
                      <li>Select &quot;Gmail API v1&quot; → &quot;https://www.googleapis.com/auth/gmail.send&quot;</li>
                      <li>Click &quot;Authorize APIs&quot; and complete OAuth flow</li>
                      <li>Click &quot;Exchange authorization code for tokens&quot;</li>
                      <li>Copy the &quot;Refresh token&quot; from the response</li>
                      <li>Use the token update form below to update your token</li>
                    </ol>
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
                      <p className="text-xs text-red-800 font-medium">
                        ⚠️ <strong>Important:</strong> If you use default Playground credentials (don&apos;t configure your own), the refresh token will expire in 24 hours. Always use your own OAuth credentials for long-lived tokens.
                      </p>
                    </div>
                    <p className="text-xs text-yellow-700">
                      See <code className="bg-yellow-100 px-1 rounded">server/GMAIL_SETUP_PLAYGROUND.md</code> for detailed instructions.
                    </p>
                  </div>
                )}
              </div>

              {/* Token Update Form */}
              <div className="border-t pt-6">
                <h3 className="text-lg font-medium mb-4">Update Gmail Token</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Paste the complete token JSON from Google OAuth 2.0 Playground or use the refresh token:
                </p>
                <form onSubmit={(e) => {
                  e.preventDefault()
                  const formData = new FormData(e.target as HTMLFormElement)
                  const tokenJson = formData.get('tokenJson') as string
                  if (tokenJson) {
                    handleUpdateGmailToken(tokenJson)
                  }
                }} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Token JSON
                    </label>
                    <textarea
                      name="tokenJson"
                      rows={6}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                      placeholder='{"refresh_token": "...", "client_id": "...", "client_secret": "...", "token_uri": "https://oauth2.googleapis.com/token", "scopes": ["https://www.googleapis.com/auth/gmail.send"]}'
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Paste the complete token JSON object from Google OAuth 2.0 Playground
                    </p>
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    Update Token
                  </button>
                </form>
              </div>

              {/* Test Email */}
              <div className="border-t pt-6 mt-6">
                <h3 className="text-lg font-medium mb-4">Test Email Sending</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Send a test email to verify Gmail API is working correctly.
                </p>
                <button
                  onClick={handleTestGmail}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Send Test Email
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Payroll Settings Tab - Admin Only */}
        {activeTab === 'payroll' && user?.role === 'ADMIN' && (
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Payroll Settings</h2>
            <p className="text-sm text-gray-600 mb-6">
              Configure payroll calculation settings. These settings affect how payroll runs are calculated.
            </p>
            <form onSubmit={handleSubmitSettings(onSubmitSettings)} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Timezone</label>
                <Controller
                  name="timezone"
                  control={controlSettings}
                  render={({ field }) => (
                    <select
                      {...field}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    >
                      {timezones.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  )}
                />
                <p className="mt-1 text-xs text-gray-500">Timezone used for payroll calculations</p>
                {settingsErrors.timezone && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.timezone.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Payroll Week Start Day</label>
                <Controller
                  name="payroll_week_start_day"
                  control={controlSettings}
                  render={({ field }) => (
                    <select
                      {...field}
                      value={field.value}
                      onChange={(e) => field.onChange(parseInt(e.target.value))}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    >
                      {weekDays.map((day) => (
                        <option key={day.value} value={day.value}>
                          {day.label}
                        </option>
                      ))}
                    </select>
                  )}
                />
                <p className="mt-1 text-xs text-gray-500">First day of the week for payroll calculations</p>
                {settingsErrors.payroll_week_start_day && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.payroll_week_start_day.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Biweekly Anchor Date (Optional)</label>
                <Controller
                  name="biweekly_anchor_date"
                  control={controlSettings}
                  render={({ field }) => (
                    <input
                      type="date"
                      value={field.value || ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                      onBlur={field.onBlur}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    />
                  )}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Starting date for biweekly payroll periods. Leave empty to use flexible biweekly periods.
                </p>
                {settingsErrors.biweekly_anchor_date && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.biweekly_anchor_date.message}</p>
                )}
              </div>

              <div>
                <Controller
                  name="overtime_enabled"
                  control={controlSettings}
                  render={({ field }) => (
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">Enable Overtime Calculation</span>
                    </label>
                  )}
                />
                <p className="mt-1 text-xs text-gray-500">When enabled, hours over the threshold are calculated as overtime</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Overtime Threshold (Hours per Week)</label>
                <Controller
                  name="overtime_threshold_hours_per_week"
                  control={controlSettings}
                  render={({ field }) => (
                    <input
                      {...field}
                      type="number"
                      min="1"
                      max="168"
                      value={field.value}
                      onChange={(e) => field.onChange(parseInt(e.target.value))}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    />
                  )}
                />
                <p className="mt-1 text-xs text-gray-500">Hours worked per week before overtime kicks in (default: 40)</p>
                {settingsErrors.overtime_threshold_hours_per_week && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.overtime_threshold_hours_per_week.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Default Overtime Multiplier</label>
                <Controller
                  name="overtime_multiplier_default"
                  control={controlSettings}
                  render={({ field }) => (
                    <input
                      {...field}
                      type="number"
                      step="0.1"
                      min="1"
                      max="3"
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    />
                  )}
                />
                <p className="mt-1 text-xs text-gray-500">Multiplier for overtime pay (e.g., 1.5 = time and a half)</p>
                {settingsErrors.overtime_multiplier_default && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.overtime_multiplier_default.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Rounding Policy</label>
                <Controller
                  name="rounding_policy"
                  control={controlSettings}
                  render={({ field }) => (
                    <select
                      {...field}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    >
                      <option value="none">None (Exact minutes)</option>
                      <option value="5">5 minutes</option>
                      <option value="10">10 minutes</option>
                      <option value="15">15 minutes</option>
                    </select>
                  )}
                />
                <p className="mt-1 text-xs text-gray-500">Round time entries to nearest interval (or exact if none)</p>
                {settingsErrors.rounding_policy && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.rounding_policy.message}</p>
                )}
              </div>

              <div>
                <Controller
                  name="breaks_paid"
                  control={controlSettings}
                  render={({ field }) => (
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">Breaks are Paid</span>
                    </label>
                  )}
                />
                <p className="mt-1 text-xs text-gray-500">
                  When enabled, break time is included in paid hours. When disabled (default), breaks are deducted from total hours worked.
                </p>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  )
}
