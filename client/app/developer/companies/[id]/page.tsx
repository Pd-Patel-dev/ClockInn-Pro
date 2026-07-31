'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import api, { createUserInCompany } from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import logger from '@/lib/logger'
import BackButton from '@/components/BackButton'
import { useToast } from '@/components/Toast'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  Menu,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
  TabPanel,
  Tabs,
} from '@/components/ui'

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
  schedule_day_start_hour?: number
  schedule_day_end_hour?: number
  shift_notes_enabled?: boolean
  shift_notes_required_on_clock_out?: boolean
  shift_notes_allow_edit_after_clock_out?: boolean
  email_verification_required?: boolean
  geofence_enabled?: boolean
  office_latitude?: number | null
  office_longitude?: number | null
  geofence_radius_meters?: number
  kiosk_network_restriction_enabled?: boolean
  kiosk_allowed_ips?: string[]
}

interface CompanyInfo {
  id: string
  name: string
  slug: string
  kiosk_enabled: boolean
  created_at: string
  settings: CompanySettings
  admin?: { id: string; name: string; email: string; created_at: string; last_login_at: string | null }
}

interface CompanyUser {
  id: string
  company_id: string | null
  company_name: string
  name: string
  email: string
  role: string
  status: string
  email_verified: boolean
  verification_required: boolean
  created_at: string
  last_login_at: string | null
  has_pin: boolean
}

export default function DeveloperCompanyPage() {
  const router = useRouter()
  const params = useParams()
  const companyId = params?.id as string
  const [company, setCompany] = useState<CompanyInfo | null>(null)
  const [users, setUsers] = useState<CompanyUser[]>([])
  const [loading, setLoading] = useState(true)
  const [savingEmailVerification, setSavingEmailVerification] = useState(false)
  const [savingGeofence, setSavingGeofence] = useState(false)
  const [geofenceGettingLocation, setGeofenceGettingLocation] = useState(false)
  const [geofenceLat, setGeofenceLat] = useState('')
  const [geofenceLon, setGeofenceLon] = useState('')
  const [geofenceRadius, setGeofenceRadius] = useState(100)
  const [kioskNetworkRestrictionEnabled, setKioskNetworkRestrictionEnabled] = useState(false)
  const [kioskAllowedIpsText, setKioskAllowedIpsText] = useState('')
  const [savingKioskNetwork, setSavingKioskNetwork] = useState(false)
  const [kioskFetchingMyIp, setKioskFetchingMyIp] = useState(false)
  const [myCompanyId, setMyCompanyId] = useState<string | null>(null)
  const [deletingCompany, setDeletingCompany] = useState(false)
  const toast = useToast()
  const systemDefaultCompanyId = '00000000-0000-0000-0000-000000000000'
  const [companyTab, setCompanyTab] = useState('overview')
  const [addUserOpen, setAddUserOpen] = useState(false)
  const [addUserSubmitting, setAddUserSubmitting] = useState(false)
  const [addUserEmailError, setAddUserEmailError] = useState<string | null>(null)
  const [addUserFormError, setAddUserFormError] = useState<string | null>(null)
  const [addUserForm, setAddUserForm] = useState({
    name: '',
    email: '',
    role: 'FRONTDESK',
    password: '',
    pin: '',
    pay_rate: '',
    email_verified: true,
  })
  const [tempCredsModal, setTempCredsModal] = useState<{
    email: string
    password: string
    name: string
  } | null>(null)

  const tenantRoles = [
    'ADMIN',
    'MANAGER',
    'MAINTENANCE',
    'FRONTDESK',
    'HOUSEKEEPING',
    'RESTAURANT',
    'SECURITY',
  ]

  const COMPANY_TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users' },
    { id: 'settings', label: 'Settings' },
    { id: 'activity', label: 'Activity' },
    { id: 'danger', label: 'Danger Zone' },
  ]

  const handleDeleteCompany = async () => {
    if (!company || company.id === systemDefaultCompanyId) return
    if (
      !window.confirm(
        `Permanently delete “${company.name}” and all tenant data? This cannot be undone.`,
      )
    ) {
      return
    }
    setDeletingCompany(true)
    try {
      await api.delete(`/developer/companies/${company.id}`)
      toast.success('Company deleted.')
      router.push('/developer/companies')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      const msg = err.response?.data?.detail
      toast.error(typeof msg === 'string' ? msg : 'Failed to delete company')
      logger.error('Developer delete company failed', e as Error, { companyId: company.id })
    } finally {
      setDeletingCompany(false)
    }
  }

  const reloadUsers = async () => {
    const usersRes = await api.get(`/developer/companies/${companyId}/users`)
    setUsers(
      (Array.isArray(usersRes.data) ? usersRes.data : []).filter(
        (u: CompanyUser) => u.role !== 'DEVELOPER',
      ),
    )
  }

  const closeAddUserModal = (force = false) => {
    if (addUserSubmitting && !force) return
    setAddUserOpen(false)
    setAddUserEmailError(null)
    setAddUserFormError(null)
    setAddUserForm({
      name: '',
      email: '',
      role: 'FRONTDESK',
      password: '',
      pin: '',
      pay_rate: '',
      email_verified: true,
    })
  }

  const handleAddUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddUserEmailError(null)
    setAddUserFormError(null)
    if (addUserForm.password && addUserForm.password.length < 8) {
      setAddUserFormError('Password must be at least 8 characters')
      return
    }
    if (addUserForm.pin && !/^\d{4}$/.test(addUserForm.pin)) {
      setAddUserFormError('PIN must be exactly 4 digits')
      return
    }
    setAddUserSubmitting(true)
    try {
      const result = await createUserInCompany(companyId, {
        name: addUserForm.name.trim(),
        email: addUserForm.email.trim(),
        role: addUserForm.role,
        password: addUserForm.password.trim() || null,
        pin: addUserForm.pin.trim() || null,
        pay_rate: addUserForm.pay_rate.trim() ? Number(addUserForm.pay_rate) : null,
        email_verified: addUserForm.email_verified,
      })
      toast.success(
        result.password_setup_email_sent
          ? `User ${result.user.email} created. Password setup email sent.`
          : result.temp_password
            ? `User ${result.user.email} created.`
            : addUserForm.password.trim()
              ? `User ${result.user.email} created.`
              : `User ${result.user.email} created. Password setup email could not be sent — check Email Service.`,
      )
      const temp = result.temp_password
      const created = result.user
      closeAddUserModal(true)
      await reloadUsers()
      if (temp) {
        setTempCredsModal({
          email: created.email,
          password: temp,
          name: created.name,
        })
      }
    } catch (err: any) {
      const statusCode = err.response?.status
      const msg = err.response?.data?.detail || err.message || 'Failed to create user'
      if (statusCode === 409) {
        setAddUserEmailError('This email is already in use on the platform.')
      } else {
        setAddUserFormError(typeof msg === 'string' ? msg : 'Failed to create user')
      }
      logger.error('Developer add company user failed', err as Error, { companyId })
    } finally {
      setAddUserSubmitting(false)
    }
  }

  useEffect(() => {
    const run = async () => {
      try {
        const user = await getCurrentUser()
        setMyCompanyId(user.company_id)
        if (user.role !== 'DEVELOPER') {
          router.push('/dashboard')
          return
        }
        const [companyRes, usersRes] = await Promise.all([
          api.get(`/developer/companies/${companyId}`),
          api.get(`/developer/companies/${companyId}/users`),
        ])
        setCompany(companyRes.data)
        setUsers(
          (Array.isArray(usersRes.data) ? usersRes.data : []).filter(
            (u: CompanyUser) => u.role !== 'DEVELOPER',
          ),
        )
        const s = companyRes.data?.settings
        if (s) {
          setGeofenceLat(s.office_latitude != null ? String(s.office_latitude) : '')
          setGeofenceLon(s.office_longitude != null ? String(s.office_longitude) : '')
          setGeofenceRadius(s.geofence_radius_meters ?? 100)
          setKioskNetworkRestrictionEnabled(s.kiosk_network_restriction_enabled === true)
          setKioskAllowedIpsText((s.kiosk_allowed_ips || []).join('\n'))
        }
      } catch (e: any) {
        logger.error('Developer company fetch failed', e as Error, { companyId })
        if (e.response?.status === 404) {
          setCompany(null)
        }
      } finally {
        setLoading(false)
      }
    }
    if (companyId) run()
  }, [companyId, router])

  if (loading) {
    return (
        <div className="min-h-[40vh] flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
    )
  }

  if (!company) {
    return (
        <div className="py-4">
          <p className="text-slate-600">Company not found.</p>
          <Link href="/developer/companies" className="text-blue-600 hover:underline mt-2 inline-block">Back to companies</Link>
        </div>
    )
  }

  const s = company.settings

  return (
      <div>
        <BackButton fallbackHref="/developer/companies" className="text-sm text-accent hover:underline mb-4">
          Back to companies
        </BackButton>

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <Avatar name={company.name} size="lg" square />
            <div>
              <h1 className="text-2xl font-bold text-foreground">{company.name}</h1>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="neutral">{company.slug}</Badge>
                <Badge variant={company.kiosk_enabled ? 'success' : 'neutral'} dot>
                  Kiosk {company.kiosk_enabled ? 'enabled' : 'disabled'}
                </Badge>
              </div>
            </div>
          </div>
          <MenuRoot>
            <Menu>
              <MenuTrigger>
                <Button variant="secondary" size="sm">
                  Actions
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem
                  onClick={() => {
                    setAddUserEmailError(null)
                    setAddUserFormError(null)
                    setAddUserOpen(true)
                  }}
                >
                  Add User
                </MenuItem>
                {company.id !== systemDefaultCompanyId && (
                  <MenuItem destructive onClick={handleDeleteCompany}>
                    Delete company
                  </MenuItem>
                )}
              </MenuContent>
            </Menu>
          </MenuRoot>
        </div>

        <Tabs tabs={COMPANY_TABS} value={companyTab} onChange={setCompanyTab} className="mb-2" />

        <TabPanel id="overview" value={companyTab}>
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Company info</CardTitle>
            <CardDescription>Identifiers and primary admin</CardDescription>
          </CardHeader>
          <CardBody>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <dt className="text-sm text-slate-600">ID</dt>
              <dd className="text-sm font-medium text-slate-900">{company.id}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-600">Slug</dt>
              <dd className="text-sm font-medium text-slate-900">{company.slug}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-600">Kiosk enabled</dt>
              <dd className="text-sm font-medium">{company.kiosk_enabled ? 'Yes' : 'No'}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-600">Created</dt>
              <dd className="text-sm font-medium">{company.created_at ? new Date(company.created_at).toLocaleString() : '—'}</dd>
            </div>
            {company.admin && (
              <>
                <div>
                  <dt className="text-sm text-slate-600">Admin</dt>
                  <dd className="text-sm font-medium">{company.admin.name} ({company.admin.email})</dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-600">Admin last login</dt>
                  <dd className="text-sm font-medium">{company.admin.last_login_at ? new Date(company.admin.last_login_at).toLocaleString() : '—'}</dd>
                </div>
              </>
            )}
          </dl>
          </CardBody>
        </Card>
        </TabPanel>

        <TabPanel id="settings" value={companyTab}>
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Settings</CardTitle>
          </CardHeader>
          <CardBody>
          {/* Email verification (developer can disable per company) */}
          <div className="mb-6 pb-6 border-b border-slate-200">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-900">Require email verification</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  When off, users of this company can use the app without verifying their email.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={s.email_verification_required !== false}
                disabled={savingEmailVerification}
                onClick={async () => {
                  const next = !(s.email_verification_required !== false)
                  setSavingEmailVerification(true)
                  try {
                    const res = await api.put(`/developer/companies/${companyId}/settings`, {
                      email_verification_required: next,
                    })
                    setCompany(res.data)
                  } catch (e: any) {
                    logger.error('Update company settings failed', e as Error)
                  } finally {
                    setSavingEmailVerification(false)
                  }
                }}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${
                  s.email_verification_required !== false ? 'bg-blue-600' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                    s.email_verification_required !== false ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            {savingEmailVerification && (
              <p className="text-xs text-slate-500 mt-2">Saving…</p>
            )}
          </div>

          {/* Punch location (geofence) */}
          <div className="mb-6 pb-6 border-b border-slate-200">
            <p className="text-sm font-medium text-slate-900 mb-2">Require punch at office location</p>
            <p className="text-xs text-slate-500 mb-3">
              When on, employees can only punch in/out when within the configured radius of the office. Set office coordinates and radius, then enable.
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={s.geofence_enabled === true}
                  onChange={async (e) => {
                    const next = e.target.checked
                    setSavingGeofence(true)
                    try {
                      const res = await api.put(`/developer/companies/${companyId}/settings`, {
                        geofence_enabled: next,
                        ...(next && geofenceLat && geofenceLon
                          ? {
                              office_latitude: parseFloat(geofenceLat),
                              office_longitude: parseFloat(geofenceLon),
                              geofence_radius_meters: geofenceRadius,
                            }
                          : {}),
                      })
                      setCompany(res.data)
                    } catch (err: any) {
                      logger.error('Update geofence failed', err as Error)
                    } finally {
                      setSavingGeofence(false)
                    }
                  }}
                  disabled={savingGeofence}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700">Enabled</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="any"
                  placeholder="Latitude"
                  value={geofenceLat}
                  onChange={(e) => setGeofenceLat(e.target.value)}
                  className="w-28 px-2 py-1.5 border border-slate-300 rounded text-sm"
                />
                <input
                  type="number"
                  step="any"
                  placeholder="Longitude"
                  value={geofenceLon}
                  onChange={(e) => setGeofenceLon(e.target.value)}
                  className="w-28 px-2 py-1.5 border border-slate-300 rounded text-sm"
                />
                <input
                  type="number"
                  min={10}
                  max={5000}
                  value={geofenceRadius}
                  onChange={(e) => setGeofenceRadius(parseInt(e.target.value, 10) || 100)}
                  className="w-20 px-2 py-1.5 border border-slate-300 rounded text-sm"
                />
                <span className="text-xs text-slate-500">m radius</span>
                <button
                  type="button"
                  disabled={geofenceGettingLocation || typeof navigator === 'undefined' || !navigator.geolocation}
                  onClick={() => {
                    if (typeof navigator === 'undefined' || !navigator.geolocation) return
                    setGeofenceGettingLocation(true)
                    navigator.geolocation.getCurrentPosition(
                      (position) => {
                        setGeofenceLat(String(position.coords.latitude))
                        setGeofenceLon(String(position.coords.longitude))
                        setGeofenceGettingLocation(false)
                      },
                      () => setGeofenceGettingLocation(false),
                      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
                    )
                  }}
                  className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded border border-slate-300 hover:bg-slate-200 disabled:opacity-50"
                >
                  {geofenceGettingLocation ? 'Getting…' : 'Current location'}
                </button>
              </div>
              <button
                type="button"
                disabled={savingGeofence || (!geofenceLat && !geofenceLon)}
                onClick={async () => {
                  setSavingGeofence(true)
                  try {
                    const res = await api.put(`/developer/companies/${companyId}/settings`, {
                      geofence_enabled: s.geofence_enabled === true,
                      office_latitude: geofenceLat ? parseFloat(geofenceLat) : undefined,
                      office_longitude: geofenceLon ? parseFloat(geofenceLon) : undefined,
                      geofence_radius_meters: geofenceRadius,
                    })
                    setCompany(res.data)
                    if (res.data?.settings) {
                      setGeofenceLat(res.data.settings.office_latitude != null ? String(res.data.settings.office_latitude) : '')
                      setGeofenceLon(res.data.settings.office_longitude != null ? String(res.data.settings.office_longitude) : '')
                      setGeofenceRadius(res.data.settings.geofence_radius_meters ?? 100)
                    }
                  } catch (err: any) {
                    logger.error('Update geofence failed', err as Error)
                  } finally {
                    setSavingGeofence(false)
                  }
                }}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {savingGeofence ? 'Saving…' : 'Save location'}
              </button>
            </div>
            {s.geofence_enabled && (s.office_latitude != null || s.office_longitude != null) && (
              <p className="text-xs text-slate-600 mt-2">
                Office: {s.office_latitude}, {s.office_longitude} · radius {s.geofence_radius_meters ?? 100} m
              </p>
            )}
          </div>

          {/* Kiosk: only allow on office network */}
          <div className="mb-6 pb-6 border-b border-slate-200">
            <p className="text-sm font-medium text-slate-900 mb-2">Kiosk: restrict to office network</p>
            <p className="text-xs text-slate-500 mb-3">
              When on, the kiosk only works from the listed IPs or CIDR ranges (office network).
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={kioskNetworkRestrictionEnabled}
                  onChange={(e) => {
                    const next = e.target.checked
                    setSavingKioskNetwork(true)
                    const ips = kioskAllowedIpsText.split('\n').map((x) => x.trim()).filter(Boolean)
                    api.put(`/developer/companies/${companyId}/settings`, {
                      kiosk_network_restriction_enabled: next,
                      kiosk_allowed_ips: ips,
                    }).then((res) => {
                      setCompany(res.data)
                      if (res.data?.settings) {
                        setKioskNetworkRestrictionEnabled(res.data.settings.kiosk_network_restriction_enabled === true)
                        setKioskAllowedIpsText((res.data.settings.kiosk_allowed_ips || []).join('\n'))
                      }
                    }).catch((err: any) => logger.error('Update kiosk network failed', err as Error)).finally(() => setSavingKioskNetwork(false))
                  }}
                  disabled={savingKioskNetwork}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700">Enabled</span>
              </label>
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm text-slate-700">Allowed IPs (one per line)</span>
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
                        }
                      } catch {
                        // ignore
                      } finally {
                        setKioskFetchingMyIp(false)
                      }
                    }}
                    className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded border border-slate-300 hover:bg-slate-200 disabled:opacity-50"
                  >
                    {kioskFetchingMyIp ? '…' : 'Add my current IP'}
                  </button>
                </div>
                <textarea
                  value={kioskAllowedIpsText}
                  onChange={(e) => setKioskAllowedIpsText(e.target.value)}
                  placeholder={'192.168.1.0/24\n10.0.0.1'}
                  rows={3}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm font-mono"
                />
                <p className="text-xs text-slate-500 mt-1">Use “Add my current IP” when at the office. If you always see the same IP from different networks, configure your reverse proxy to send the real client IP (X-Real-IP or X-Forwarded-For).</p>
              </div>
              <button
                type="button"
                disabled={savingKioskNetwork}
                onClick={async () => {
                  setSavingKioskNetwork(true)
                  try {
                    const ips = kioskAllowedIpsText.split('\n').map((x) => x.trim()).filter(Boolean)
                    const res = await api.put(`/developer/companies/${companyId}/settings`, {
                      kiosk_network_restriction_enabled: kioskNetworkRestrictionEnabled,
                      kiosk_allowed_ips: ips,
                    })
                    setCompany(res.data)
                    if (res.data?.settings) {
                      setKioskNetworkRestrictionEnabled(res.data.settings.kiosk_network_restriction_enabled === true)
                      setKioskAllowedIpsText((res.data.settings.kiosk_allowed_ips || []).join('\n'))
                    }
                  } catch (err: any) {
                    logger.error('Update kiosk network failed', err as Error)
                  } finally {
                    setSavingKioskNetwork(false)
                  }
                }}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {savingKioskNetwork ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div><dt className="text-slate-600">Timezone</dt><dd className="font-medium">{s.timezone}</dd></div>
            <div><dt className="text-slate-600">Payroll week start</dt><dd className="font-medium">Day {s.payroll_week_start_day}</dd></div>
            <div><dt className="text-slate-600">Overtime enabled</dt><dd className="font-medium">{s.overtime_enabled ? 'Yes' : 'No'}</dd></div>
            <div><dt className="text-slate-600">Overtime threshold (hrs/week)</dt><dd className="font-medium">{s.overtime_threshold_hours_per_week}</dd></div>
            <div><dt className="text-slate-600">Rounding</dt><dd className="font-medium">{s.rounding_policy}</dd></div>
            <div><dt className="text-slate-600">Breaks paid</dt><dd className="font-medium">{s.breaks_paid ? 'Yes' : 'No'}</dd></div>
            {s.cash_drawer_enabled != null && (
              <div><dt className="text-slate-600">Cash drawer</dt><dd className="font-medium">{s.cash_drawer_enabled ? 'Yes' : 'No'}</dd></div>
            )}
            {s.shift_notes_enabled != null && (
              <div><dt className="text-slate-600">Shift notes</dt><dd className="font-medium">{s.shift_notes_enabled ? 'Yes' : 'No'}</dd></div>
            )}
          </dl>
          </CardBody>
        </Card>
        </TabPanel>

        <TabPanel id="activity" value={companyTab}>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Activity</CardTitle>
              <CardDescription>Company-scoped audit trail (coming soon)</CardDescription>
            </CardHeader>
            <CardBody>
              <p className="text-sm text-foreground-muted">
                Recent punches, settings changes, and user events for this tenant will appear here.
              </p>
            </CardBody>
          </Card>
        </TabPanel>

        <TabPanel id="danger" value={companyTab}>
          {company.id !== systemDefaultCompanyId ? (
            <Card className="border-red-500/30">
              <CardHeader>
                <CardTitle className="text-danger">Danger zone</CardTitle>
                <CardDescription>
                  Permanently delete this company, all users, time entries, payroll, schedules, and related data.
                </CardDescription>
              </CardHeader>
              <CardBody>
                <Button variant="danger" loading={deletingCompany} onClick={handleDeleteCompany}>
                  Delete company
                </Button>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody>
                <p className="text-sm text-foreground-muted">The system default company cannot be deleted.</p>
              </CardBody>
            </Card>
          )}
        </TabPanel>

        <TabPanel id="users" value={companyTab}>
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Users</h2>
              <p className="text-sm text-foreground-muted">Click a user to edit (including verification).</p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setAddUserEmailError(null)
                setAddUserFormError(null)
                setAddUserOpen(true)
              }}
            >
              Add User
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-700 uppercase">Name</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-700 uppercase">Email</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-700 uppercase">Role</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-700 uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-700 uppercase">Verified</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-700 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">No users</td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">{u.name}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{u.email}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {u.role}
                        {u.role === 'DEVELOPER' && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-600">Super account</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          u.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'
                        }`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {u.email_verified ? (
                          <span className="text-green-600">Yes</span>
                        ) : (
                          <span className="text-amber-600">No{u.verification_required ? ' (required)' : ''}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/developer/users/${u.id}`}
                          className="text-blue-600 hover:text-blue-800 font-medium text-sm"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
        </TabPanel>

        {addUserOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            role="presentation"
            onClick={() => closeAddUserModal()}
          >
            <div
              className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-lg font-semibold text-slate-900">Add User</h3>
                <button
                  type="button"
                  onClick={() => closeAddUserModal()}
                  disabled={addUserSubmitting}
                  className="text-slate-400 hover:text-slate-600 text-xl leading-none px-1 disabled:opacity-50"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <p className="text-sm text-slate-600 mb-4">
                Create a tenant user in this company. Developers cannot be created here.
              </p>
              {addUserFormError && (
                <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
                  {addUserFormError}
                </div>
              )}
              <form onSubmit={handleAddUserSubmit} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
                  <input
                    required
                    minLength={2}
                    value={addUserForm.name}
                    onChange={(e) => setAddUserForm((f) => ({ ...f, name: e.target.value }))}
                    className="block w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    value={addUserForm.email}
                    onChange={(e) => {
                      setAddUserEmailError(null)
                      setAddUserForm((f) => ({ ...f, email: e.target.value }))
                    }}
                    className={`block w-full px-3 py-2 border rounded-md text-sm ${
                      addUserEmailError ? 'border-red-400' : 'border-slate-300'
                    }`}
                  />
                  {addUserEmailError && (
                    <p className="mt-1 text-xs text-red-600">{addUserEmailError}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Role *</label>
                  <select
                    value={addUserForm.role}
                    onChange={(e) => setAddUserForm((f) => ({ ...f, role: e.target.value }))}
                    className="block w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                  >
                    {tenantRoles.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                  <input
                    type="password"
                    minLength={8}
                    value={addUserForm.password}
                    onChange={(e) => setAddUserForm((f) => ({ ...f, password: e.target.value }))}
                    className="block w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                    placeholder="Optional"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Leave blank to email a set-password link (uses the Password Setup Invite template).
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">PIN</label>
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    value={addUserForm.pin}
                    onChange={(e) =>
                      setAddUserForm((f) => ({
                        ...f,
                        pin: e.target.value.replace(/\D/g, '').slice(0, 4),
                      }))
                    }
                    placeholder="Optional, 4 digits"
                    className="block w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Pay rate ($/hr)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={addUserForm.pay_rate}
                    onChange={(e) => setAddUserForm((f) => ({ ...f, pay_rate: e.target.value }))}
                    className="block w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                    placeholder="Optional"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={addUserForm.email_verified}
                    onChange={(e) => setAddUserForm((f) => ({ ...f, email_verified: e.target.checked }))}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  Email verified
                </label>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => closeAddUserModal()}
                    disabled={addUserSubmitting}
                    className="flex-1 px-4 py-2 border border-slate-300 rounded-md text-sm font-medium disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={addUserSubmitting}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {addUserSubmitting ? 'Creating…' : 'Create User'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {tempCredsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl p-6" role="dialog" aria-modal="true">
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Temporary password</h3>
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3 mb-4">
                This password will not be shown again. Save it or share with the user securely.
              </p>
              <div className="space-y-2 text-sm mb-4">
                <p><span className="text-slate-500">Name:</span> <span className="font-medium">{tempCredsModal.name}</span></p>
                <p><span className="text-slate-500">Email:</span> <span className="font-medium">{tempCredsModal.email}</span></p>
                <p><span className="text-slate-500">Password:</span> <span className="font-mono font-medium">{tempCredsModal.password}</span></p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    const text = `Email: ${tempCredsModal.email}\nPassword: ${tempCredsModal.password}`
                    try {
                      await navigator.clipboard.writeText(text)
                      toast.success('Credentials copied')
                    } catch {
                      toast.error('Could not copy to clipboard')
                    }
                  }}
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-md text-sm font-medium hover:bg-slate-50"
                >
                  Copy to clipboard
                </button>
                <button
                  type="button"
                  onClick={() => setTempCredsModal(null)}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  )
}
