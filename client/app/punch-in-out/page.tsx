'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Layout from '@/components/Layout'
import ConfirmationDialog from '@/components/ConfirmationDialog'
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
  const [shiftNotesEnabled, setShiftNotesEnabled] = useState(true)
  const [cashAmount, setCashAmount] = useState('')
  const [collectedCash, setCollectedCash] = useState('')
  const [dropAmount, setDropAmount] = useState('')
  const [beveragesCash, setBeveragesCash] = useState('')
  const [cashError, setCashError] = useState<string | null>(null)
  const [showCashDialog, setShowCashDialog] = useState(false)
  const [showPunchConfirm, setShowPunchConfirm] = useState(false)
  const [punchConfirmAfterCash, setPunchConfirmAfterCash] = useState(false)
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
      const res = await api.get('/time/my?limit=10')
      const list = res.data?.entries ?? []
      const hasOpen = list.length > 0 && !list[0].clock_out_at
      setCurrentStatus(hasOpen ? 'in' : 'out')
      setEntries(list)
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
    if (currentStatus === 'in' && shiftNotesEnabled) {
      fetchShiftNote()
    } else {
      setShiftNote(null)
      setShiftNoteContent('')
    }
  }, [currentStatus, shiftNotesEnabled, fetchShiftNote])

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
          const requiredForAll = settings.cash_drawer_required_for_all === true
          const requiredRoles = settings.cash_drawer_required_roles || ['FRONTDESK']
          if (cashEnabled && (requiredForAll || requiredRoles.includes(currentUser.role))) {
            setCashDrawerRequired(true)
          } else {
            setCashDrawerRequired(false)
          }
          setGeofenceRequired(settings.geofence_enabled === true)
          setShiftNotesEnabled(settings.shift_notes_enabled !== false)
        } catch {
          setCashDrawerRequired(false)
          setGeofenceRequired(false)
          setShiftNotesEnabled(true)
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
    if (loading || showPunchConfirm || showCashDialog) return
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
    setPunchConfirmAfterCash(false)
    setShowPunchConfirm(true)
  }

  const confirmPunchIntent = () => {
    setShowPunchConfirm(false)
    setPunchConfirmAfterCash(false)
    void executePunch()
  }

  const cancelPunchConfirm = () => {
    setShowPunchConfirm(false)
    if (punchConfirmAfterCash) {
      setPunchConfirmAfterCash(false)
      setPendingPunch(true)
      setShowCashDialog(true)
    }
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
    setShowCashDialog(false)
    setPunchConfirmAfterCash(true)
    setShowPunchConfirm(true)
  }

  const handleCashDialogCancel = () => {
    setShowCashDialog(false)
    setPendingPunch(false)
    setPunchConfirmAfterCash(false)
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
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-2xl space-y-6 px-4 py-10 sm:px-6">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-slate-900">Punch In / Out</h1>
          <p className="mt-1 text-sm text-slate-500">Track your working hours for today</p>
          <p className="mt-1 text-xs text-slate-400">{user.name}</p>
        </div>

        {geofenceRequired && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Punch in/out is only allowed when you are at the office.
          </p>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Current Status</p>
              {currentStatus === 'in' ? (
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                  <span className="text-base font-semibold text-slate-900">Clocked In</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-slate-400" />
                  <span className="text-base font-semibold text-slate-900">Clocked Out</span>
                </div>
              )}
              <p className="mt-3 text-xs tabular-nums text-slate-400">
                {format(clockNow, 'h:mm:ss a')}
              </p>
            </div>
            <div
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                locationLoading
                  ? 'border-slate-200 bg-slate-50 text-slate-600'
                  : location
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}
            >
              {locationLoading ? (
                <>
                  <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Getting location…
                </>
              ) : location ? (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Location ready
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  Unavailable
                </>
              )}
            </div>
          </div>

          {currentStatus === 'in' ? (
            <button
              type="button"
              onClick={handlePunch}
              disabled={loading || showPunchConfirm || showCashDialog}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-red-500 py-4 text-base font-semibold text-white shadow-sm shadow-red-100 transition-all duration-150 hover:bg-red-600 active:scale-[0.99] active:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              {loading ? (
                <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                  <path d="M5.25 3A2.25 2.25 0 003 5.25v9.5A2.25 2.25 0 005.25 17h9.5A2.25 2.25 0 0017 14.75v-9.5A2.25 2.25 0 0014.75 3h-9.5z" />
                </svg>
              )}
              {loading ? 'Processing…' : 'Clock Out'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePunch}
              disabled={loading || showPunchConfirm || showCashDialog}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-emerald-600 py-4 text-base font-semibold text-white shadow-sm shadow-emerald-200 transition-all duration-150 hover:bg-emerald-700 active:scale-[0.99] active:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              {loading ? (
                <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                </svg>
              )}
              {loading ? 'Processing…' : 'Clock In'}
            </button>
          )}
        </div>

        {message && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center text-sm text-emerald-700">
            {message}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Shift note — when clocked in and company has shift notes enabled */}
        {shiftNotesEnabled && currentStatus === 'in' && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Shift Note</h3>
                <p className="mt-0.5 text-xs text-slate-400">Auto-saved as you type</p>
              </div>
              <div className="flex items-center gap-3">
                {shiftNoteSaveStatus === 'saving' && (
                  <span className="flex items-center gap-1 text-xs text-slate-400">Saving…</span>
                )}
                {shiftNoteSaveStatus === 'saved' && shiftNoteSavedAt && (
                  <span className="flex items-center gap-1 text-xs text-emerald-600">
                    Saved {format(shiftNoteSavedAt, 'h:mm a')}
                  </span>
                )}
                <Link href="/shift-notes" className="text-xs font-medium text-blue-600 hover:text-blue-700 sm:text-sm">
                  Full notepad →
                </Link>
              </div>
            </div>
            {shiftNoteLoading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 w-1/3 rounded bg-slate-200" />
                <div className="h-24 rounded-xl bg-slate-100" />
              </div>
            ) : shiftNote ? (
              <textarea
                value={shiftNoteContent}
                onChange={(e) => setShiftNoteContent(e.target.value)}
                disabled={!shiftNote.can_edit}
                placeholder="Add notes about your shift..."
                rows={4}
                className="min-h-[100px] w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100"
              />
            ) : (
              <div className="text-sm text-slate-500">Shift note will appear here. If it doesn’t load, try refreshing.</div>
            )}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h3 className="text-sm font-semibold text-slate-900">Recent Entries</h3>
          </div>
          {loadingList ? (
            <div className="p-8 animate-pulse space-y-3">
              <div className="h-4 bg-slate-100 rounded w-full" />
              <div className="h-4 bg-slate-100 rounded w-full" />
              <div className="h-4 bg-slate-100 rounded w-5/6" />
            </div>
          ) : entries.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-slate-400">No entries yet</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between px-6 py-3.5 hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">{formatDate(entry)}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {formatTime(entry, 'clock_in_at')} → {formatTime(entry, 'clock_out_at')}
                    </p>
                  </div>
                  <div className="text-right">
                    {entry.clock_out_at && entry.rounded_hours != null && (
                      <span className="text-sm font-medium text-slate-700 tabular-nums">
                        {entry.rounded_hours.toFixed(1)}h
                      </span>
                    )}
                    {entry.clock_out_at == null && (
                      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        Active
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <ConfirmationDialog
          isOpen={showPunchConfirm}
          title={currentStatus === 'in' ? 'Clock out?' : 'Clock in?'}
          message={
            punchConfirmAfterCash
              ? currentStatus === 'in'
                ? 'Submit clock out with the cash amounts you entered?'
                : 'Submit clock in with the starting cash you entered?'
              : currentStatus === 'in'
                ? 'Confirm you want to clock out now.'
                : 'Confirm you want to clock in now.'
          }
          confirmText={currentStatus === 'in' ? 'Clock out' : 'Clock in'}
          cancelText="Cancel"
          onConfirm={confirmPunchIntent}
          onCancel={cancelPunchConfirm}
        />

        {/* Cash Drawer Dialog – same as PIN-based punch */}
        {showCashDialog && (
          <div className="fixed inset-0 z-[9999] flex h-full w-full items-center justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm">
            <div className="relative m-4 w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <h3 className="text-center text-lg font-semibold text-slate-900">
                {currentStatus === 'in' ? 'Ending cash count' : 'Starting cash count'}
              </h3>
              <p className="mb-6 mt-1 text-center text-sm text-slate-500">
                {currentStatus === 'in'
                  ? 'Enter all cash amounts for your shift.'
                  : 'Enter the starting cash amount in the drawer.'}
              </p>
              <div>
                {currentStatus === 'out' ? (
                  <div className="mb-6 space-y-5">
                    <div>
                      <label className="mb-1.5 block text-center text-sm font-medium text-slate-700">
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
                          className={`block w-full rounded-xl border py-3 pl-10 pr-4 text-center text-xl font-semibold text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                          className={`block w-full rounded-xl border py-2 pl-8 pr-3 text-sm text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                          className={`block w-full rounded-xl border py-2 pl-8 pr-3 text-sm text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                          className={`block w-full rounded-xl border py-2 pl-8 pr-3 text-sm text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                          className={`block w-full rounded-xl border py-2 pl-8 pr-3 text-sm text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
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
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? (
                      <>
                        <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
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
                    className="w-full py-2.5 text-sm text-slate-500 transition-colors hover:text-slate-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </Layout>
  )
}
