'use client'

import { useEffect, useState, type ReactNode, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Layout from '@/components/Layout'
import PageAtmosphere from '@/components/PageAtmosphere'
import api from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import logger from '@/lib/logger'
import { useToast } from '@/components/Toast'
import {
  DEFAULT_KIOSK_ALLOWED_ROLES,
  DEFAULT_PUNCH_ALLOWED_ROLES,
  PUNCH_ROLE_OPTIONS,
} from '@/lib/punch'
import RolesPermissionsTab from '@/components/settings/RolesPermissionsTab'
import { InfoTip } from '@/components/ui/InfoTip'

function FieldLabel({
  children,
  tip,
  className = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400',
}: {
  children: ReactNode
  tip: string
  className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span>{children}</span>
      <InfoTip label={typeof children === 'string' ? children : 'More info'} content={tip} />
    </span>
  )
}

function SectionTitle({
  children,
  tip,
  as: Tag = 'h3',
  subtitle,
}: {
  children: ReactNode
  tip: string
  as?: 'h2' | 'h3'
  subtitle?: string
}) {
  if (Tag === 'h2') {
    return (
      <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
        <Tag className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          {children}
          <InfoTip label={typeof children === 'string' ? children : 'More info'} content={tip} />
        </Tag>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
    )
  }
  return (
    <Tag className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 mb-2">
      {children}
      <InfoTip label={typeof children === 'string' ? children : 'More info'} content={tip} />
    </Tag>
  )
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) {
  const valueStr = String(value)
  const compact = valueStr.length > 12
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p>
      <p
        className={`mt-1 font-semibold tracking-tight text-slate-900 ${
          compact ? 'truncate text-base sm:text-lg' : 'text-2xl tabular-nums'
        }`}
        title={valueStr}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

const companyNameSchema = z.object({
  name: z.string().min(1, 'Company name is required').max(255, 'Company name is too long'),
})

const companySettingsSchema = z.object({
  timezone: z.string().min(1, 'Timezone is required'),
  payroll_week_start_day: z.number().int().min(0).max(6),
  biweekly_anchor_date: z.string().optional().nullable(),
  last_pay_date: z.string().optional().nullable(),
  payroll_pay_type: z.enum(['WEEKLY', 'BIWEEKLY']).optional().nullable(),
  payroll_reminder_enabled: z.boolean().optional(),
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
  auto_clock_out_enabled: z.boolean(),
  /** Hours after scheduled end before auto clock-out runs (0–12). Stored as minutes. */
  auto_clock_out_grace_hours: z.number().int().min(0).max(12),
  punch_allowed_roles: z.array(z.string()).optional(),
})

const marketplaceItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1, 'Label is required').max(100),
  price_cents: z.number().int().min(0),
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

const marketplaceSettingsSchema = z.object({
  marketplace_enabled: z.boolean(),
  marketplace_items: z.array(marketplaceItemSchema).optional(),
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
type MarketplaceSettingsForm = z.infer<typeof marketplaceSettingsSchema>
type GeofenceSettingsForm = z.infer<typeof geofenceSettingsSchema>

interface CompanySettings {
  timezone: string
  payroll_week_start_day: number
  biweekly_anchor_date: string | null
  last_pay_date?: string | null
  payroll_pay_type?: 'WEEKLY' | 'BIWEEKLY' | null
  payroll_reminder_enabled?: boolean
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
  marketplace_enabled?: boolean
  marketplace_items?: { id: string; label: string; price_cents: number }[]
  schedule_day_start_hour?: number
  schedule_day_end_hour?: number
  geofence_enabled?: boolean
  office_latitude?: number | null
  office_longitude?: number | null
  geofence_radius_meters?: number
  kiosk_network_restriction_enabled?: boolean
  kiosk_allowed_ips?: string[]
  auto_clock_out_enabled?: boolean
  auto_clock_out_grace_minutes?: number
  punch_allowed_roles?: string[]
  kiosk_allowed_roles?: string[]
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

type SettingsTab = 'info' | 'payroll' | 'cash' | 'marketplace' | 'location' | 'kiosk' | 'roles' | 'email'

function AdminSettingsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('info')
  const [geofenceGettingLocation, setGeofenceGettingLocation] = useState(false)
  const [gmailHealth, setGmailHealth] = useState<any>(null)
  const [checkingGmail, setCheckingGmail] = useState(false)
  const [emailServiceDetails, setEmailServiceDetails] = useState<{
    email_service?: any
    configuration?: any
  } | null>(null)
  const [kioskUrl, setKioskUrl] = useState<string>('')
  const [kioskEnabled, setKioskEnabled] = useState(true)
  const [kioskNetworkRestrictionEnabled, setKioskNetworkRestrictionEnabled] = useState(false)
  const [kioskAllowedIpsText, setKioskAllowedIpsText] = useState('')
  const [kioskAllowedRoles, setKioskAllowedRoles] = useState<string[]>([
    ...DEFAULT_KIOSK_ALLOWED_ROLES,
  ])
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
    control: controlMarketplace,
    handleSubmit: handleSubmitMarketplace,
    reset: resetMarketplace,
    watch: watchMarketplace,
  } = useForm<MarketplaceSettingsForm>({
    resolver: zodResolver(marketplaceSettingsSchema),
    defaultValues: {
      marketplace_enabled: false,
    },
  })
  const marketplaceEnabled = watchMarketplace('marketplace_enabled')
  const [marketplaceItems, setMarketplaceItems] = useState<
    { id: string; label: string; price_cents: number }[]
  >([])

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
        if (currentUser.role === 'DEVELOPER') {
          router.replace('/settings/email')
          return
        }
        if (currentUser.role !== 'ADMIN') {
          router.push('/dashboard')
          return
        }
        // Pass currentUser to fetchCompanyInfo to avoid stale closure
        fetchCompanyInfo(currentUser)
      } catch (err: any) {
        logger.error('Authentication error', err as Error, { action: 'fetchCompanyInfo' })
        router.push('/login')
      }
    }
    checkAdminAndFetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (
      tab === 'roles' ||
      tab === 'payroll' ||
      tab === 'cash' ||
      tab === 'marketplace' ||
      tab === 'location' ||
      tab === 'kiosk' ||
      tab === 'info'
    ) {
      setActiveTab(tab)
    }
  }, [searchParams])

  // Set kiosk URL on client side to avoid hydration mismatch
  useEffect(() => {
    if (companyInfo?.slug && typeof window !== 'undefined') {
      setKioskUrl(`${window.location.origin}/kiosk/${companyInfo.slug}`)
    }
  }, [companyInfo?.slug])

  const checkGmailHealth = async () => {
    setCheckingGmail(true)
    try {
      const [healthRes, statsRes] = await Promise.all([
        api.get('/admin/gmail/health'),
        api.get('/developer/stats').catch(() => null),
      ])
      setGmailHealth(healthRes.data)
      if (statsRes?.data) {
        setEmailServiceDetails({
          email_service: statsRes.data.email_service,
          configuration: statsRes.data.configuration,
        })
      }
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
          last_pay_date: response.data.settings.last_pay_date ? (typeof response.data.settings.last_pay_date === 'string' ? response.data.settings.last_pay_date.split('T')[0] : response.data.settings.last_pay_date) : '',
          payroll_pay_type: response.data.settings.payroll_pay_type || 'WEEKLY',
          payroll_reminder_enabled: response.data.settings.payroll_reminder_enabled !== false,
          overtime_enabled: response.data.settings.overtime_enabled,
          overtime_threshold_hours_per_week: response.data.settings.overtime_threshold_hours_per_week,
          overtime_multiplier_default: response.data.settings.overtime_multiplier_default.toString(),
          rounding_policy: response.data.settings.rounding_policy as 'none' | '5' | '6' | '10' | '15' | '30',
          breaks_paid: response.data.settings.breaks_paid ?? false,
          schedule_day_start_hour: response.data.settings.schedule_day_start_hour ?? 7,
          schedule_day_end_hour: response.data.settings.schedule_day_end_hour ?? 7,
          auto_clock_out_enabled: response.data.settings.auto_clock_out_enabled ?? true,
          auto_clock_out_grace_hours: Math.min(
            12,
            Math.max(
              0,
              Math.round((response.data.settings.auto_clock_out_grace_minutes ?? 0) / 60)
            )
          ),
          punch_allowed_roles:
            response.data.settings.punch_allowed_roles ?? [...DEFAULT_PUNCH_ALLOWED_ROLES],
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
        const items = response.data.settings.marketplace_items ?? []
        setMarketplaceItems(items)
        resetMarketplace({
          marketplace_enabled:
            response.data.settings.marketplace_enabled ?? items.length > 0,
        })
        resetGeofence({
          geofence_enabled: response.data.settings.geofence_enabled ?? false,
          office_latitude: response.data.settings.office_latitude ?? undefined,
          office_longitude: response.data.settings.office_longitude ?? undefined,
          geofence_radius_meters: response.data.settings.geofence_radius_meters ?? 100,
        })
        const marketplaceOn =
          response.data.settings.marketplace_enabled ?? items.length > 0
        setKioskEnabled(
          Boolean(response.data.kiosk_enabled) || Boolean(marketplaceOn),
        )
        setKioskNetworkRestrictionEnabled(response.data.settings.kiosk_network_restriction_enabled ?? false)
        setKioskAllowedIpsText((response.data.settings.kiosk_allowed_ips || []).join('\n'))
        setKioskAllowedRoles(
          response.data.settings.kiosk_allowed_roles ?? [...DEFAULT_KIOSK_ALLOWED_ROLES],
        )
        
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
        last_pay_date: data.last_pay_date || null,
        payroll_pay_type: data.payroll_pay_type || 'WEEKLY',
        payroll_reminder_enabled: data.payroll_reminder_enabled !== false,
        overtime_enabled: data.overtime_enabled,
        overtime_threshold_hours_per_week: data.overtime_threshold_hours_per_week,
        overtime_multiplier_default: parseFloat(data.overtime_multiplier_default),
        rounding_policy: data.rounding_policy,
        breaks_paid: data.breaks_paid,
        schedule_day_start_hour: data.schedule_day_start_hour,
        schedule_day_end_hour: data.schedule_day_end_hour,
        auto_clock_out_enabled: data.auto_clock_out_enabled,
        auto_clock_out_grace_minutes: data.auto_clock_out_grace_hours * 60,
        punch_allowed_roles: data.punch_allowed_roles || [],
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
          last_pay_date: response.data.settings.last_pay_date ? (typeof response.data.settings.last_pay_date === 'string' ? response.data.settings.last_pay_date.split('T')[0] : response.data.settings.last_pay_date) : '',
          payroll_pay_type: response.data.settings.payroll_pay_type || 'WEEKLY',
          payroll_reminder_enabled: response.data.settings.payroll_reminder_enabled !== false,
          overtime_enabled: response.data.settings.overtime_enabled,
          overtime_threshold_hours_per_week: response.data.settings.overtime_threshold_hours_per_week,
          overtime_multiplier_default: response.data.settings.overtime_multiplier_default.toString(),
          rounding_policy: response.data.settings.rounding_policy as 'none' | '5' | '6' | '10' | '15' | '30',
          breaks_paid: response.data.settings.breaks_paid ?? false,
          schedule_day_start_hour: response.data.settings.schedule_day_start_hour ?? 7,
          schedule_day_end_hour: response.data.settings.schedule_day_end_hour ?? 7,
          auto_clock_out_enabled: response.data.settings.auto_clock_out_enabled ?? true,
          auto_clock_out_grace_hours: Math.min(
            12,
            Math.max(
              0,
              Math.round((response.data.settings.auto_clock_out_grace_minutes ?? 0) / 60)
            )
          ),
          punch_allowed_roles:
            response.data.settings.punch_allowed_roles ?? [...DEFAULT_PUNCH_ALLOWED_ROLES],
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

  const onSubmitMarketplace = async (data: MarketplaceSettingsForm) => {
    setSaving(true)
    try {
      if (data.marketplace_enabled) {
        const blankLabels = marketplaceItems.some((i) => !i.label.trim())
        if (blankLabels) {
          toast.error('Each marketplace item needs a label before saving.')
          setSaving(false)
          return
        }
      }
      const updateData: Record<string, unknown> = {
        marketplace_enabled: data.marketplace_enabled,
        marketplace_items: marketplaceItems.map((i) => ({
          id: i.id,
          label: i.label.trim(),
          price_cents: Math.max(0, Math.round(Number(i.price_cents) || 0)),
        })),
      }
      // Keep the PIN pad on for Housekeeping and other roles. Front Desk is
      // blocked from kiosk in punch logic while marketplace is on.
      if (data.marketplace_enabled) {
        updateData.kiosk_enabled = true
      }
      const response = await api.put('/admin/company/settings', updateData)
      setCompanyInfo(response.data)
      setKioskEnabled(response.data.kiosk_enabled ?? true)
      const items = response.data.settings.marketplace_items ?? []
      setMarketplaceItems(items)
      resetMarketplace({
        marketplace_enabled:
          response.data.settings.marketplace_enabled ?? items.length > 0,
      })
      if (data.marketplace_enabled) {
        toast.success(
          'Marketplace enabled. Front Desk must punch via portal. Other roles can still use the kiosk.'
        )
      } else {
        toast.success('Marketplace settings updated successfully!')
      }
    } catch (error: any) {
      logger.error('Failed to update marketplace settings', error as Error, {
        endpoint: '/admin/company/settings',
        errorDetails: error.response?.data,
      })
      toast.error(error.response?.data?.detail || 'Failed to update marketplace settings')
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
        kiosk_allowed_roles: kioskAllowedRoles,
        kiosk_enabled: kioskEnabled,
      })
      setCompanyInfo(response.data)
      setKioskEnabled(response.data.kiosk_enabled ?? true)
      setKioskNetworkRestrictionEnabled(response.data.settings.kiosk_network_restriction_enabled ?? false)
      setKioskAllowedIpsText((response.data.settings.kiosk_allowed_ips || []).join('\n'))
      setKioskAllowedRoles(
        response.data.settings.kiosk_allowed_roles ?? [...DEFAULT_KIOSK_ALLOWED_ROLES],
      )
      toast.success('Kiosk settings updated successfully!')
    } catch (error: any) {
      logger.error('Failed to update kiosk settings', error as Error)
      toast.error(error.response?.data?.detail || 'Failed to update kiosk settings')
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

  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab)
    router.replace(`/settings?tab=${tab}`, { scroll: false })
  }

  const adminTabs: { id: SettingsTab; label: string }[] = [
    { id: 'info', label: 'Company' },
    { id: 'payroll', label: 'General' },
    { id: 'cash', label: 'Cash Drawer' },
    { id: 'marketplace', label: 'Marketplace' },
    { id: 'location', label: 'Location' },
    { id: 'kiosk', label: 'Kiosk' },
    { id: 'roles', label: 'Roles' },
  ]

  if (loading) {
    return (
      <Layout>
        <div className="relative mx-auto max-w-6xl py-16">
          <div className="space-y-3">
            <div className="h-40 animate-pulse rounded-2xl bg-slate-200/80" />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
            <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        </div>
      </Layout>
    )
  }

  if (!companyInfo && user?.role === 'ADMIN') {
    return (
      <Layout>
        <div className="relative mx-auto max-w-6xl py-16">
          <div className="rounded-2xl border border-slate-200/80 bg-white px-6 py-12 text-center shadow-sm">
            <p className="text-sm text-slate-500">Company information not found</p>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="relative mx-auto max-w-6xl">
        <PageAtmosphere />

        <div className="relative space-y-6 pb-8">
          <header className="overflow-hidden rounded-2xl border border-slate-800/10 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.45)]">
            <div className="relative bg-slate-900 px-5 py-6 sm:px-7 sm:py-8 text-white">
              <div
                aria-hidden
                className="absolute inset-0 opacity-40"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 12% 20%, rgba(45,212,191,0.28), transparent 42%), radial-gradient(circle at 88% 10%, rgba(59,130,246,0.22), transparent 36%)',
                }}
              />
              <div
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
              />
              <div className="relative min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {user?.role === 'DEVELOPER' ? 'Developer tools' : 'Administration'}
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {user?.role === 'DEVELOPER' ? 'Email Service' : 'Company Settings'}
                </h1>
                {user?.role === 'ADMIN' && companyInfo && (
                  <>
                    <p className="mt-2 max-w-xl text-sm text-slate-300">{companyInfo.name}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-lg bg-white/10 px-2.5 py-1 text-xs font-medium text-slate-200 ring-1 ring-white/10">
                        {companyInfo.slug}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ${
                          companyInfo.kiosk_enabled
                            ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/30'
                            : 'bg-amber-500/20 text-amber-200 ring-amber-400/30'
                        }`}
                      >
                        Kiosk {companyInfo.kiosk_enabled ? 'enabled' : 'disabled'}
                      </span>
                    </div>
                  </>
                )}
                {user?.role === 'DEVELOPER' && (
                  <p className="mt-2 max-w-xl text-sm text-slate-300">
                    Manage Gmail API authentication for sending verification emails.
                  </p>
                )}
              </div>
            </div>
          </header>

          {user?.role === 'ADMIN' && companyInfo && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Timezone"
                value={companyInfo.settings.timezone.replace(/_/g, ' ')}
                hint="Payroll & schedules"
              />
              <StatCard
                label="Overtime"
                value={companyInfo.settings.overtime_enabled ? 'On' : 'Off'}
                hint={
                  companyInfo.settings.overtime_enabled
                    ? `${companyInfo.settings.overtime_threshold_hours_per_week}h threshold`
                    : 'Not configured'
                }
              />
              <StatCard
                label="Cash drawer"
                value={companyInfo.settings.cash_drawer_enabled ? 'On' : 'Off'}
                hint={companyInfo.settings.cash_drawer_enabled ? 'Active' : 'Disabled'}
              />
              <StatCard
                label="Kiosk"
                value={companyInfo.kiosk_enabled ? 'Enabled' : 'Disabled'}
                hint={companyInfo.slug}
              />
            </div>
          )}

          {user?.role === 'ADMIN' && (
            <div className="-mx-1 overflow-x-auto pb-1">
              <nav className="flex min-w-max gap-2 px-1">
                {adminTabs.map((tab) => {
                  const active = activeTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => handleTabChange(tab.id)}
                      className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                        active
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  )
                })}
              </nav>
            </div>
          )}

        {/* Company Information Tab - Admin Only */}
        {activeTab === 'info' && user?.role === 'ADMIN' && (
          <div className="space-y-6">
            {/* Kiosk URL Section */}
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
                <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  Kiosk URL
                  <InfoTip
                    label="Kiosk URL"
                    content="Share this unique link with employees for clock-in/clock-out on a shared tablet or station."
                  />
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Share this URL with your employees for clock-in/clock-out. This URL is unique to your company.
                </p>
              </div>
              <div className="space-y-3 px-5 py-5 sm:px-6">
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    readOnly
                    value={kioskUrl}
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-mono text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
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
                    className="shrink-0 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
                  >
                    Copy URL
                  </button>
                </div>
                {companyInfo && !companyInfo.kiosk_enabled && (
                  <p className="text-sm font-medium text-amber-700">
                    Warning: Kiosk is currently disabled for your company.
                  </p>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <SectionTitle as="h2" tip="Basic company identity and primary administrator contact details.">
                Company Information
              </SectionTitle>
              {companyInfo ? (
              <form onSubmit={handleSubmitName(onSubmitName)} className="space-y-6 px-5 py-5 sm:px-6">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Company Name
                </label>
                <input
                  {...registerName('name')}
                  type="text"
                  className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
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
                  className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Created At</label>
                <input
                  type="text"
                  value={new Date(companyInfo.created_at).toLocaleString()}
                  disabled
                  className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500 cursor-not-allowed"
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
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500 cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700">Admin Email</label>
                    <input
                      type="text"
                      value={companyInfo.admin.email}
                      disabled
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500 cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700">Admin ID</label>
                    <input
                      type="text"
                      value={companyInfo.admin.id}
                      disabled
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500 cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700">Account Created At</label>
                    <input
                      type="text"
                      value={new Date(companyInfo.admin.created_at).toLocaleString()}
                      disabled
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500 cursor-not-allowed"
                    />
                  </div>

                  {companyInfo.admin.last_login_at && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700">Last Login</label>
                      <input
                        type="text"
                        value={new Date(companyInfo.admin.last_login_at).toLocaleString()}
                        disabled
                        className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500 cursor-not-allowed"
                      />
                    </div>
                  )}
                </>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
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
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
                <h2 className="text-sm font-semibold text-slate-900">Gmail API Configuration</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Manage Gmail API authentication for sending verification emails. The refresh token expires after 6 months of non-use.
                </p>
              </div>
              <div className="px-5 py-5 sm:px-6">

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
                      <li><strong>Critical:</strong> Click the Settings icon and check &quot;Use your own OAuth credentials&quot;</li>
                      <li>Enter your Client ID and Client Secret from Google Cloud Console</li>
                      <li>Select &quot;Gmail API v1&quot; → &quot;https://www.googleapis.com/auth/gmail.send&quot;</li>
                      <li>Click &quot;Authorize APIs&quot; and complete OAuth flow</li>
                      <li>Click &quot;Exchange authorization code for tokens&quot;</li>
                      <li>Copy the &quot;Refresh token&quot; from the response</li>
                      <li>Use the token update form below to update your token</li>
                    </ol>
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
                      <p className="text-xs text-red-800 font-medium">
                        <strong>Important:</strong> If you use default Playground credentials (don&apos;t configure your own), the refresh token will expire in 24 hours. Always use your own OAuth credentials for long-lived tokens.
                      </p>
                    </div>
                    <p className="text-xs text-yellow-700">
                      See <code className="bg-yellow-100 px-1 rounded">server/GMAIL_SETUP_PLAYGROUND.md</code> for detailed instructions.
                    </p>
                  </div>
                )}
              </div>

              {/* Detailed email service + config (moved from Developer Portal) */}
              {(emailServiceDetails?.email_service || emailServiceDetails?.configuration) && (
                <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {emailServiceDetails.email_service && (
                    <div className="border border-slate-200 rounded-lg p-4">
                      <h3 className="text-sm font-semibold text-slate-900 mb-3">Email Service Status</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="text-slate-600">Initialized</span>
                          <span className="font-medium">{emailServiceDetails.email_service.initialized ? 'Yes' : 'No'}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-slate-600">Has Credentials</span>
                          <span className="font-medium">{emailServiceDetails.email_service.has_credentials ? 'Yes' : 'No'}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-slate-600">Operational</span>
                          <span className="font-medium">{emailServiceDetails.email_service.operational ? 'Yes' : 'No'}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-slate-600">Sender Email</span>
                          <span className="font-medium">{emailServiceDetails.email_service.sender_email || 'N/A'}</span>
                        </div>
                        {emailServiceDetails.email_service.token_valid !== undefined && (
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-600">Token Valid</span>
                            <span className="font-medium">{emailServiceDetails.email_service.token_valid ? 'Yes' : 'No'}</span>
                          </div>
                        )}
                        {emailServiceDetails.email_service.token_expired !== undefined && (
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-600">Token Expired</span>
                            <span className="font-medium">{emailServiceDetails.email_service.token_expired ? 'Yes' : 'No'}</span>
                          </div>
                        )}
                        {emailServiceDetails.email_service.has_refresh_token !== undefined && (
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-600">Has Refresh Token</span>
                            <span className="font-medium">{emailServiceDetails.email_service.has_refresh_token ? 'Yes' : 'No'}</span>
                          </div>
                        )}
                        {emailServiceDetails.email_service.token_expires_at && (
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-600">Token Expires At</span>
                            <span className="font-medium text-xs">{new Date(emailServiceDetails.email_service.token_expires_at).toLocaleString()}</span>
                          </div>
                        )}
                        {emailServiceDetails.email_service.token_expires_in_hours !== undefined && (
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-600">Token Expires In</span>
                            <span className="font-medium">{Number(emailServiceDetails.email_service.token_expires_in_hours).toFixed(1)} hours</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {emailServiceDetails.configuration && (
                    <div className="border border-slate-200 rounded-lg p-4">
                      <h3 className="text-sm font-semibold text-slate-900 mb-3">Gmail Configuration</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="text-slate-600">Credentials Configured</span>
                          <span className="font-medium">{emailServiceDetails.configuration.gmail_credentials_configured ? 'Yes' : 'No'}</span>
                        </div>
                        {emailServiceDetails.configuration.gmail_credentials_source && (
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-500 text-xs">Credentials source</span>
                            <span className="font-medium text-xs capitalize">{emailServiceDetails.configuration.gmail_credentials_source}</span>
                          </div>
                        )}
                        <div className="flex justify-between gap-3">
                          <span className="text-slate-600">Token Configured</span>
                          <span className="font-medium">{emailServiceDetails.configuration.gmail_token_configured ? 'Yes' : 'No'}</span>
                        </div>
                        {emailServiceDetails.configuration.gmail_token_source && (
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-500 text-xs">Token source</span>
                            <span className="font-medium text-xs capitalize">{emailServiceDetails.configuration.gmail_token_source}</span>
                          </div>
                        )}
                        {emailServiceDetails.configuration.email_configured !== undefined && (
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-600">Email Configured</span>
                            <span className="font-medium">{emailServiceDetails.configuration.email_configured ? 'Yes' : 'No'}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

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
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                      placeholder='{"refresh_token": "...", "client_id": "...", "client_secret": "...", "token_uri": "https://oauth2.googleapis.com/token", "scopes": ["https://www.googleapis.com/auth/gmail.send"]}'
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Paste the complete token JSON object from Google OAuth 2.0 Playground
                    </p>
                  </div>
                  <button
                    type="submit"
                    className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  >
                    Update Token
                  </button>
                </form>
              </div>

              {/* Test Email */}
              <div className="border-t border-slate-100 pt-6 mt-6">
                <h3 className="text-sm font-semibold text-slate-900 mb-4">Test Email Sending</h3>
                <p className="text-sm text-slate-600 mb-4">
                  Send a test email to verify Gmail API is working correctly.
                </p>
                <button
                  onClick={handleTestGmail}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                >
                  Send Test Email
                </button>
              </div>
              </div>
            </div>
          </div>
        )}

        {/* General Settings Tab - Admin Only */}
        {activeTab === 'payroll' && user?.role === 'ADMIN' && (
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <SectionTitle
              as="h2"
              tip="Timezone, overtime, rounding, breaks, punch access, auto clock-out, and schedule day hours. These affect time tracking and payroll."
            >
              General Settings
            </SectionTitle>
            <form onSubmit={handleSubmitSettings(onSubmitSettings)} className="space-y-6 px-5 py-5 sm:px-6">
              <div>
                <label className="block">
                  <FieldLabel tip="Used for schedules, punches, payroll periods, and auto clock-out times.">
                    Timezone
                  </FieldLabel>
                </label>
                <Controller
                  name="timezone"
                  control={controlSettings}
                  render={({ field }) => (
                    <select
                      {...field}
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                    >
                      {timezones.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  )}
                />
                {settingsErrors.timezone && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.timezone.message}</p>
                )}
              </div>

              <div>
                <label className="block">
                  <FieldLabel tip="First day of each payroll week (e.g. Monday). Weekly overtime and pay periods use this.">
                    Payroll Week Start Day
                  </FieldLabel>
                </label>
                <Controller
                  name="payroll_week_start_day"
                  control={controlSettings}
                  render={({ field }) => (
                    <select
                      {...field}
                      value={field.value}
                      onChange={(e) => field.onChange(parseInt(e.target.value))}
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                    >
                      {weekDays.map((day) => (
                        <option key={day.value} value={day.value}>
                          {day.label}
                        </option>
                      ))}
                    </select>
                  )}
                />
                {settingsErrors.payroll_week_start_day && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.payroll_week_start_day.message}</p>
                )}
              </div>

              <div>
                <label className="block">
                  <FieldLabel tip="Starting date for biweekly payroll periods. Leave empty for flexible biweekly periods.">
                    Biweekly Anchor Date (Optional)
                  </FieldLabel>
                </label>
                <Controller
                  name="biweekly_anchor_date"
                  control={controlSettings}
                  render={({ field }) => (
                    <input
                      type="date"
                      value={field.value || ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                      onBlur={field.onBlur}
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                    />
                  )}
                />
                {settingsErrors.biweekly_anchor_date && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.biweekly_anchor_date.message}</p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-4">
                <div>
                  <SectionTitle tip="Pay date is when payroll is issued. The pay period is the prior week (or two weeks if biweekly), based on your week-start day — for example, pay date Aug 14 → period Aug 3–9 when the week starts Monday.">
                    Pay schedule
                  </SectionTitle>
                  <p className="text-xs text-slate-500 mt-1">
                    Generation opens 4 days before payday. Admins get an in-app reminder and email.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block">
                      <FieldLabel tip="The most recent payday (issue date), not the end of the work period. Next payday rolls forward weekly or biweekly from this.">
                        Last pay date
                      </FieldLabel>
                    </label>
                    <Controller
                      name="last_pay_date"
                      control={controlSettings}
                      render={({ field }) => (
                        <input
                          type="date"
                          value={field.value || ''}
                          onChange={(e) => field.onChange(e.target.value || null)}
                          onBlur={field.onBlur}
                          className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                        />
                      )}
                    />
                  </div>
                  <div>
                    <label className="block">
                      <FieldLabel tip="How often payday repeats after the last pay date.">
                        Payroll type
                      </FieldLabel>
                    </label>
                    <Controller
                      name="payroll_pay_type"
                      control={controlSettings}
                      render={({ field }) => (
                        <select
                          value={field.value || 'WEEKLY'}
                          onChange={(e) => field.onChange(e.target.value)}
                          onBlur={field.onBlur}
                          className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                        >
                          <option value="WEEKLY">Weekly</option>
                          <option value="BIWEEKLY">Biweekly</option>
                        </select>
                      )}
                    />
                  </div>
                </div>
                <Controller
                  name="payroll_reminder_enabled"
                  control={controlSettings}
                  render={({ field }) => (
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={field.value !== false}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                      />
                      Email admins when generation opens (4 days before payday)
                    </label>
                  )}
                />
              </div>

              <div>
                <Controller
                  name="overtime_enabled"
                  control={controlSettings}
                  render={({ field }) => (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                      />
                      <span className="ml-1 text-sm text-slate-700">Enable Overtime Calculation</span>
                      <InfoTip
                        label="Enable Overtime"
                        content="When enabled, hours over the weekly threshold are paid at the overtime multiplier."
                      />
                    </label>
                  )}
                />
              </div>

              <div>
                <label className="block">
                  <FieldLabel tip="Hours worked per week before overtime applies (usually 40).">
                    Overtime Threshold (Hours per Week)
                  </FieldLabel>
                </label>
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
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                    />
                  )}
                />
                {settingsErrors.overtime_threshold_hours_per_week && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.overtime_threshold_hours_per_week.message}</p>
                )}
              </div>

              <div>
                <label className="block">
                  <FieldLabel tip="Pay rate multiplier for overtime hours (e.g. 1.5 = time and a half).">
                    Default Overtime Multiplier
                  </FieldLabel>
                </label>
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
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                    />
                  )}
                />
                {settingsErrors.overtime_multiplier_default && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.overtime_multiplier_default.message}</p>
                )}
              </div>

              <div>
                <label className="block">
                  <FieldLabel tip="Round punch times to the nearest interval. For 15 minutes, the 7-minute rule rounds down at ≤7 minutes into the quarter and up at ≥8.">
                    Time Rounding
                  </FieldLabel>
                </label>
                <Controller
                  name="rounding_policy"
                  control={controlSettings}
                  render={({ field }) => (
                    <select
                      {...field}
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
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
                {settingsErrors.rounding_policy && (
                  <p className="mt-1 text-sm text-red-600">{settingsErrors.rounding_policy.message}</p>
                )}
              </div>

              <div>
                <Controller
                  name="breaks_paid"
                  control={controlSettings}
                  render={({ field }) => (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                      />
                      <span className="ml-1 text-sm text-slate-700">Breaks are Paid</span>
                      <InfoTip
                        label="Breaks are Paid"
                        content="When enabled, break time counts toward paid hours. When off (default), breaks are deducted from hours worked."
                      />
                    </label>
                  )}
                />
              </div>

              <div className="border-t border-slate-200 pt-6">
                <SectionTitle tip="Choose which employee types can use Punch In / Out on the dashboard. Unchecked roles will not see the punch button.">
                  Punch In / Out access
                </SectionTitle>
                <Controller
                  name="punch_allowed_roles"
                  control={controlSettings}
                  render={({ field }) => (
                    <div className="space-y-2 mt-4">
                      {PUNCH_ROLE_OPTIONS.map((role) => (
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
                            className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                          />
                          <span className="ml-2 text-sm text-slate-700">{role.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                />
              </div>

              <div className="border-t border-slate-200 pt-6">
                <SectionTitle tip="If someone forgets to punch out, the system waits past their scheduled end, then clocks them out using the scheduled end time (not the later real time). Example: end 3 PM, wait 2 hours → at 5 PM they are clocked out for 3 PM.">
                  Auto clock-out
                </SectionTitle>
                <Controller
                  name="auto_clock_out_enabled"
                  control={controlSettings}
                  render={({ field }) => (
                    <label className="flex items-center gap-1.5 mt-4">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                      />
                      <span className="ml-1 text-sm text-slate-700">
                        Enable auto clock-out after scheduled shift end
                      </span>
                      <InfoTip
                        label="Enable auto clock-out"
                        content="Automatically close open punches after the schedule end plus the wait below. Cash drawers left open are flagged for review."
                      />
                    </label>
                  )}
                />
                <div className="mt-4 max-w-xs">
                  <label className="block">
                    <FieldLabel tip="How long to wait after the schedule end before auto clock-out runs. The recorded punch-out time is still the scheduled end.">
                      Wait after scheduled end
                    </FieldLabel>
                  </label>
                  <Controller
                    name="auto_clock_out_grace_hours"
                    control={controlSettings}
                    render={({ field }) => (
                      <select
                        {...field}
                        value={field.value}
                        onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                        className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                      >
                        <option value={0}>Immediately at scheduled end</option>
                        {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((h) => (
                          <option key={h} value={h}>
                            {h} hour{h === 1 ? '' : 's'} after scheduled end
                          </option>
                        ))}
                      </select>
                    )}
                  />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-6">
                <SectionTitle tip="Controls the weekly schedule timeline. Same start and end hour shows a full 24-hour day (e.g. 7 AM to 7 AM next day).">
                  Schedule View
                </SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-4">
                  <div>
                    <label className="block">
                      <FieldLabel tip="First hour shown on the schedule timeline (company schedule day start).">
                        Schedule day starts at
                      </FieldLabel>
                    </label>
                    <Controller
                      name="schedule_day_start_hour"
                      control={controlSettings}
                      render={({ field }) => (
                        <select
                          {...field}
                          value={field.value}
                          onChange={(e) => field.onChange(parseInt(e.target.value))}
                          className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
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
                    <label className="block">
                      <FieldLabel tip="Last hour of the schedule day. Same as start = 24-hour day (e.g. 7 AM–7 AM next day).">
                        Schedule day ends at
                      </FieldLabel>
                    </label>
                    <Controller
                      name="schedule_day_end_hour"
                      control={controlSettings}
                      render={({ field }) => (
                        <select
                          {...field}
                          value={field.value}
                          onChange={(e) => field.onChange(parseInt(e.target.value))}
                          className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
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
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Cash Drawer Settings Tab - Admin Only */}
        {activeTab === 'cash' && user?.role === 'ADMIN' && (
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <SectionTitle
              as="h2"
              tip="Employees enter starting and ending cash counts when clocking in/out. Variance over the threshold is flagged for review. When off, Drawer Log is hidden from navigation."
            >
              Cash Drawer Settings
            </SectionTitle>
            <form onSubmit={handleSubmitCashDrawer(onSubmitCashDrawer)} className="space-y-6 px-5 py-5 sm:px-6">
              <div>
                <Controller
                  name="cash_drawer_enabled"
                  control={controlCashDrawer}
                  render={({ field }) => (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                      />
                      <span className="ml-1 text-sm text-slate-700">Enable Cash Drawer Management</span>
                      <InfoTip
                        label="Enable Cash Drawer"
                        content="When enabled, employees enter cash counts when clocking in and out, and Drawer Log appears under Logs."
                      />
                    </label>
                  )}
                />
              </div>

              <div>
                <Controller
                  name="cash_drawer_required_for_all"
                  control={controlCashDrawer}
                  render={({ field }) => (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        disabled={!cashDrawerEnabled}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20 disabled:opacity-50"
                      />
                      <span className="ml-1 text-sm text-slate-700">Require Cash Drawer for All Employees</span>
                      <InfoTip
                        label="Require for all"
                        content="When on, every employee must enter cash counts. When off, only the selected roles below are required."
                      />
                    </label>
                  )}
                />
              </div>

              <div>
                <label className="block">
                  <FieldLabel tip="Roles that must enter cash counts when “Require for All” is off.">
                    Required Roles
                  </FieldLabel>
                </label>
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
                            className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20 disabled:opacity-50"
                          />
                          <span className="ml-2 text-sm text-slate-700">{role.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                />
              </div>

              <div>
                <label className="block">
                  <FieldLabel tip="Currency used for cash drawer amounts and reports.">
                    Currency
                  </FieldLabel>
                </label>
                <Controller
                  name="cash_drawer_currency"
                  control={controlCashDrawer}
                  render={({ field }) => (
                    <select
                      {...field}
                      disabled={!cashDrawerEnabled}
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 disabled:opacity-50"
                    >
                      <option value="USD">USD - US Dollar</option>
                      <option value="EUR">EUR - Euro</option>
                      <option value="GBP">GBP - British Pound</option>
                      <option value="CAD">CAD - Canadian Dollar</option>
                      <option value="AUD">AUD - Australian Dollar</option>
                    </select>
                  )}
                />
                {cashDrawerErrors.cash_drawer_currency && (
                  <p className="mt-1 text-sm text-red-600">{cashDrawerErrors.cash_drawer_currency.message}</p>
                )}
              </div>

              <div>
                <label className="block">
                  <FieldLabel tip="Default starting cash amount. Can be used as a reference or pre-filled value when employees clock in.">
                    Starting Cash Count ($)
                  </FieldLabel>
                </label>
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
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 disabled:opacity-50"
                    />
                  )}
                />
                {cashDrawerErrors.cash_drawer_starting_amount_cents && (
                  <p className="mt-1 text-sm text-red-600">{cashDrawerErrors.cash_drawer_starting_amount_cents.message}</p>
                )}
              </div>

              <div>
                <label className="block">
                  <FieldLabel tip="Used when “Require Manager Review” is on. If |counted − expected| exceeds this amount, the session is flagged for review in Drawer Log. Within the threshold, the session closes normally (delta is still recorded).">
                    Variance Threshold ($)
                  </FieldLabel>
                </label>
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
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 disabled:opacity-50"
                    />
                  )}
                />
                {cashDrawerErrors.cash_drawer_variance_threshold_cents && (
                  <p className="mt-1 text-sm text-red-600">{cashDrawerErrors.cash_drawer_variance_threshold_cents.message}</p>
                )}
              </div>

              <div>
                <Controller
                  name="cash_drawer_allow_edit"
                  control={controlCashDrawer}
                  render={({ field }) => (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        disabled={!cashDrawerEnabled}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20 disabled:opacity-50"
                      />
                      <span className="ml-1 text-sm text-slate-700">Allow Editing Cash Drawer Sessions</span>
                      <InfoTip
                        label="Allow editing"
                        content="When enabled, admins can edit cash drawer amounts after the session is created."
                      />
                    </label>
                  )}
                />
              </div>

              <div>
                <Controller
                  name="cash_drawer_require_manager_review"
                  control={controlCashDrawer}
                  render={({ field }) => (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        disabled={!cashDrawerEnabled}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20 disabled:opacity-50"
                      />
                      <span className="ml-1 text-sm text-slate-700">Require Manager Review for Variances</span>
                      <InfoTip
                        label="Manager review"
                        content="When enabled, clock-out sessions whose |delta| exceeds the variance threshold are marked Review Needed until verified in Drawer Log. When off, sessions close normally and delta is still shown."
                      />
                    </label>
                  )}
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Marketplace Settings Tab - Admin Only */}
        {activeTab === 'marketplace' && user?.role === 'ADMIN' && (
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <SectionTitle
              as="h2"
              tip="Front Desk tap-to-count products and cash/card sales on the dashboard. Requires Cash Drawer to be enabled for the shift."
            >
              Marketplace Settings
            </SectionTitle>
            <form
              onSubmit={handleSubmitMarketplace(onSubmitMarketplace)}
              className="space-y-6 px-5 py-5 sm:px-6"
            >
              <div>
                <Controller
                  name="marketplace_enabled"
                  control={controlMarketplace}
                  render={({ field }) => (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                      />
                      <span className="ml-1 text-sm text-slate-700">Enable Marketplace</span>
                      <InfoTip
                        label="Enable Marketplace"
                        content="When enabled, Front Desk can build a cart and take cash/card payment for marketplace items while clocked in with the cash drawer."
                      />
                    </label>
                  )}
                />
                {marketplaceEnabled && !cashDrawerEnabled && (
                  <p
                    role="alert"
                    className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
                  >
                    Cash drawer required. Enable Cash Drawer in Settings before marketplace
                    sales can run — Front Desk needs an open drawer to take payments.
                  </p>
                )}
                {marketplaceEnabled && (
                  <div
                    role="alert"
                    className="mt-3 space-y-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100"
                  >
                    <p>
                      <span className="font-semibold">Front Desk portal only.</span> While
                      Marketplace is on, Front Desk cannot punch at the kiosk — they must log
                      in and punch from the dashboard so cart and drawer stay on one device.
                    </p>
                    <p className="text-sky-900/80 dark:text-sky-200/80">
                      Housekeeping and other roles can still use the kiosk. Choose who on the
                      Kiosk tab. Saving Marketplace turns the company kiosk back on if it was
                      off.
                    </p>
                  </div>
                )}
              </div>

              <div className={!marketplaceEnabled ? 'pointer-events-none opacity-50' : ''}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    Marketplace items
                    <InfoTip
                      label="Marketplace items"
                      content="Products shown as tap buttons on the Front Desk dashboard. Prices are used for cart totals and sales."
                    />
                  </span>
                  <button
                    type="button"
                    disabled={!marketplaceEnabled}
                    onClick={() =>
                      setMarketplaceItems((prev) => [
                        ...prev,
                        {
                          id:
                            typeof crypto !== 'undefined' && crypto.randomUUID
                              ? crypto.randomUUID()
                              : `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                          label: '',
                          price_cents: 0,
                        },
                      ])
                    }
                    className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:!bg-transparent dark:text-foreground-muted dark:hover:!bg-white/[0.04]"
                  >
                    Add item
                  </button>
                </div>
                {marketplaceItems.length === 0 ? (
                  <p className="text-sm italic text-slate-500">
                    No marketplace items configured. Add items and save — Front Desk will see
                    them on the dashboard while clocked in.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {marketplaceItems.map((item, idx) => (
                      <li
                        key={item.id}
                        className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3"
                      >
                        <div className="flex-1">
                          <label className="mb-1 block text-xs font-medium text-slate-600">
                            Label
                          </label>
                          <input
                            type="text"
                            value={item.label}
                            disabled={!marketplaceEnabled}
                            onChange={(e) => {
                              const label = e.target.value
                              setMarketplaceItems((prev) =>
                                prev.map((row, i) => (i === idx ? { ...row, label } : row))
                              )
                            }}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 disabled:opacity-50"
                            placeholder="e.g. Water"
                            maxLength={100}
                          />
                        </div>
                        <div className="w-full sm:w-36">
                          <label className="mb-1 block text-xs font-medium text-slate-600">
                            Price ($)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            disabled={!marketplaceEnabled}
                            value={(item.price_cents / 100).toFixed(2)}
                            onChange={(e) => {
                              const dollars = parseFloat(e.target.value)
                              const price_cents = Number.isFinite(dollars)
                                ? Math.max(0, Math.round(dollars * 100))
                                : 0
                              setMarketplaceItems((prev) =>
                                prev.map((row, i) => (i === idx ? { ...row, price_cents } : row))
                              )
                            }}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 disabled:opacity-50"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={!marketplaceEnabled}
                          onClick={() =>
                            setMarketplaceItems((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Punch Location (Geofence) Tab - Admin Only */}
        {activeTab === 'location' && user?.role === 'ADMIN' && (
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <SectionTitle
              as="h2"
              tip="Require employees to be at the office to punch. Punches are only accepted when the device is within the radius of the office location."
            >
              Punch Location
            </SectionTitle>
            <form onSubmit={handleSubmitGeofence(onSubmitGeofence)} className="space-y-6 px-5 py-5 sm:px-6">
              <div>
                <Controller
                  name="geofence_enabled"
                  control={controlGeofence}
                  render={({ field }) => (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                      />
                      <span className="ml-1 text-sm text-slate-700">Require punch at office location</span>
                      <InfoTip
                        label="Require punch at office"
                        content="When enabled, employees must be within the radius below to clock in or out."
                      />
                    </label>
                  )}
                />
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
                  className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                >
                  {geofenceGettingLocation ? 'Getting location…' : 'Use current location'}
                </button>
                {typeof navigator !== 'undefined' && !navigator.geolocation && (
                  <span className="text-xs text-slate-500">Location not available in this browser</span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block">
                    <FieldLabel tip="Office latitude (−90 to 90). Use “Use current location” to fill from this device.">
                      Office latitude
                    </FieldLabel>
                  </label>
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
                        className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                      />
                    )}
                  />
                  {geofenceErrors.office_latitude && (
                    <p className="mt-1 text-sm text-red-600">{geofenceErrors.office_latitude.message}</p>
                  )}
                </div>
                <div>
                  <label className="block">
                    <FieldLabel tip="Office longitude (−180 to 180).">
                      Office longitude
                    </FieldLabel>
                  </label>
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
                        className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                      />
                    )}
                  />
                  {geofenceErrors.office_longitude && (
                    <p className="mt-1 text-sm text-red-600">{geofenceErrors.office_longitude.message}</p>
                  )}
                </div>
              </div>
              <div>
                <label className="block">
                  <FieldLabel tip="Employees must be within this distance of the office to punch (10–5000 meters).">
                    Allowed radius (meters)
                  </FieldLabel>
                </label>
                <Controller
                  name="geofence_radius_meters"
                  control={controlGeofence}
                  render={({ field }) => (
                    <input
                      {...field}
                      type="number"
                      min={10}
                      max={5000}
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                    />
                  )}
                />
                {geofenceErrors.geofence_radius_meters && (
                  <p className="mt-1 text-sm text-red-600">{geofenceErrors.geofence_radius_meters.message}</p>
                )}
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Kiosk Tab - Admin Only */}
        {activeTab === 'kiosk' && user?.role === 'ADMIN' && (
          <div className="space-y-6">
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <SectionTitle
                as="h2"
                tip="Turn the shared PIN pad on or off for the company. When Marketplace is on, Front Desk is blocked even if the kiosk is on."
              >
                Company kiosk
              </SectionTitle>
              <div className="space-y-3 px-5 py-5 sm:px-6">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={kioskEnabled}
                    onChange={(e) => setKioskEnabled(e.target.checked)}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                  />
                  <span className="text-sm font-medium text-slate-700">Enable company kiosk</span>
                </label>
                {companyInfo && !companyInfo.kiosk_enabled && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    The PIN pad is currently off for everyone, so role settings below have no
                    effect. Enable it and save so Housekeeping and other roles can punch.
                    {companyInfo.settings?.marketplace_enabled
                      ? ' Front Desk will still be blocked while Marketplace is on.'
                      : ''}
                  </p>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <SectionTitle
                as="h2"
                tip="Choose which employee types can clock in/out on the company kiosk PIN pad. Unchecked roles are blocked at the kiosk."
              >
                Kiosk access by role
              </SectionTitle>
              <div className="space-y-2 px-5 py-5 sm:px-6">
                {PUNCH_ROLE_OPTIONS.map((role) => (
                  <label key={role.value} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={kioskAllowedRoles.includes(role.value)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setKioskAllowedRoles((prev) =>
                            prev.includes(role.value) ? prev : [...prev, role.value],
                          )
                        } else {
                          setKioskAllowedRoles((prev) => prev.filter((r) => r !== role.value))
                        }
                      }}
                      className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                    />
                    <span className="ml-2 text-sm text-slate-700">{role.label}</span>
                  </label>
                ))}
                {companyInfo?.settings?.marketplace_enabled && (
                  <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Marketplace is enabled: Front Desk cannot use the kiosk even if checked above
                    (portal punch only).
                  </p>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <SectionTitle
                as="h2"
                tip="Restrict the kiosk so it only works on the office network. Requests from other IPs are blocked."
              >
                Kiosk Network
              </SectionTitle>
              <div className="space-y-6 px-5 py-5 sm:px-6">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={kioskNetworkRestrictionEnabled}
                    onChange={(e) => setKioskNetworkRestrictionEnabled(e.target.checked)}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                  />
                  <span className="text-sm font-medium text-slate-700">Restrict kiosk to office network only</span>
                  <InfoTip
                    label="Restrict kiosk network"
                    content="When enabled, the kiosk page and clock-in/out only work from the IPs or CIDR ranges listed below."
                  />
                </label>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block">
                      <FieldLabel tip="One IP or CIDR range per line (e.g. 203.0.113.10 or 203.0.113.0/24). Use “Add my current IP” while on the office network.">
                        Allowed IPs or CIDR ranges (one per line)
                      </FieldLabel>
                    </label>
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
                      className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                    >
                      {kioskFetchingMyIp ? 'Getting…' : 'Add my current IP'}
                    </button>
                  </div>
                  <textarea
                    value={kioskAllowedIpsText}
                    onChange={(e) => setKioskAllowedIpsText(e.target.value)}
                    placeholder={'192.168.1.0/24\n10.0.0.1'}
                    rows={5}
                    className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 font-mono"
                  />
                  <p className="mt-1 text-xs text-slate-500">Examples: 192.168.1.0/24 (entire subnet), 10.0.0.1 (single IP). Use “Add my current IP” when at the office to add this device.</p>
                  <p className="mt-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">If the same IP is added from different networks, configure your reverse proxy to send the real client IP (e.g. nginx: <code className="bg-amber-100 px-1">proxy_set_header X-Real-IP $remote_addr</code>; Cloudflare uses CF-Connecting-IP automatically).</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onSubmitKioskNetwork}
                disabled={saving}
                className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'roles' && user?.role === 'ADMIN' && <RolesPermissionsTab />}

        </div>
      </div>
    </Layout>
  )
}

export default function AdminSettingsPage() {
  return (
    <Suspense
      fallback={
        <Layout>
          <div className="flex min-h-[40vh] items-center justify-center">
            <div
              className="h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
              role="status"
              aria-label="Loading settings"
            />
          </div>
        </Layout>
      }
    >
      <AdminSettingsPageInner />
    </Suspense>
  )
}
