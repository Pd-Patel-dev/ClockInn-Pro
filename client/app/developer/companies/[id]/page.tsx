'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import logger from '@/lib/logger'
import BackButton from '@/components/BackButton'
import { useToast } from '@/components/Toast'

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
  company_id: string
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
        setUsers(Array.isArray(usersRes.data) ? usersRes.data : [])
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
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      </Layout>
    )
  }

  if (!company) {
    return (
      <Layout>
        <div className="px-4 py-8">
          <p className="text-slate-600">Company not found.</p>
          <Link href="/developer" className="text-blue-600 hover:underline mt-2 inline-block">Back to Developer Portal</Link>
        </div>
      </Layout>
    )
  }

  const s = company.settings

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <BackButton fallbackHref="/developer" className="text-sm text-blue-600 hover:text-blue-700 mb-4">
          Back to Developer Portal
        </BackButton>

        <h1 className="text-2xl font-bold text-slate-900 mb-1">{company.name}</h1>
        <p className="text-sm text-slate-600 mb-6">Company details and users (developer only)</p>

        {/* Company info */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Company Info</h2>
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

          {myCompanyId !== null &&
            company.id !== myCompanyId &&
            company.id !== systemDefaultCompanyId && (
              <div className="mt-8 pt-6 border-t border-red-100">
                <h3 className="text-sm font-semibold text-red-800">Danger zone</h3>
                <p className="text-xs text-slate-600 mt-1 max-w-xl">
                  Permanently delete this company, all users, time entries, payroll, schedules, and related data. This cannot be undone.
                </p>
                <button
                  type="button"
                  disabled={deletingCompany}
                  onClick={async () => {
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
                      router.push('/developer')
                    } catch (e: unknown) {
                      const err = e as { response?: { data?: { detail?: string } } }
                      const msg = err.response?.data?.detail
                      toast.error(typeof msg === 'string' ? msg : 'Failed to delete company')
                      logger.error('Developer delete company failed', e as Error, { companyId: company.id })
                    } finally {
                      setDeletingCompany(false)
                    }
                  }}
                  className="mt-3 px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
                >
                  {deletingCompany ? 'Deleting…' : 'Delete company'}
                </button>
              </div>
            )}
        </div>

        {/* Settings */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Settings</h2>

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
        </div>

        {/* Users */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">Users</h2>
            <p className="text-sm text-slate-600">Click a user to edit (including verification).</p>
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
        </div>
      </div>
    </Layout>
  )
}
