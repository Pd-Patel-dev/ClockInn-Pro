'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser, User } from '@/lib/auth'
import { format } from 'date-fns'
import type { ShiftNoteCurrent } from '@/lib/shiftNotes'

type TimeEntry = {
  id: string
  clock_in_at: string
  clock_out_at: string | null
  clock_in_at_local?: string | null
  clock_out_at_local?: string | null
  rounded_hours?: number | null
  status?: string
}

export default function PunchInOutPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [currentStatus, setCurrentStatus] = useState<'in' | 'out' | null>(null)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cashDrawerRequired, setCashDrawerRequired] = useState(false)
  const [geofenceRequired, setGeofenceRequired] = useState(false)
  const [cashAmount, setCashAmount] = useState('')
  const [collectedCash, setCollectedCash] = useState('')
  const [dropAmount, setDropAmount] = useState('')
  const [beveragesCash, setBeveragesCash] = useState('')
  const [cashError, setCashError] = useState<string | null>(null)
  const [showCashDialog, setShowCashDialog] = useState(false)
  const [pendingPunch, setPendingPunch] = useState(false)
  const [location, setLocation] = useState<{ latitude: string; longitude: string } | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [clockNow, setClockNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setClockNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Shift note (when clocked in)
  const [shiftNote, setShiftNote] = useState<ShiftNoteCurrent | null>(null)
  const [shiftNoteContent, setShiftNoteContent] = useState('')
  const [shiftNoteLoading, setShiftNoteLoading] = useState(false)
  const [shiftNoteSaveStatus, setShiftNoteSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [shiftNoteSavedAt, setShiftNoteSavedAt] = useState<Date | null>(null)
  const shiftNoteSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedContentRef = useRef('')
  const SHIFT_NOTE_DEBOUNCE_MS = 800

  const fetchStatusAndEntries = useCallback(async () => {
    try {
      const [meRes, entriesRes] = await Promise.all([
        api.get('/time/my?limit=1'),
        api.get('/time/my?limit=10'),
      ])
      const meEntries = meRes.data?.entries ?? []
      const hasOpen = meEntries.length > 0 && !meEntries[0].clock_out_at
      setCurrentStatus(hasOpen ? 'in' : 'out')
      setEntries(entriesRes.data?.entries ?? [])
    } catch (err) {
      if ((err as { response?: { status: number } })?.response?.status === 403) {
        const detail = (err as { response?: { data?: { detail?: { error?: string } } } })?.response?.data?.detail
        if (typeof detail === 'object' && detail?.error === 'EMAIL_VERIFICATION_REQUIRED') {
          router.push('/verify-email')
          return
        }
      }
      setEntries([])
      setCurrentStatus('out')
    } finally {
      setLoadingList(false)
    }
  }, [router])

  const fetchShiftNote = useCallback(async () => {
    setShiftNoteLoading(true)
    try {
      const res = await api.get('/shift-notes/current')
      const data = res.data as ShiftNoteCurrent
      setShiftNote(data)
      setShiftNoteContent(data.content ?? '')
      lastSavedContentRef.current = data.content ?? ''
    } catch {
      setShiftNote(null)
      setShiftNoteContent('')
    } finally {
      setShiftNoteLoading(false)
    }
  }, [])

  const saveShiftNote = useCallback(async (content: string) => {
    if (content === lastSavedContentRef.current) return
    setShiftNoteSaveStatus('saving')
    try {
      await api.put('/shift-notes/current', { content })
      lastSavedContentRef.current = content
      setShiftNoteSavedAt(new Date())
      setShiftNoteSaveStatus('saved')
    } catch {
      setShiftNoteSaveStatus('idle')
    }
  }, [])

  useEffect(() => {
    if (currentStatus === 'in') {
      fetchShiftNote()
    } else {
      setShiftNote(null)
      setShiftNoteContent('')
    }
  }, [currentStatus, fetchShiftNote])

  useEffect(() => {
    if (!shiftNote?.can_edit || shiftNoteSaveStatus === 'saving') return
    if (shiftNoteSaveTimeoutRef.current) clearTimeout(shiftNoteSaveTimeoutRef.current)
    shiftNoteSaveTimeoutRef.current = setTimeout(() => {
      saveShiftNote(shiftNoteContent)
      shiftNoteSaveTimeoutRef.current = null
    }, SHIFT_NOTE_DEBOUNCE_MS)
    return () => {
      if (shiftNoteSaveTimeoutRef.current) clearTimeout(shiftNoteSaveTimeoutRef.current)
    }
  }, [shiftNoteContent, shiftNote?.can_edit, saveShiftNote])

  useEffect(() => {
    const getLocation = () => {
      if (!navigator.geolocation) {
        setLocationError('Geolocation not supported')
        return
      }
      setLocationLoading(true)
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            latitude: position.coords.latitude.toString(),
            longitude: position.coords.longitude.toString(),
          })
          setLocationError(null)
          setLocationLoading(false)
        },
        () => {
          setLocationLoading(false)
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      )
    }
    getLocation()
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const currentUser = await getCurrentUser()
        setUser(currentUser)
        if (currentUser.verification_required || !currentUser.email_verified) {
          router.push('/verify-email')
          return
        }
        try {
          const companyRes = await api.get('/company/info')
          const settings = companyRes.data?.settings || {}
          const cashEnabled = settings.cash_drawer_enabled || false
          const requiredForAll = settings.cash_drawer_required_for_all !== false
          const requiredRoles = settings.cash_drawer_required_roles || ['FRONTDESK']
          if (cashEnabled && (requiredForAll || requiredRoles.includes(currentUser.role))) {
            setCashDrawerRequired(true)
          } else {
            setCashDrawerRequired(false)
          }
          setGeofenceRequired(settings.geofence_enabled === true)
        } catch {
          setCashDrawerRequired(false)
          setGeofenceRequired(false)
        }
        await fetchStatusAndEntries()
      } catch {
        router.push('/login')
      }
    }
    load()
  }, [router, fetchStatusAndEntries])

  const getCurrentLocation = (): Promise<{ latitude: string; longitude: string } | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null)
        return
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude.toString(),
            longitude: position.coords.longitude.toString(),
          })
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 }
      )
    })
  }

  const executePunch = useCallback(async () => {
    setError(null)
    setMessage(null)
    setLoading(true)
    setShowCashDialog(false)
    try {
      let currentLocation = location
      if (!currentLocation) {
        currentLocation = await getCurrentLocation()
        if (currentLocation) setLocation(currentLocation)
      }
      if (geofenceRequired && !currentLocation) {
        setError('Location is required to punch at the office. Please enable location access and try again.')
        setLoading(false)
        return
      }
      const cashStartCents =
        cashDrawerRequired && currentStatus === 'out'
          ? Math.round(parseFloat(cashAmount || '0') * 100)
          : undefined
      const cashEndCents =
        cashDrawerRequired && currentStatus === 'in'
          ? Math.round(parseFloat(cashAmount || '0') * 100)
          : undefined
      const collectedCashCents =
        cashDrawerRequired && currentStatus === 'in'
          ? Math.round(parseFloat(collectedCash || '0') * 100)
          : undefined
      const dropAmountCents =
        cashDrawerRequired && currentStatus === 'in'
          ? Math.round(parseFloat(dropAmount || '0') * 100)
          : undefined
      const beveragesCashCents =
        cashDrawerRequired && currentStatus === 'in'
          ? Math.round(parseFloat(beveragesCash || '0') * 100)
          : undefined
      const res = await api.post('/time/punch-me-simple', {
        cash_start_cents: cashStartCents,
        cash_end_cents: cashEndCents,
        collected_cash_cents: collectedCashCents,
        drop_amount_cents: dropAmountCents,
        beverages_cash_cents: beveragesCashCents,
        latitude: currentLocation?.latitude,
        longitude: currentLocation?.longitude,
      })
      const entry = res.data
      if (entry.clock_out_at) {
        setMessage(`Clocked out at ${format(new Date(entry.clock_out_at), 'MMM d, h:mm a')}`)
        setCurrentStatus('out')
      } else {
        setMessage(`Clocked in at ${format(new Date(entry.clock_in_at), 'MMM d, h:mm a')}`)
        setCurrentStatus('in')
      }
      setCashAmount('')
      setCashError(null)
      setPendingPunch(false)
      await fetchStatusAndEntries()
      setTimeout(() => setMessage(null), 4000)
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string | { message?: string } } } }
      const detail = ax.response?.data?.detail
      const errorMessage =
        typeof detail === 'string'
          ? detail
          : detail && typeof detail === 'object' && typeof (detail as { message?: string }).message === 'string'
            ? (detail as { message: string }).message
            : 'Punch failed. Please try again.'
      if (errorMessage.toLowerCase().includes('cash')) {
        setCashDrawerRequired(true)
        setPendingPunch(true)
        setShowCashDialog(true)
        setCashAmount('')
        setCollectedCash('')
        setDropAmount('')
        setBeveragesCash('')
        setCashError(null)
        setError(null)
      } else {
        setError(errorMessage)
        setPendingPunch(false)
        setShowCashDialog(false)
      }
    } finally {
      setLoading(false)
    }
  }, [location, geofenceRequired, cashDrawerRequired, currentStatus, cashAmount, collectedCash, dropAmount, beveragesCash, fetchStatusAndEntries])

  const handlePunch = () => {
    setError(null)
    setMessage(null)
    if (cashDrawerRequired) {
      setPendingPunch(true)
      setShowCashDialog(true)
      setCashAmount('')
      setCollectedCash('')
      setDropAmount('')
      setBeveragesCash('')
      setCashError(null)
      return
    }
    executePunch()
  }

  const handleCashDialogSubmit = () => {
    const cashValue = parseFloat(cashAmount)
    if (isNaN(cashValue) || cashValue < 0) {
      setCashError('Please enter a valid cash amount')
      return
    }
    if (currentStatus === 'in') {
      const collectedValue = parseFloat(collectedCash)
      const dropValue = parseFloat(dropAmount)
      const beveragesValue = parseFloat(beveragesCash)
      if (isNaN(collectedValue) || collectedValue < 0) {
        setCashError('Please enter a valid collected cash amount')
        return
      }
      if (isNaN(dropValue) || dropValue < 0) {
        setCashError('Please enter a valid drop amount')
        return
      }
      if (isNaN(beveragesValue) || beveragesValue < 0) {
        setCashError('Please enter a valid beverages sold amount')
        return
      }
    }
    setCashError(null)
    executePunch()
  }

  const handleCashDialogCancel = () => {
    setShowCashDialog(false)
    setPendingPunch(false)
    setCashAmount('')
    setCollectedCash('')
    setDropAmount('')
    setBeveragesCash('')
    setCashError(null)
  }

  const formatTime = (entry: TimeEntry, field: 'clock_in_at' | 'clock_out_at') => {
    const raw = entry[field]
    if (!raw) return '—'
    const local = field === 'clock_in_at' ? entry.clock_in_at_local : entry.clock_out_at_local
    if (local) {
      const parts = local.split(' ')
      return parts.length >= 2 ? parts[1].substring(0, 5) : format(new Date(raw), 'HH:mm')
    }
    return format(new Date(raw), 'h:mm a')
  }

  const formatDate = (entry: TimeEntry) => {
    if (entry.clock_in_at_local) {
      const parts = entry.clock_in_at_local.split(' ')
      return parts[0] || format(new Date(entry.clock_in_at), 'MMM d, yyyy')
    }
    return format(new Date(entry.clock_in_at), 'MMM d, yyyy')
  }

  if (!user) {
    return (
      <Layout>
        <div className="min-h-[40vh] flex items-center justify-center px-4">
          <div className="animate-pulse space-y-3 w-full max-w-sm">
            <div className="h-14 bg-slate-200 rounded-xl w-full" />
            <div className="h-24 bg-slate-200 rounded-xl w-full" />
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">Punch in / out</h1>
          <p className="mt-1 text-sm text-slate-500">{user.name}</p>
        </div>

        {geofenceRequired && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Punch in/out is only allowed when you are at the office.
          </p>
        )}
        <div
          className={`rounded-lg p-3 border flex items-center justify-center gap-2 text-sm ${
            locationLoading
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : location
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-slate-50 border-slate-200 text-slate-600'
          }`}
        >
          {locationLoading ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Getting location...</span>
            </>
          ) : location ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Location captured</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              <span>Location unavailable</span>
            </>
          )}
        </div>

        <div className="max-w-sm mx-auto">
          <div
            className={`bg-white border border-slate-200 rounded-xl p-6 shadow-sm text-center ${
              currentStatus === 'in' ? 'ring-1 ring-amber-200' : ''
            }`}
          >
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Current time</p>
            <p className="text-5xl font-light text-slate-900 tabular-nums tracking-tight">
              {format(clockNow, 'h:mm:ss a')}
            </p>
            <p className="text-sm text-slate-500 mt-4">
              {currentStatus === 'in' ? 'You are clocked in' : 'You are clocked out'}
            </p>
            <button
              type="button"
              onClick={handlePunch}
              disabled={loading}
              className={`mt-6 w-full py-3 px-4 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                currentStatus === 'in'
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {loading ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24" aria-hidden>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Processing…
                </span>
              ) : currentStatus === 'in' ? (
                'Punch out'
              ) : (
                'Punch in'
              )}
            </button>
          </div>
        </div>

        {message && (
          <div className="p-3 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-center text-sm max-w-sm mx-auto">
            {message}
          </div>
        )}
        {error && (
          <div className="p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-center text-sm max-w-sm mx-auto">
            {error}
          </div>
        )}

        {/* Shift note — when clocked in */}
        {currentStatus === 'in' && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-6 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Shift note</h2>
              <Link href="/my/shift-notepad" className="text-sm font-medium text-blue-600 hover:text-blue-700">
                Open full notepad →
              </Link>
            </div>
            {shiftNoteLoading ? (
              <div className="p-6 animate-pulse space-y-2">
                <div className="h-4 bg-slate-200 rounded w-1/3" />
                <div className="h-20 bg-slate-100 rounded-lg" />
              </div>
            ) : shiftNote ? (
              <>
                <div className="px-6 py-2 border-b border-slate-100 flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-slate-500">
                    {shiftNoteSaveStatus === 'saving' && 'Saving…'}
                    {shiftNoteSaveStatus === 'saved' && shiftNoteSavedAt && `Saved at ${format(shiftNoteSavedAt, 'h:mm a')}`}
                  </span>
                </div>
                <textarea
                  value={shiftNoteContent}
                  onChange={(e) => setShiftNoteContent(e.target.value)}
                  disabled={!shiftNote.can_edit}
                  placeholder="Jot down notes for this shift..."
                  rows={4}
                  className="w-full p-6 text-slate-900 placeholder:text-slate-400 border-0 focus:ring-0 focus:outline-none resize-y text-sm bg-white disabled:bg-slate-50 disabled:cursor-not-allowed"
                />
              </>
            ) : (
              <div className="p-6 text-sm text-slate-500">Shift note will appear here. If it doesn’t load, try refreshing.</div>
            )}
          </div>
        )}

        <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm bg-white">
          <div className="px-6 py-3 border-b border-slate-200 bg-slate-50">
            <h2 className="text-lg font-semibold text-slate-900">Past 10 time entries</h2>
          </div>
          {loadingList ? (
            <div className="p-8 animate-pulse space-y-3">
              <div className="h-4 bg-slate-100 rounded w-full" />
              <div className="h-4 bg-slate-100 rounded w-full" />
              <div className="h-4 bg-slate-100 rounded w-5/6" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-700">No time entries yet</p>
              <p className="text-sm text-slate-400 mt-1">Your punches will appear here</p>
            </div>
          ) : (
            <ul>
              {entries.map((entry) => (
                <li key={entry.id} className="px-6 py-3 flex items-center justify-between text-sm border-b border-slate-100 last:border-0">
                  <div>
                    <span className="font-medium text-slate-900">{formatDate(entry)}</span>
                    <span className="text-slate-500 ml-2">
                      {formatTime(entry, 'clock_in_at')} – {formatTime(entry, 'clock_out_at')}
                    </span>
                  </div>
                  {entry.clock_out_at && entry.rounded_hours != null && (
                    <span className="text-slate-500 tabular-nums">{entry.rounded_hours.toFixed(1)}h</span>
                  )}
                  {entry.clock_out_at == null && (
                    <span className="text-amber-600 text-xs font-medium px-2.5 py-0.5 rounded-full border border-amber-200 bg-amber-50">
                      Open
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Cash Drawer Dialog – same as PIN-based punch */}
        {showCashDialog && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm overflow-y-auto h-full w-full z-[9999] flex items-center justify-center p-4">
            <div className="relative bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-lg m-4 p-6">
              <h3 className="text-lg font-semibold text-slate-900 text-center">
                {currentStatus === 'in' ? 'Ending cash count' : 'Starting cash count'}
              </h3>
              <p className="text-sm text-slate-500 text-center mt-1 mb-6">
                {currentStatus === 'in'
                  ? 'Enter all cash amounts for your shift.'
                  : 'Enter the starting cash amount in the drawer.'}
              </p>
              <div>
                {currentStatus === 'out' ? (
                  <div className="mb-6 space-y-5">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5 text-center">
                        Starting cash amount <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <span className="text-slate-400 text-lg font-medium">$</span>
                        </div>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={cashAmount}
                          onChange={(e) => {
                            setCashAmount(e.target.value)
                            setCashError(null)
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && handleCashDialogSubmit()}
                          autoFocus
                          className={`block w-full pl-10 pr-4 py-3 border rounded-lg text-center text-xl font-semibold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                            cashError ? 'border-red-300' : 'border-slate-200'
                          }`}
                          placeholder="0.00"
                          disabled={loading}
                        />
                      </div>
                    {cashError && <p className="text-xs text-red-500 mt-1 text-center">{cashError}</p>}
                    <p className="text-xs text-slate-400 text-center">Amount in dollars (e.g. 100.50)</p>
                    </div>
                  </div>
                ) : (
                  /* Clock-out: collected cash, beverages sold, cash in drawer */
                  <div className="space-y-5 mb-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Collected cash <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={collectedCash}
                          onChange={(e) => {
                            setCollectedCash(e.target.value)
                            setCashError(null)
                          }}
                          className={`block w-full pl-8 pr-3 py-2 border rounded-lg text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                            cashError ? 'border-red-300' : 'border-slate-200'
                          }`}
                          placeholder="0.00"
                          disabled={loading}
                        />
                      </div>
                      <p className="mt-1 text-xs text-slate-400">Total cash collected from customers</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Drop amount <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={dropAmount}
                          onChange={(e) => {
                            setDropAmount(e.target.value)
                            setCashError(null)
                          }}
                          className={`block w-full pl-8 pr-3 py-2 border rounded-lg text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                            cashError ? 'border-red-300' : 'border-slate-200'
                          }`}
                          placeholder="0.00"
                          disabled={loading}
                        />
                      </div>
                      <p className="mt-1 text-xs text-slate-400">Cash removed from drawer during shift</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Beverages sold <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={beveragesCash}
                          onChange={(e) => {
                            setBeveragesCash(e.target.value)
                            setCashError(null)
                          }}
                          className={`block w-full pl-8 pr-3 py-2 border rounded-lg text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                            cashError ? 'border-red-300' : 'border-slate-200'
                          }`}
                          placeholder="0.00"
                          disabled={loading}
                        />
                      </div>
                      <p className="mt-1 text-xs text-slate-400">Total beverage sales (all payment types)</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Cash in drawer <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={cashAmount}
                          onChange={(e) => {
                            setCashAmount(e.target.value)
                            setCashError(null)
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && handleCashDialogSubmit()}
                          className={`block w-full pl-8 pr-3 py-2 border rounded-lg text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                            cashError ? 'border-red-300' : 'border-slate-200'
                          }`}
                          placeholder="0.00"
                          disabled={loading}
                        />
                      </div>
                      <p className="mt-1 text-xs text-slate-400">Final cash remaining in drawer</p>
                    </div>
                    {cashError && (
                      <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">{cashError}</p>
                    )}
                  </div>
                )}
                <div className="flex gap-3 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    onClick={handleCashDialogSubmit}
                    disabled={
                      loading ||
                      !cashAmount ||
                      parseFloat(cashAmount) < 0 ||
                      (currentStatus === 'in' &&
                        (!collectedCash ||
                          parseFloat(collectedCash) < 0 ||
                          !dropAmount ||
                          parseFloat(dropAmount) < 0 ||
                          !beveragesCash ||
                          parseFloat(beveragesCash) < 0))
                    }
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24" aria-hidden>
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Processing…</span>
                      </>
                    ) : (
                      <span>Continue</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleCashDialogCancel}
                    disabled={loading}
                    className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
