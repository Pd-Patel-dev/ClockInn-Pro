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
  rounding_policy: z.enum(['none', '5', '6', '10', '15', '30']),
  breaks_paid: z.boolean(),
  schedule_day_start_hour: z.number().int().min(0).max(23),
  schedule_day_end_hour: z.number().int().min(0).max(23),
  shift_notes_enabled: z.boolean(),
})

const cashDrawerSettingsSchema = z.object({
  cash_drawer_enabled: z.boolean(),
  cash_drawer_required_for_all: z.boolean(),
  cash_drawer_required_roles: z.array(z.string()).optional(),
  cash_drawer_currency: z.string().min(1, 'Currency is required'),
  cash_drawer_starting_amount_cents: z.number().int().min(0),
  cash_drawer_variance_threshold_cents: z.number().int().min(0),
  cash_drawer_allow_edit: z.boolean(),
  cash_drawer_require_manager_review: z.boolean(),
})

const geofenceSettingsSchema = z.object({
  geofence_enabled: z.boolean(),
  office_latitude: z.union([
    z.string().transform((s) => (s === '' ? undefined : parseFloat(s))),
    z.number(),
  ]).optional().nullable(),
  office_longitude: z.union([
    z.string().transform((s) => (s === '' ? undefined : parseFloat(s))),
    z.number(),
  ]).optional().nullable(),
  geofence_radius_meters: z.number().int().min(10).max(5000),
}).refine(
  (data) => {
    if (!data.geofence_enabled) return true
    const lat = typeof data.office_latitude === 'number' ? data.office_latitude : parseFloat(String(data.office_latitude || ''))
    const lon = typeof data.office_longitude === 'number' ? data.office_longitude : parseFloat(String(data.office_longitude || ''))
    return !Number.isNaN(lat) && lat >= -90 && lat <= 90 && !Number.isNaN(lon) && lon >= -180 && lon <= 180
  },
  { message: 'When location check is enabled, enter valid office latitude and longitude.', path: ['office_latitude'] }
)

type CompanyNameForm = z.infer<typeof companyNameSchema>
type CompanySettingsForm = z.infer<typeof companySettingsSchema>
type CashDrawerSettingsForm = z.infer<typeof cashDrawerSettingsSchema>
type GeofenceSettingsForm = z.infer<typeof geofenceSettingsSchema>

interface CompanySettings {
  timezone: string
  payroll_week_start_day: number
  biweekly_anchor_date: string | null
  overtime_enabled: boolean
  overtime_threshold_hours_per_week: number
  overtime_multiplier_default: number
  rounding_policy: string
  breaks_paid: boolean
  cash_drawer_enabled?: boolean
  cash_drawer_required_for_all?: boolean
  cash_drawer_required_roles?: string[]
  cash_drawer_currency?: string
  cash_drawer_starting_amount_cents?: number
  cash_drawer_variance_threshold_cents?: number
  cash_drawer_allow_edit?: boolean
  cash_drawer_require_manager_review?: boolean
  schedule_day_start_hour?: number
  schedule_day_end_hour?: number
  geofence_enabled?: boolean
  office_latitude?: number | null
  office_longitude?: number | null
  geofence_radius_meters?: number
  kiosk_network_restriction_enabled?: boolean
  kiosk_allowed_ips?: string[]
  shift_notes_enabled?: boolean
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
  const [activeTab, setActiveTab] = useState<
    'info' | 'payroll' | 'cash' | 'location' | 'kiosk' | 'email'
  >('info')
  const [geofenceGettingLocation, setGeofenceGettingLocation] = useState(false)
  const [gmailHealth, setGmailHealth] = useState<any>(null)
  const [checkingGmail, setCheckingGmail] = useState(false)
  const [kioskUrl, setKioskUrl] = useState<string>('')
  const [kioskNetworkRestrictionEnabled, setKioskNetworkRestrictionEnabled] = useState(false)
  const [kioskAllowedIpsText, setKioskAllowedIpsText] = useState('')
  const [kioskFetchingMyIp, setKioskFetchingMyIp] = useState(false)

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

  const {
    control: controlCashDrawer,
    handleSubmit: handleSubmitCashDrawer,
    formState: { errors: cashDrawerErrors },
    reset: resetCashDrawer,
    watch: watchCashDrawer,
  } = useForm<CashDrawerSettingsForm>({
    resolver: zodResolver(cashDrawerSettingsSchema),
  })
  
  const cashDrawerEnabled = watchCashDrawer('cash_drawer_enabled')
  const cashDrawerRequiredForAll = watchCashDrawer('cash_drawer_required_for_all')

  const {
    control: controlGeofence,
    handleSubmit: handleSubmitGeofence,
    formState: { errors: geofenceErrors },
    reset: resetGeofence,
    setValue: setValueGeofence,
  } = useForm<GeofenceSettingsForm>({
    resolver: zodResolver(geofenceSettingsSchema),
    defaultValues: {
      geofence_enabled: false,
      office_latitude: undefined,
      office_longitude: undefined,
      geofence_radius_meters: 100,
    },
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
        // Pass currentUser to fetchCompanyInfo to avoid stale closure
        fetchCompanyInfo(currentUser)
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

  const fetchCompanyInfo = async (currentUser?: any) => {
    setLoading(true)
    try {
      // Use passed currentUser or state user, prefer passed user to avoid stale closure
      const userToCheck = currentUser || user
      // Only fetch company info for admins (developers don't need it)
      if (userToCheck?.role === 'ADMIN') {
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
          rounding_policy: response.data.settings.rounding_policy as 'none' | '5' | '6' | '10' | '15' | '30',
          breaks_paid: response.data.settings.breaks_paid ?? false,
          schedule_day_start_hour: response.data.settings.schedule_day_start_hour ?? 7,
          schedule_day_end_hour: response.data.settings.schedule_day_end_hour ?? 7,
          shift_notes_enabled: response.data.settings.shift_notes_enabled ?? true,
        })
        
        // Reset cash drawer form
        resetCashDrawer({
          cash_drawer_enabled: response.data.settings.cash_drawer_enabled ?? false,
          cash_drawer_required_for_all: response.data.settings.cash_drawer_required_for_all ?? true,
          cash_drawer_required_roles: response.data.settings.cash_drawer_required_roles ?? ['FRONTDESK'],
          cash_drawer_currency: response.data.settings.cash_drawer_currency ?? 'USD',
          cash_drawer_starting_amount_cents: response.data.settings.cash_drawer_starting_amount_cents ?? 0,
          cash_drawer_variance_threshold_cents: response.data.settings.cash_drawer_variance_threshold_cents ?? 2000,
          cash_drawer_allow_edit: response.data.settings.cash_drawer_allow_edit ?? true,
          cash_drawer_require_manager_review: response.data.settings.cash_drawer_require_manager_review ?? false,
        })
        resetGeofence({
          geofence_enabled: response.data.settings.geofence_enabled ?? false,
          office_latitude: response.data.settings.office_latitude ?? undefined,
          office_longitude: response.data.settings.office_longitude ?? undefined,
          geofence_radius_meters: response.data.settings.geofence_radius_meters ?? 100,
        })
        setKioskNetworkRestrictionEnabled(response.data.settings.kiosk_network_restriction_enabled ?? false)
        setKioskAllowedIpsText((response.data.settings.kiosk_allowed_ips || []).join('\n'))
        
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
        schedule_day_start_hour: data.schedule_day_start_hour,
        schedule_day_end_hour: data.schedule_day_end_hour,
        shift_notes_enabled: data.shift_notes_enabled,
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
          rounding_policy: response.data.settings.rounding_policy as 'none' | '5' | '6' | '10' | '15' | '30',
          breaks_paid: response.data.settings.breaks_paid ?? false,
          schedule_day_start_hour: response.data.settings.schedule_day_start_hour ?? 7,
          schedule_day_end_hour: response.data.settings.schedule_day_end_hour ?? 7,
          shift_notes_enabled: response.data.settings.shift_notes_enabled ?? true,
        }, { keepDefaultValues: false })
      }, 50)
      
      // Also re-fetch to ensure we have the absolute latest data
      setTimeout(() => {
        fetchCompanyInfo(user)
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

  const onSubmitCashDrawer = async (data: CashDrawerSettingsForm) => {
    setSaving(true)
    try {
      const updateData: any = {
        cash_drawer_enabled: data.cash_drawer_enabled,
        cash_drawer_required_for_all: data.cash_drawer_required_for_all,
        cash_drawer_required_roles: data.cash_drawer_required_roles || [],
        cash_drawer_currency: data.cash_drawer_currency,
        cash_drawer_starting_amount_cents: data.cash_drawer_starting_amount_cents,
        cash_drawer_variance_threshold_cents: data.cash_drawer_variance_threshold_cents,
        cash_drawer_allow_edit: data.cash_drawer_allow_edit,
        cash_drawer_require_manager_review: data.cash_drawer_require_manager_review,
      }
      
      logger.debug('Updating cash drawer settings', { updateData })
      
      const response = await api.put('/admin/company/settings', updateData)
      logger.debug('Cash drawer settings updated successfully', { response: response.data })
      
      setCompanyInfo(response.data)
      
      setTimeout(() => {
        resetCashDrawer({
          cash_drawer_enabled: response.data.settings.cash_drawer_enabled ?? false,
          cash_drawer_required_for_all: response.data.settings.cash_drawer_required_for_all ?? true,
          cash_drawer_required_roles: response.data.settings.cash_drawer_required_roles ?? ['FRONTDESK'],
          cash_drawer_currency: response.data.settings.cash_drawer_currency ?? 'USD',
          cash_drawer_starting_amount_cents: response.data.settings.cash_drawer_starting_amount_cents ?? 0,
          cash_drawer_variance_threshold_cents: response.data.settings.cash_drawer_variance_threshold_cents ?? 2000,
          cash_drawer_allow_edit: response.data.settings.cash_drawer_allow_edit ?? true,
          cash_drawer_require_manager_review: response.data.settings.cash_drawer_require_manager_review ?? false,
        }, { keepDefaultValues: false })
      }, 50)
      
      setTimeout(() => {
        fetchCompanyInfo(user)
      }, 200)
      
      toast.success('Cash drawer settings updated successfully!')
    } catch (error: any) {
      logger.error('Failed to update cash drawer settings', error as Error, { 
        endpoint: '/admin/company/settings',
        errorDetails: error.response?.data 
      })
      toast.error(error.response?.data?.detail || 'Failed to update cash drawer settings')
    } finally {
      setSaving(false)
    }
  }

  const onSubmitGeofence = async (data: GeofenceSettingsForm) => {
    setSaving(true)
    try {
      const updateData: any = {
        geofence_enabled: data.geofence_enabled,
        geofence_radius_meters: data.geofence_radius_meters,
      }
      if (data.geofence_enabled) {
        const lat = typeof data.office_latitude === 'number' ? data.office_latitude : parseFloat(String(data.office_latitude ?? ''))
        const lon = typeof data.office_longitude === 'number' ? data.office_longitude : parseFloat(String(data.office_longitude ?? ''))
        if (!Number.isNaN(lat)) updateData.office_latitude = lat
        if (!Number.isNaN(lon)) updateData.office_longitude = lon
      } else {
        updateData.office_latitude = null
        updateData.office_longitude = null
      }
      const response = await api.put('/admin/company/settings', updateData)
      setCompanyInfo(response.data)
      resetGeofence({
        geofence_enabled: response.data.settings.geofence_enabled ?? false,
        office_latitude: response.data.settings.office_latitude ?? undefined,
        office_longitude: response.data.settings.office_longitude ?? undefined,
        geofence_radius_meters: response.data.settings.geofence_radius_meters ?? 100,
      }, { keepDefaultValues: false })
      toast.success('Punch location settings updated successfully!')
    } catch (error: any) {
      logger.error('Failed to update geofence settings', error as Error)
      toast.error(error.response?.data?.detail || 'Failed to update punch location settings')
    } finally {
      setSaving(false)
    }
  }

  const onSubmitKioskNetwork = async () => {
    setSaving(true)
    try {
      const ips = kioskAllowedIpsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      const response = await api.put('/admin/company/settings', {
        kiosk_network_restriction_enabled: kioskNetworkRestrictionEnabled,
        kiosk_allowed_ips: ips,
      })
      setCompanyInfo(response.data)
      setKioskNetworkRestrictionEnabled(response.data.settings.kiosk_network_restriction_enabled ?? false)
      setKioskAllowedIpsText((response.data.settings.kiosk_allowed_ips || []).join('\n'))
      toast.success('Kiosk network settings updated successfully!')
    } catch (error: any) {
      logger.error('Failed to update kiosk network settings', error as Error)
      toast.error(error.response?.data?.detail || 'Failed to update kiosk network settings')
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

  const scheduleHourOptions = Array.from({ length: 24 }, (_, i) => ({
    value: i,
    label: i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`,
  }))

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
          <div className="text-center py-8 text-slate-500">Company information not found</div>
        </div>
      </Layout>
    )
  }
  

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <h1 className="text-2xl font-bold mb-6">Company Settings</h1>

        {/* Tabs */}
        <div className="border-b border-slate-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {user?.role === 'ADMIN' && (
              <>
                <button
                  onClick={() => setActiveTab('info')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'info'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                  }`}
                >
                  Company Information
                </button>
                <button
                  onClick={() => setActiveTab('payroll')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'payroll'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                  }`}
                >
                  General Settings
                </button>
                <button
                  onClick={() => setActiveTab('cash')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'cash'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                  }`}
                >
                  Cash Drawer
                </button>
                <button
                  onClick={() => setActiveTab('location')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'location'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                  }`}
                >
                  Punch Location
                </button>
                <button
                  onClick={() => setActiveTab('kiosk')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'kiosk'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                  }`}
                >
                  Kiosk Network
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
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
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
                  className="flex-1 px-3 py-2 bg-white border border-blue-300 rounded-md text-sm font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              {companyInfo && !companyInfo.kiosk_enabled && (
                <p className="text-sm text-red-600 mt-2">
                  ⚠️ Kiosk is currently disabled for your company.
                </p>
              )}
            </div>

            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Company Information</h2>
              {companyInfo ? (
              <form onSubmit={handleSubmitName(onSubmitName)} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-700">Company Name</label>
                <input
                  {...registerName('name')}
                  type="text"
                  className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
                {nameErrors.name && (
                  <p className="mt-1 text-sm text-red-600">{nameErrors.name.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Company ID</label>
                <input
                  type="text"
                  value={companyInfo.id}
                  disabled
                  className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm bg-slate-100 text-slate-500 sm:text-sm cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Created At</label>
                <input
                  type="text"
                  value={new Date(companyInfo.created_at).toLocaleString()}
                  disabled
                  className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm bg-slate-100 text-slate-500 sm:text-sm cursor-not-allowed"
                />
              </div>

              {companyInfo.admin && (
                <>
                  <div className="border-t border-slate-200 pt-6 mt-6">
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">Administrator Information</h3>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700">Admin Name</label>
                    <input
                      type="text"
                      value={companyInfo.admin.name}
                      disabled
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm bg-slate-100 text-slate-500 sm:text-sm cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700">Admin Email</label>
                    <input
                      type="text"
                      value={companyInfo.admin.email}
                      disabled
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm bg-slate-100 text-slate-500 sm:text-sm cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700">Admin ID</label>
                    <input
                      type="text"
                      value={companyInfo.admin.id}
                      disabled
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm bg-slate-100 text-slate-500 sm:text-sm cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700">Account Created At</label>
                    <input
                      type="text"
                      value={new Date(companyInfo.admin.created_at).toLocaleString()}
                      disabled
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm bg-slate-100 text-slate-500 sm:text-sm cursor-not-allowed"
                    />
                  </div>

                  {companyInfo.admin.last_login_at && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700">Last Login</label>
                      <input
                        type="text"
                        value={new Date(companyInfo.admin.last_login_at).toLocaleString()}
                        disabled
                        className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm bg-slate-100 text-slate-500 sm:text-sm cursor-not-allowed"
                      />
                    </div>
                  )}
                </>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
            ) : (
              <p className="text-slate-500">Loading company information...</p>
            )}
          </div>
          </div>
        )}

        {/* Email Service Tab - Developer Only */}
        {activeTab === 'email' && user?.role === 'DEVELOPER' && (
          <div className="space-y-6">
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Gmail API Configuration</h2>
              <p className="text-sm text-slate-600 mb-6">
                Manage Gmail API authentication for sending verification emails. The refresh token expires after 6 months of non-use.
              </p>

              {/* Health Status */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium">Service Status</h3>
                  <button
                    onClick={checkGmailHealth}
                    disabled={checkingGmail}
                    className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded hover:bg-slate-200 disabled:opacity-50"
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
                <p className="text-sm text-slate-600 mb-4">
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
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Token JSON
                    </label>
                    <textarea
                      name="tokenJson"
                      rows={6}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                      placeholder='{"refresh_token": "...", "client_id": "...", "client_secret": "...", "token_uri": "https://oauth2.googleapis.com/token", "scopes": ["https://www.googleapis.com/auth/gmail.send"]}'
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Paste the complete token JSON object from Google OAuth 2.0 Playground
                    </p>
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    Update Token
                  </button>
                </form>
              </div>

              {/* Test Email */}
              <div className="border-t pt-6 mt-6">
                <h3 className="text-lg font-medium mb-4">Test Email Sending</h3>
                <p className="text-sm text-slate-600 mb-4">
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

        {/* General Settings Tab - Admin Only */}
        {activeTab === 'payroll' && user?.role === 'ADMIN' && (
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">General Settings</h2>
            <p className="text-sm text-slate-600 mb-6">
              Configure general company settings including timezone, overtime, time rounding, break policies, shift notes, and schedule view. These settings affect time tracking and payroll calculations.
            </p>
            <form onSubmit={handleSubmitSettings(onSubmitSettings)} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-700">Timezone</label>
                <Controller
                  name="timezone"
                  control={controlSettings}
                  render={({ field }) => (
                    <select
                      {...field}
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    >
                      {timezones.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">Timezone used for payroll calculations</p>
                {settingsErrors.timezone && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.timezone.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Payroll Week Start Day</label>
                <Controller
                  name="payroll_week_start_day"
                  control={controlSettings}
                  render={({ field }) => (
                    <select
                      {...field}
                      value={field.value}
                      onChange={(e) => field.onChange(parseInt(e.target.value))}
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    >
                      {weekDays.map((day) => (
                        <option key={day.value} value={day.value}>
                          {day.label}
                        </option>
                      ))}
                    </select>
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">First day of the week for payroll calculations</p>
                {settingsErrors.payroll_week_start_day && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.payroll_week_start_day.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Biweekly Anchor Date (Optional)</label>
                <Controller
                  name="biweekly_anchor_date"
                  control={controlSettings}
                  render={({ field }) => (
                    <input
                      type="date"
                      value={field.value || ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                      onBlur={field.onBlur}
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">
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
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-slate-700">Enable Overtime Calculation</span>
                    </label>
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">When enabled, hours over the threshold are calculated as overtime</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Overtime Threshold (Hours per Week)</label>
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
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">Hours worked per week before overtime kicks in (default: 40)</p>
                {settingsErrors.overtime_threshold_hours_per_week && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.overtime_threshold_hours_per_week.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Default Overtime Multiplier</label>
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
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">Multiplier for overtime pay (e.g., 1.5 = time and a half)</p>
                {settingsErrors.overtime_multiplier_default && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.overtime_multiplier_default.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Time Rounding:</label>
                <Controller
                  name="rounding_policy"
                  control={controlSettings}
                  render={({ field }) => (
                    <select
                      {...field}
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    >
                      <option value="none">None</option>
                      <option value="5">5 Minutes</option>
                      <option value="6">6 Minutes (1/10th of an hour)</option>
                      <option value="10">10 Minutes</option>
                      <option value="15">15 Minutes (7-minute rule)</option>
                      <option value="30">30 Minutes</option>
                    </select>
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">Round time entries to the nearest interval. The 7-minute rule for 15-minute rounding rounds down if ≤7 minutes and up if ≥8 minutes into the quarter hour.</p>
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
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-slate-700">Breaks are Paid</span>
                    </label>
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">
                  When enabled, break time is included in paid hours. When disabled (default), breaks are deducted from total hours worked.
                </p>
              </div>

              <div className="border-t border-slate-200 pt-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Shift notes</h3>
                <p className="text-sm text-slate-600 mb-4">
                  Let employees and admins use the shift notepad (common log) for handoffs and notes tied to shifts. When turned off, shift note features are hidden and API access is disabled for your company.
                </p>
                <Controller
                  name="shift_notes_enabled"
                  control={controlSettings}
                  render={({ field }) => (
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-slate-700">Enable shift notes (shift notepad)</span>
                    </label>
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Disable if your company does not use shift handoff notes. Employees will no longer see Shift Notepad in the menu when disabled.
                </p>
              </div>

              <div className="border-t border-slate-200 pt-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Schedule View</h3>
                <p className="text-sm text-slate-600 mb-4">
                  Set when the scheduling day starts and ends. The weekly schedule timeline will use these hours to build time blocks. Use the same time for both to show a full 24-hour day (e.g. 7 AM to 7 AM next day).
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Schedule day starts at</label>
                    <Controller
                      name="schedule_day_start_hour"
                      control={controlSettings}
                      render={({ field }) => (
                        <select
                          {...field}
                          value={field.value}
                          onChange={(e) => field.onChange(parseInt(e.target.value))}
                          className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        >
                          {scheduleHourOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      )}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Schedule day ends at</label>
                    <Controller
                      name="schedule_day_end_hour"
                      control={controlSettings}
                      render={({ field }) => (
                        <select
                          {...field}
                          value={field.value}
                          onChange={(e) => field.onChange(parseInt(e.target.value))}
                          className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        >
                          {scheduleHourOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      )}
                    />
                    <p className="mt-1 text-xs text-slate-500">Same as start = 24-hour day (e.g. 7 AM–7 AM next day)</p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Cash Drawer Settings Tab - Admin Only */}
        {activeTab === 'cash' && user?.role === 'ADMIN' && (
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Cash Drawer Settings</h2>
            <p className="text-sm text-slate-600 mb-6">
              Configure cash drawer management settings. Employees will be prompted to enter cash counts when clocking in/out.
            </p>
            <form onSubmit={handleSubmitCashDrawer(onSubmitCashDrawer)} className="space-y-6">
              <div>
                <Controller
                  name="cash_drawer_enabled"
                  control={controlCashDrawer}
                  render={({ field }) => (
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-slate-700">Enable Cash Drawer Management</span>
                    </label>
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">When enabled, employees will be required to enter cash counts when clocking in/out</p>
              </div>

              <div>
                <Controller
                  name="cash_drawer_required_for_all"
                  control={controlCashDrawer}
                  render={({ field }) => (
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        disabled={!cashDrawerEnabled}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                      />
                      <span className="ml-2 text-sm text-slate-700">Require Cash Drawer for All Employees</span>
                    </label>
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">When enabled, all employees must enter cash counts. When disabled, only specified roles are required.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Required Roles</label>
                <Controller
                  name="cash_drawer_required_roles"
                  control={controlCashDrawer}
                  render={({ field }) => (
                    <div className="mt-2 space-y-2">
                      {[
                        { value: 'MAINTENANCE', label: 'Maintenance' },
                        { value: 'FRONTDESK', label: 'Front Desk' },
                        { value: 'HOUSEKEEPING', label: 'Housekeeping' },
                        { value: 'ADMIN', label: 'Admin' },
                        { value: 'DEVELOPER', label: 'Developer' },
                      ].map((role) => (
                        <label key={role.value} className="flex items-center">
                          <input
                            type="checkbox"
                            checked={field.value?.includes(role.value) || false}
                            onChange={(e) => {
                              const currentRoles = field.value || []
                              if (e.target.checked) {
                                field.onChange([...currentRoles, role.value])
                              } else {
                                field.onChange(currentRoles.filter((r) => r !== role.value))
                              }
                            }}
                            onBlur={field.onBlur}
                            disabled={!cashDrawerEnabled || cashDrawerRequiredForAll}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                          />
                          <span className="ml-2 text-sm text-slate-700">{role.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">Select which roles require cash drawer entry (only applies if &quot;Require for All&quot; is disabled)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Currency</label>
                <Controller
                  name="cash_drawer_currency"
                  control={controlCashDrawer}
                  render={({ field }) => (
                    <select
                      {...field}
                      disabled={!cashDrawerEnabled}
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:opacity-50"
                    >
                      <option value="USD">USD - US Dollar</option>
                      <option value="EUR">EUR - Euro</option>
                      <option value="GBP">GBP - British Pound</option>
                      <option value="CAD">CAD - Canadian Dollar</option>
                      <option value="AUD">AUD - Australian Dollar</option>
                    </select>
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">Currency used for cash drawer amounts</p>
                {cashDrawerErrors.cash_drawer_currency && (
                  <p className="mt-1 text-sm text-red-600">{cashDrawerErrors.cash_drawer_currency.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Starting Cash Count ($)</label>
                <Controller
                  name="cash_drawer_starting_amount_cents"
                  control={controlCashDrawer}
                  render={({ field }) => (
                    <input
                      {...field}
                      type="number"
                      min="0"
                      step="0.01"
                      value={(field.value || 0) / 100}
                      onChange={(e) => field.onChange(Math.round(parseFloat(e.target.value || '0') * 100))}
                      disabled={!cashDrawerEnabled}
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:opacity-50"
                    />
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">Default starting cash amount in dollars. This can be used as a reference or pre-filled value when employees clock in (default: $0.00)</p>
                {cashDrawerErrors.cash_drawer_starting_amount_cents && (
                  <p className="mt-1 text-sm text-red-600">{cashDrawerErrors.cash_drawer_starting_amount_cents.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Variance Threshold ($)</label>
                <Controller
                  name="cash_drawer_variance_threshold_cents"
                  control={controlCashDrawer}
                  render={({ field }) => (
                    <input
                      {...field}
                      type="number"
                      min="0"
                      step="0.01"
                      value={(field.value || 0) / 100}
                      onChange={(e) => field.onChange(Math.round(parseFloat(e.target.value || '0') * 100))}
                      disabled={!cashDrawerEnabled}
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:opacity-50"
                    />
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">Cash variance threshold in dollars. Sessions exceeding this amount will be flagged for review (default: $20.00)</p>
                {cashDrawerErrors.cash_drawer_variance_threshold_cents && (
                  <p className="mt-1 text-sm text-red-600">{cashDrawerErrors.cash_drawer_variance_threshold_cents.message}</p>
                )}
              </div>

              <div>
                <Controller
                  name="cash_drawer_allow_edit"
                  control={controlCashDrawer}
                  render={({ field }) => (
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        disabled={!cashDrawerEnabled}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                      />
                      <span className="ml-2 text-sm text-slate-700">Allow Editing Cash Drawer Sessions</span>
                    </label>
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">When enabled, admins can edit cash drawer session amounts after they are created</p>
              </div>

              <div>
                <Controller
                  name="cash_drawer_require_manager_review"
                  control={controlCashDrawer}
                  render={({ field }) => (
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        disabled={!cashDrawerEnabled}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                      />
                      <span className="ml-2 text-sm text-slate-700">Require Manager Review for Variances</span>
                    </label>
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">When enabled, sessions with variances exceeding the threshold must be reviewed and approved by a manager</p>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Punch Location (Geofence) Tab - Admin Only */}
        {activeTab === 'location' && user?.role === 'ADMIN' && (
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Punch Location</h2>
            <p className="text-sm text-slate-600 mb-6">
              Require employees to be at the office to punch in or out. When enabled, punch requests are only accepted when the employee&apos;s device is within the configured radius of the office location.
            </p>
            <form onSubmit={handleSubmitGeofence(onSubmitGeofence)} className="space-y-6">
              <div>
                <Controller
                  name="geofence_enabled"
                  control={controlGeofence}
                  render={({ field }) => (
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-slate-700">Require punch at office location</span>
                    </label>
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">When enabled, employees must be within the radius below to clock in/out</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <button
                  type="button"
                  disabled={geofenceGettingLocation || (typeof navigator !== 'undefined' && !navigator.geolocation)}
                  onClick={() => {
                    if (typeof navigator === 'undefined' || !navigator.geolocation) return
                    setGeofenceGettingLocation(true)
                    navigator.geolocation.getCurrentPosition(
                      (position) => {
                        setValueGeofence('office_latitude', position.coords.latitude)
                        setValueGeofence('office_longitude', position.coords.longitude)
                        setGeofenceGettingLocation(false)
                      },
                      () => setGeofenceGettingLocation(false),
                      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
                    )
                  }}
                  className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded-md hover:bg-slate-200 disabled:opacity-50 border border-slate-300"
                >
                  {geofenceGettingLocation ? 'Getting location…' : 'Use current location'}
                </button>
                {typeof navigator !== 'undefined' && !navigator.geolocation && (
                  <span className="text-xs text-slate-500">Location not available in this browser</span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Office latitude</label>
                  <Controller
                    name="office_latitude"
                    control={controlGeofence}
                    render={({ field }) => (
                      <input
                        type="number"
                        step="any"
                        placeholder="e.g. 40.7128"
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value === '' ? undefined : e.target.value)}
                        onBlur={field.onBlur}
                        className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                      />
                    )}
                  />
                  <p className="mt-1 text-xs text-slate-500">-90 to 90</p>
                  {geofenceErrors.office_latitude && (
                    <p className="mt-1 text-sm text-red-600">{geofenceErrors.office_latitude.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Office longitude</label>
                  <Controller
                    name="office_longitude"
                    control={controlGeofence}
                    render={({ field }) => (
                      <input
                        type="number"
                        step="any"
                        placeholder="e.g. -74.0060"
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value === '' ? undefined : e.target.value)}
                        onBlur={field.onBlur}
                        className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                      />
                    )}
                  />
                  <p className="mt-1 text-xs text-slate-500">-180 to 180</p>
                  {geofenceErrors.office_longitude && (
                    <p className="mt-1 text-sm text-red-600">{geofenceErrors.office_longitude.message}</p>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Allowed radius (meters)</label>
                <Controller
                  name="geofence_radius_meters"
                  control={controlGeofence}
                  render={({ field }) => (
                    <input
                      {...field}
                      type="number"
                      min={10}
                      max={5000}
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  )}
                />
                <p className="mt-1 text-xs text-slate-500">Employees must be within this distance of the office to punch (10–5000 m)</p>
                {geofenceErrors.geofence_radius_meters && (
                  <p className="mt-1 text-sm text-red-600">{geofenceErrors.geofence_radius_meters.message}</p>
                )}
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Kiosk Network Tab - Admin Only */}
        {activeTab === 'kiosk' && user?.role === 'ADMIN' && (
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Kiosk Network</h2>
            <p className="text-sm text-slate-600 mb-6">
              Restrict the kiosk so it only works when opened from the office network. Add the office IP range or specific IPs below. Requests from other networks will be blocked.
            </p>
            <div className="space-y-6">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={kioskNetworkRestrictionEnabled}
                  onChange={(e) => setKioskNetworkRestrictionEnabled(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-slate-700">Restrict kiosk to office network only</span>
              </label>
              <p className="text-xs text-slate-500">When enabled, the kiosk page and clock-in/out will only work from the IPs or ranges listed below.</p>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block text-sm font-medium text-slate-700">Allowed IPs or CIDR ranges (one per line)</label>
                  <button
                    type="button"
                    disabled={kioskFetchingMyIp}
                    onClick={async () => {
                      setKioskFetchingMyIp(true)
                      try {
                        const res = await api.get('/company/my-ip')
                        const ip = res.data?.ip
                        if (ip && ip !== 'unknown') {
                          setKioskAllowedIpsText((prev) => (prev.trim() ? `${prev.trim()}\n${ip}` : ip))
                          toast.success(`Added ${ip}`)
                        } else {
                          toast.error('Could not get current IP')
                        }
                      } catch (e: any) {
                        toast.error(e.response?.data?.detail || 'Could not get current IP')
                      } finally {
                        setKioskFetchingMyIp(false)
                      }
                    }}
                    className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded-md hover:bg-slate-200 disabled:opacity-50 border border-slate-300"
                  >
                    {kioskFetchingMyIp ? 'Getting…' : 'Add my current IP'}
                  </button>
                </div>
                <textarea
                  value={kioskAllowedIpsText}
                  onChange={(e) => setKioskAllowedIpsText(e.target.value)}
                  placeholder={'192.168.1.0/24\n10.0.0.1'}
                  rows={5}
                  className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm font-mono"
                />
                <p className="mt-1 text-xs text-slate-500">Examples: 192.168.1.0/24 (entire subnet), 10.0.0.1 (single IP). Use “Add my current IP” when at the office to add this device.</p>
                <p className="mt-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">If the same IP is added from different networks, configure your reverse proxy to send the real client IP (e.g. nginx: <code className="bg-amber-100 px-1">proxy_set_header X-Real-IP $remote_addr</code>; Cloudflare uses CF-Connecting-IP automatically).</p>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onSubmitKioskNetwork}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </Layout>
  )
}
