'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import ConfirmationDialog from '@/components/ConfirmationDialog'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import api from '@/lib/api'
import type { User } from '@/lib/auth'
import { addDays, format, parseISO } from 'date-fns'
import type { ShiftNoteCurrent } from '@/lib/shiftNotes'
import { toTime12h } from '@/lib/time'

type TimeEntry = {
  id: string
  clock_in_at: string
  clock_out_at: string | null
  clock_in_at_local?: string | null
  clock_out_at_local?: string | null
  rounded_hours?: number | null
  status?: string
}

type UpcomingShift = {
  id: string
  shift_date: string
  start_time: string
  end_time: string
  status: string
}

type MarketplaceSaleRow = {
  id: string
  label: string
  price_cents: number
  qty: number
}

type LastShiftSummary = {
  employee_name?: string
  is_own_shift?: boolean
  start_cash_cents: number
  end_cash_cents: number | null
  collected_cash_cents: number | null
  drop_amount_cents: number | null
  marketplace_sales_cents: number
  units_sold: number
  marketplace_sales?: MarketplaceSaleRow[]
  delta_cents: number | null
  clock_in_at: string | null
  clock_out_at: string | null
  ended_at: string | null
}

type ActiveDrawerInfo = {
  employee_id: string
  employee_name: string
  is_mine: boolean
}

type MarketplaceState = {
  items: { id: string; label: string; price_cents: number }[]
  sales: MarketplaceSaleRow[]
  total_cents: number
  units_sold?: number
  start_cash_cents?: number | null
  last_shift?: LastShiftSummary | null
  active_drawer?: ActiveDrawerInfo | null
  clocked_in: boolean
}

/** Distinct button colors — assigned uniquely per marketplace item (no repeats in view). */
const MARKETPLACE_BUTTON_COLORS = [
  'border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100',
  'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100',
  'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100',
  'border-rose-300 bg-rose-50 text-rose-900 hover:bg-rose-100',
  'border-teal-300 bg-teal-50 text-teal-900 hover:bg-teal-100',
  'border-indigo-300 bg-indigo-50 text-indigo-900 hover:bg-indigo-100',
  'border-orange-300 bg-orange-50 text-orange-900 hover:bg-orange-100',
  'border-cyan-300 bg-cyan-50 text-cyan-900 hover:bg-cyan-100',
  'border-lime-300 bg-lime-50 text-lime-900 hover:bg-lime-100',
  'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-900 hover:bg-fuchsia-100',
  'border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100',
  'border-red-300 bg-red-50 text-red-900 hover:bg-red-100',
  'border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100',
  'border-yellow-300 bg-yellow-50 text-yellow-900 hover:bg-yellow-100',
  'border-slate-300 bg-slate-100 text-slate-900 hover:bg-slate-200',
  'border-pink-300 bg-pink-50 text-pink-900 hover:bg-pink-100',
] as const

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function assignMarketplaceButtonColors(itemIds: string[]): Record<string, string> {
  const colors = [...MARKETPLACE_BUTTON_COLORS]
  let seed = hashSeed(itemIds.slice().sort().join('|') || 'marketplace')
  for (let i = colors.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const j = seed % (i + 1)
    const tmp = colors[i]
    colors[i] = colors[j]
    colors[j] = tmp
  }
  const map: Record<string, string> = {}
  itemIds.forEach((id, index) => {
    if (index < colors.length) {
      map[id] = colors[index]
      return
    }
    // Extra items beyond the palette: unique HSL tints (still no class reuse)
    const hue = (hashSeed(id) * 47) % 360
    map[id] =
      `border-transparent text-slate-900 hover:brightness-95 [background-color:hsl(${hue}_70%_88%)] [border-color:hsl(${hue}_45%_70%)]`
  })
  return map
}

function CashInfoLabel({
  label,
  hint,
  required = false,
}: {
  label: string
  hint: string
  required?: boolean
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      <Tooltip content={hint} side="top" variant="surface">
        <button
          type="button"
          className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-[9px] font-semibold leading-none text-slate-500 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700"
          aria-label={`About ${label}`}
        >
          i
        </button>
      </Tooltip>
    </div>
  )
}

interface PunchInOutPanelProps {
  user: User
  /** Tighter layout for embedding on the dashboard */
  compact?: boolean
}

export default function PunchInOutPanel({ user, compact = false }: PunchInOutPanelProps) {
  const [currentStatus, setCurrentStatus] = useState<'in' | 'out' | null>(null)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [shifts, setShifts] = useState<UpcomingShift[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingSchedule, setLoadingSchedule] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cashDrawerRequired, setCashDrawerRequired] = useState(false)
  const [geofenceRequired, setGeofenceRequired] = useState(false)
  const [shiftNotesEnabled, setShiftNotesEnabled] = useState(true)
  const [cashAmount, setCashAmount] = useState('')
  const [collectedCash, setCollectedCash] = useState('')
  const [dropAmount, setDropAmount] = useState('')
  const [marketplace, setMarketplace] = useState<MarketplaceState | null>(null)
  const [marketplaceBusyId, setMarketplaceBusyId] = useState<string | null>(null)
  const [cashError, setCashError] = useState<string | null>(null)
  const [showCashDialog, setShowCashDialog] = useState(false)
  const [showPunchConfirm, setShowPunchConfirm] = useState(false)
  const [punchConfirmAfterCash, setPunchConfirmAfterCash] = useState(false)
  const [pendingPunch, setPendingPunch] = useState(false)
  /** When true, punch payload includes cash amounts (this user owns/activates the drawer). */
  const [includeCashOnPunch, setIncludeCashOnPunch] = useState(false)
  /** Shown when clocking in while another FD already has the drawer open. */
  const [drawerActiveNote, setDrawerActiveNote] = useState<string | null>(null)
  const [location, setLocation] = useState<{ latitude: string; longitude: string } | null>(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [clockNow, setClockNow] = useState(() => new Date())
  const [activeClockInAt, setActiveClockInAt] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => setClockNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const [shiftNote, setShiftNote] = useState<ShiftNoteCurrent | null>(null)
  const [shiftNoteContent, setShiftNoteContent] = useState('')
  const [shiftNoteLoading, setShiftNoteLoading] = useState(false)
  const [shiftNoteSaveStatus, setShiftNoteSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [shiftNoteSavedAt, setShiftNoteSavedAt] = useState<Date | null>(null)
  const shiftNoteSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedContentRef = useRef('')
  const SHIFT_NOTE_DEBOUNCE_MS = 800

  const fetchMarketplace = useCallback(async () => {
    if (user.role !== 'FRONTDESK') {
      setMarketplace(null)
      return
    }
    try {
      const res = await api.get('/cash-drawer/marketplace')
      setMarketplace(res.data as MarketplaceState)
    } catch {
      setMarketplace(null)
    }
  }, [user.role])

  // Keep marketplace + last-shift summary fresh for Front Desk
  useEffect(() => {
    if (user.role !== 'FRONTDESK') return
    void fetchMarketplace()
    const onFocus = () => void fetchMarketplace()
    window.addEventListener('focus', onFocus)
    const id = window.setInterval(() => {
      if (currentStatus === 'in') void fetchMarketplace()
    }, 15000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(id)
    }
  }, [user.role, currentStatus, fetchMarketplace])

  const fetchStatusAndEntries = useCallback(async () => {
    try {
      const res = await api.get('/time/my?limit=8')
      const list = res.data?.entries ?? []
      const hasOpen = list.length > 0 && !list[0].clock_out_at
      setCurrentStatus(hasOpen ? 'in' : 'out')
      setActiveClockInAt(hasOpen ? list[0].clock_in_at : null)
      setEntries(list)
      if (user.role === 'FRONTDESK') {
        void fetchMarketplace()
      }
    } catch {
      setEntries([])
      setCurrentStatus('out')
      setActiveClockInAt(null)
    } finally {
      setLoadingList(false)
    }
  }, [fetchMarketplace, user.role])

  const fetchUpcomingShifts = useCallback(async () => {
    setLoadingSchedule(true)
    try {
      const start = format(new Date(), 'yyyy-MM-dd')
      const end = format(addDays(new Date(), 7), 'yyyy-MM-dd')
      const res = await api.get(`/shifts?start_date=${start}&end_date=${end}`)
      const list = (res.data || []) as UpcomingShift[]
      setShifts(list.slice(0, 6))
    } catch {
      setShifts([])
    } finally {
      setLoadingSchedule(false)
    }
  }, [])

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
  }, [shiftNoteContent, shiftNote?.can_edit, saveShiftNote, shiftNoteSaveStatus])

  useEffect(() => {
    if (!navigator.geolocation) return
    setLocationLoading(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude.toString(),
          longitude: position.coords.longitude.toString(),
        })
        setLocationLoading(false)
      },
      () => setLocationLoading(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }, [])

  const applyCompanySettings = useCallback(
    (settings: Record<string, unknown>) => {
      const cashEnabled = settings.cash_drawer_enabled === true
      const requiredForAll = settings.cash_drawer_required_for_all === true
      const requiredRoles = (settings.cash_drawer_required_roles as string[] | undefined) || [
        'FRONTDESK',
      ]
      const cashRequired =
        cashEnabled && (requiredForAll || requiredRoles.includes(user.role))
      setCashDrawerRequired(cashRequired)
      setGeofenceRequired(settings.geofence_enabled === true)
      setShiftNotesEnabled(settings.shift_notes_enabled !== false)
      return cashRequired
    },
    [user.role],
  )

  const refreshPunchSettings = useCallback(async (): Promise<boolean> => {
    try {
      const companyRes = await api.get('/company/info')
      return applyCompanySettings(companyRes.data?.settings || {})
    } catch {
      // Keep last known cash requirement — don't silently disable it
      return cashDrawerRequired
    }
  }, [applyCompanySettings, cashDrawerRequired])

  useEffect(() => {
    const load = async () => {
      try {
        const companyRes = await api.get('/company/info')
        applyCompanySettings(companyRes.data?.settings || {})
      } catch {
        // Retry once after a short delay (covers access-token refresh races)
        try {
          await new Promise((r) => setTimeout(r, 400))
          const companyRes = await api.get('/company/info')
          applyCompanySettings(companyRes.data?.settings || {})
        } catch {
          // FRONTDESK commonly requires cash; prefer prompting over a blind 400
          if (user.role === 'FRONTDESK') {
            setCashDrawerRequired(true)
          }
        }
      }
      await fetchStatusAndEntries()
      await fetchUpcomingShifts()
    }
    void load()
  }, [user.role, applyCompanySettings, fetchStatusAndEntries, fetchUpcomingShifts])

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
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 },
      )
    })
  }

  const marketplaceRows: MarketplaceSaleRow[] =
    marketplace?.sales?.length
      ? marketplace.sales
      : (marketplace?.items || []).map((item) => ({
          id: item.id,
          label: item.label,
          price_cents: item.price_cents,
          qty: 0,
        }))
  const marketplaceConfigured = marketplaceRows.length > 0
  const marketplaceTotalCents =
    marketplace?.total_cents ??
    marketplaceRows.reduce((sum, row) => sum + row.qty * row.price_cents, 0)
  const lastShift = marketplace?.last_shift ?? null
  const expectedStartCashCents =
    lastShift?.end_cash_cents != null ? lastShift.end_cash_cents : null
  const enteredStartCashCents = (() => {
    const n = parseFloat(cashAmount)
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
  })()
  const startCashMismatch =
    currentStatus === 'out' &&
    expectedStartCashCents != null &&
    enteredStartCashCents != null &&
    enteredStartCashCents !== expectedStartCashCents
  const marketplaceRowIdsKey = marketplaceRows.map((row) => row.id).join(',')
  const marketplaceButtonColors = useMemo(
    () => assignMarketplaceButtonColors(marketplaceRowIdsKey ? marketplaceRowIdsKey.split(',') : []),
    [marketplaceRowIdsKey]
  )

  const ownsActiveDrawer = Boolean(
    marketplace?.active_drawer?.is_mine || marketplace?.clocked_in
  )
  const drawerHeldByOther =
    marketplace?.active_drawer && !marketplace.active_drawer.is_mine
      ? marketplace.active_drawer.employee_name
      : null

  const formatCurrencyCents = (cents: number) => `$${(cents / 100).toFixed(2)}`

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
        includeCashOnPunch && cashDrawerRequired && currentStatus === 'out'
          ? Math.round(parseFloat(cashAmount || '0') * 100)
          : undefined
      const cashEndCents =
        includeCashOnPunch && cashDrawerRequired && currentStatus === 'in'
          ? Math.round(parseFloat(cashAmount || '0') * 100)
          : undefined
      const collectedCashCents =
        includeCashOnPunch && cashDrawerRequired && currentStatus === 'in'
          ? Math.round(parseFloat(collectedCash || '0') * 100)
          : undefined
      const dropAmountCents =
        includeCashOnPunch && cashDrawerRequired && currentStatus === 'in'
          ? Math.round(parseFloat(dropAmount || '0') * 100)
          : undefined
      const marketplaceSalesCents =
        includeCashOnPunch &&
        cashDrawerRequired &&
        currentStatus === 'in' &&
        marketplaceConfigured
          ? marketplaceTotalCents
          : undefined
      const res = await api.post('/time/punch-me-simple', {
        cash_start_cents: cashStartCents,
        cash_end_cents: cashEndCents,
        collected_cash_cents: collectedCashCents,
        drop_amount_cents: dropAmountCents,
        beverages_cash_cents: marketplaceSalesCents,
        latitude: currentLocation?.latitude,
        longitude: currentLocation?.longitude,
      })
      const entry = res.data
      if (entry.clock_out_at) {
        setMessage(`Clocked out at ${format(new Date(entry.clock_out_at), 'MMM d, h:mm a')}`)
        setCurrentStatus('out')
        setActiveClockInAt(null)
      } else {
        const joinNote = drawerActiveNote
          ? ` Cash drawer is already activated by ${drawerActiveNote}.`
          : ''
        setMessage(
          `Clocked in at ${format(new Date(entry.clock_in_at), 'MMM d, h:mm a')}.${joinNote}`
        )
        setCurrentStatus('in')
        setActiveClockInAt(entry.clock_in_at)
      }
      setCashAmount('')
      setCashError(null)
      setPendingPunch(false)
      setIncludeCashOnPunch(false)
      setDrawerActiveNote(null)
      await fetchStatusAndEntries()
      setTimeout(() => setMessage(null), 5000)
    } catch (err: unknown) {
      const ax = err as {
        response?: { data?: { detail?: string | { message?: string } | Array<{ msg?: string }> } }
      }
      const detail = ax.response?.data?.detail
      let errorMessage = 'Punch failed. Please try again.'
      if (typeof detail === 'string') {
        errorMessage = detail
      } else if (Array.isArray(detail)) {
        errorMessage = detail.map((d) => d.msg).filter(Boolean).join(' ') || errorMessage
      } else if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
        errorMessage = detail.message
      }
      if (errorMessage.toLowerCase().includes('already activated')) {
        const match = errorMessage.match(/activated by ([^.]+)/i)
        setIncludeCashOnPunch(false)
        setDrawerActiveNote(match?.[1]?.trim() || 'another employee')
        setPendingPunch(true)
        setShowCashDialog(false)
        setPunchConfirmAfterCash(false)
        setShowPunchConfirm(true)
        setError(null)
      } else if (errorMessage.toLowerCase().includes('cash')) {
        setCashDrawerRequired(true)
        setIncludeCashOnPunch(true)
        setPendingPunch(true)
        setShowCashDialog(true)
        setCashAmount('')
        setCollectedCash('')
        setDropAmount('')
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
  }, [
    location,
    geofenceRequired,
    cashDrawerRequired,
    includeCashOnPunch,
    drawerActiveNote,
    currentStatus,
    cashAmount,
    collectedCash,
    dropAmount,
    marketplaceConfigured,
    marketplaceTotalCents,
    fetchStatusAndEntries,
  ])

  const handlePunch = async () => {
    if (loading || showPunchConfirm || showCashDialog) return
    setError(null)
    setMessage(null)
    setDrawerActiveNote(null)
    setIncludeCashOnPunch(false)
    // Refresh settings so cash drawer prompt isn't skipped after a failed company/info load
    const cashRequired = await refreshPunchSettings()
    if (cashRequired) {
      let needsCashEntry = true
      let activeByOther: string | null = null
      try {
        const res = await api.get('/cash-drawer/active')
        const active = res.data?.active_drawer as ActiveDrawerInfo | null | undefined
        const owns = Boolean(res.data?.owns_active_drawer)
        if (currentStatus === 'out') {
          // Clock-in: skip cash if another employee already activated the drawer
          if (active && !active.is_mine) {
            needsCashEntry = false
            activeByOther = active.employee_name || 'another employee'
          }
        } else {
          // Clock-out: only drawer owner enters ending cash
          needsCashEntry = owns
        }
      } catch {
        // Fall back to requiring cash when status cannot be loaded
        needsCashEntry = true
      }

      if (!needsCashEntry) {
        setPendingPunch(true)
        setIncludeCashOnPunch(false)
        if (activeByOther) {
          setDrawerActiveNote(activeByOther)
        }
        setPunchConfirmAfterCash(false)
        setShowPunchConfirm(true)
        return
      }

      setPendingPunch(true)
      setIncludeCashOnPunch(true)
      setShowCashDialog(true)
      setCashAmount('')
      setCollectedCash('')
      setDropAmount('')
      setCashError(null)
      // Always refresh last-shift balance before clock-in / sales total before clock-out
      if (user.role === 'FRONTDESK') {
        void fetchMarketplace()
      }
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
    } else {
      setPendingPunch(false)
      setIncludeCashOnPunch(false)
      setDrawerActiveNote(null)
    }
  }

  const adjustMarketplaceQty = async (itemId: string, delta: number) => {
    if (marketplaceBusyId) return
    const prev = marketplace
    if (prev) {
      const nextSales = prev.sales.map((s) =>
        s.id === itemId ? { ...s, qty: Math.max(0, s.qty + delta) } : s
      )
      const total_cents = nextSales.reduce((sum, s) => sum + s.qty * s.price_cents, 0)
      setMarketplace({ ...prev, sales: nextSales, total_cents })
    }
    setMarketplaceBusyId(itemId)
    try {
      const res = await api.put('/cash-drawer/marketplace', { item_id: itemId, delta })
      setMarketplace(res.data as MarketplaceState)
    } catch {
      if (prev) setMarketplace(prev)
      setError('Could not update marketplace sale. Try again.')
    } finally {
      setMarketplaceBusyId(null)
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
      if (isNaN(collectedValue) || collectedValue < 0) {
        setCashError('Please enter a valid collected cash amount')
        return
      }
      if (isNaN(dropValue) || dropValue < 0) {
        setCashError('Please enter a valid drop amount')
        return
      }
    }
    setCashError(null)
    setShowCashDialog(false)
    setIncludeCashOnPunch(true)
    setPunchConfirmAfterCash(true)
    setShowPunchConfirm(true)
  }

  const handleCashDialogCancel = () => {
    setShowCashDialog(false)
    setPendingPunch(false)
    setPunchConfirmAfterCash(false)
    setIncludeCashOnPunch(false)
    setDrawerActiveNote(null)
    setCashAmount('')
    setCollectedCash('')
    setDropAmount('')
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

  const formatShiftTime = (timeStr: string) => {
    const t = toTime12h(timeStr)
    const m = String(t.minute).padStart(2, '0')
    return `${t.hour12}:${m} ${t.ampm}`
  }

  const formatElapsed = (clockInAt: string, now: Date) => {
    const start = new Date(clockInAt).getTime()
    if (Number.isNaN(start)) return '0:00:00'
    const totalSec = Math.max(0, Math.floor((now.getTime() - start) / 1000))
    const hours = Math.floor(totalSec / 3600)
    const minutes = Math.floor((totalSec % 3600) / 60)
    const seconds = totalSec % 60
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${hours}:${pad(minutes)}:${pad(seconds)}`
  }

  return (
    <div className="space-y-4">
      {!compact && (
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Punch In / Out</h2>
          <p className="mt-0.5 text-sm text-slate-500">Clock in or out and review your day</p>
        </div>
      )}

      {geofenceRequired && (
        <p className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-sm text-amber-800">
          Punch in/out is only allowed when you are at the office.
        </p>
      )}

      {/* Top row — Punch in / out */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-5">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Punch in / out</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              {currentStatus === 'in' ? (
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  <span className="text-lg font-semibold tracking-tight text-slate-900">Clocked in</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-slate-300" />
                  <span className="text-lg font-semibold tracking-tight text-slate-900">Clocked out</span>
                </div>
              )}
              {currentStatus === 'in' && activeClockInAt ? (
                <span className="text-sm font-medium tabular-nums text-emerald-700" title="Time since clock in">
                  {formatElapsed(activeClockInAt, clockNow)}
                </span>
              ) : null}
              <span
                className={`text-xs ${
                  locationLoading ? 'text-slate-400' : location ? 'text-emerald-600' : 'text-amber-600'
                }`}
              >
                {locationLoading ? 'Finding you…' : location ? 'At location' : 'No location'}
              </span>
            </div>
          </div>

          {currentStatus === 'in' ? (
            <button
              type="button"
              onClick={handlePunch}
              disabled={loading || showPunchConfirm || showCashDialog}
              className="w-full shrink-0 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-slate-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto sm:min-w-[140px]"
            >
              {loading ? 'Processing…' : 'Clock out'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePunch}
              disabled={loading || showPunchConfirm || showCashDialog || currentStatus === null}
              className="w-full shrink-0 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto sm:min-w-[140px]"
            >
              {loading ? 'Processing…' : 'Clock in'}
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 p-2.5 text-center text-sm text-emerald-700">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50/90 p-2.5 text-center text-sm text-red-600">
          {error}
        </div>
      )}

      {user.role === 'FRONTDESK' &&
        currentStatus === 'in' &&
        marketplaceConfigured &&
        ownsActiveDrawer && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
              {/* Left — sales list */}
              <div>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">Total:</h3>
                  <p className="text-sm font-semibold tabular-nums text-slate-900">
                    {formatCurrencyCents(marketplaceTotalCents)}
                  </p>
                </div>
                <ul className="space-y-1.5">
                  {marketplaceRows.map((item) => (
                    <li
                      key={`line-${item.id}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 text-sm text-slate-700"
                    >
                      <span className="truncate font-medium text-slate-800">
                        {item.label}
                        <span className="ml-1 font-normal tabular-nums text-slate-400">
                          ({item.qty})
                        </span>
                      </span>
                      <span className="tabular-nums text-slate-500">
                        {formatCurrencyCents(item.price_cents * item.qty)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={marketplaceBusyId === item.id || item.qty <= 0}
                        onClick={() => void adjustMarketplaceQty(item.id, -1)}
                        aria-label={`Decrease ${item.label}`}
                        className="h-7 w-7 shrink-0 px-0"
                      >
                        −
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Right — add buttons */}
              <div className="sm:border-l sm:border-slate-200 sm:pl-6">
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Marketplace</h3>
                <div className="flex flex-wrap gap-2">
                  {marketplaceRows.map((item) => (
                    <button
                      key={`btn-${item.id}`}
                      type="button"
                      disabled={marketplaceBusyId === item.id}
                      onClick={() => void adjustMarketplaceQty(item.id, 1)}
                      className={`inline-flex h-8 items-center justify-center rounded-lg border px-3 text-xs font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${
                        marketplaceButtonColors[item.id] ||
                        'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Last shift summary */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Last shift
            </p>
            {lastShift ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
                  <p className="text-xs text-slate-500">Drawer balance</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-slate-900">
                    {lastShift.end_cash_cents != null
                      ? formatCurrencyCents(lastShift.end_cash_cents)
                      : '—'}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
                  <p className="text-xs text-slate-500">Sales</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-slate-900">
                    {formatCurrencyCents(lastShift.marketplace_sales_cents)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">No previous shift yet.</p>
            )}
          </div>
        </div>
      )}

      {user.role === 'FRONTDESK' &&
        currentStatus === 'in' &&
        drawerHeldByOther &&
        !ownsActiveDrawer && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm text-slate-600">
            Cash drawer is already activated by{' '}
            <span className="font-medium text-slate-800">{drawerHeldByOther}</span>. Marketplace
            sales are managed on their shift.
          </div>
        )}

      {user.role === 'FRONTDESK' && currentStatus === 'in' && !marketplaceConfigured && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-500">
          Marketplace buttons appear here after an admin adds items in Settings → Cash Drawer.
        </div>
      )}

      {shiftNotesEnabled && currentStatus === 'in' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Shift note</h3>
              <p className="mt-0.5 text-xs text-slate-400">Saves as you type</p>
            </div>
            <div className="flex items-center gap-3">
              {shiftNoteSaveStatus === 'saving' && (
                <span className="text-xs text-slate-400">Saving…</span>
              )}
              {shiftNoteSaveStatus === 'saved' && shiftNoteSavedAt && (
                <span className="text-xs text-emerald-600">Saved {format(shiftNoteSavedAt, 'h:mm a')}</span>
              )}
              <Link href="/shift-notes" className="text-xs font-medium text-blue-600 hover:text-blue-700">
                Full notepad →
              </Link>
            </div>
          </div>
          {shiftNoteLoading ? (
            <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
          ) : shiftNote ? (
            <textarea
              value={shiftNoteContent}
              onChange={(e) => setShiftNoteContent(e.target.value)}
              disabled={!shiftNote.can_edit}
              placeholder="Add notes about your shift..."
              rows={2}
              className="min-h-[72px] w-full resize-none rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
          ) : (
            <p className="text-sm text-slate-500">Shift note will appear here after refresh if it doesn’t load.</p>
          )}
        </div>
      )}

      {/* Bottom row — Recent activity | Schedule */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex min-h-[260px] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
            <h3 className="text-sm font-semibold text-slate-900">Recent activity</h3>
          </div>
          <div className="flex-1">
            {loadingList ? (
              <div className="space-y-3 p-5 animate-pulse">
                <div className="h-4 w-full rounded bg-slate-100" />
                <div className="h-4 w-4/5 rounded bg-slate-100" />
                <div className="h-4 w-3/5 rounded bg-slate-100" />
              </div>
            ) : entries.length === 0 ? (
              <div className="flex h-full items-center justify-center px-4 py-10 text-center">
                <p className="text-sm text-slate-400">No punches yet</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {entries.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{formatDate(entry)}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-slate-400">
                        {formatTime(entry, 'clock_in_at')}
                        <span className="mx-1 text-slate-300">→</span>
                        {formatTime(entry, 'clock_out_at')}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {entry.clock_out_at && entry.rounded_hours != null && (
                        <span className="text-sm font-medium tabular-nums text-slate-600">
                          {entry.rounded_hours.toFixed(1)}h
                        </span>
                      )}
                      {entry.clock_out_at == null && (
                        <span className="text-xs font-medium text-emerald-600">Active</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex min-h-[260px] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
            <h3 className="text-sm font-semibold text-slate-900">Schedule</h3>
            <Link href="/my-schedule" className="text-xs font-medium text-blue-600 hover:text-blue-700">
              View all
            </Link>
          </div>
          <div className="flex-1">
            {loadingSchedule ? (
              <div className="space-y-3 p-5 animate-pulse">
                <div className="h-4 w-full rounded bg-slate-100" />
                <div className="h-4 w-4/5 rounded bg-slate-100" />
                <div className="h-4 w-3/5 rounded bg-slate-100" />
              </div>
            ) : shifts.length === 0 ? (
              <div className="flex h-full items-center justify-center px-4 py-10 text-center">
                <p className="text-sm text-slate-400">No shifts in the next 7 days</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {shifts.map((shift) => {
                  let dayLabel = shift.shift_date
                  try {
                    dayLabel = format(parseISO(shift.shift_date), 'EEE, MMM d')
                  } catch {
                    /* keep raw */
                  }
                  return (
                    <li key={shift.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{dayLabel}</p>
                        <p className="mt-0.5 text-xs tabular-nums text-slate-400">
                          {formatShiftTime(shift.start_time)}
                          <span className="mx-1 text-slate-300">→</span>
                          {formatShiftTime(shift.end_time)}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs capitalize text-slate-400">{shift.status}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <ConfirmationDialog
        isOpen={showPunchConfirm}
        title={currentStatus === 'in' ? 'Clock out?' : 'Clock in?'}
        message={
          drawerActiveNote && currentStatus === 'out'
            ? `Cash drawer is already activated by ${drawerActiveNote}. You can clock in without entering cash.`
            : punchConfirmAfterCash
              ? currentStatus === 'in'
                ? 'Submit with the cash amounts you entered?'
                : 'Submit with the starting cash you entered?'
              : currentStatus === 'in'
                ? 'End your shift now.'
                : 'Start your shift now.'
        }
        confirmText={currentStatus === 'in' ? 'Clock out' : 'Clock in'}
        cancelText="Cancel"
        onConfirm={confirmPunchIntent}
        onCancel={cancelPunchConfirm}
      />

      {showCashDialog &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex h-full w-full items-center justify-center overflow-y-auto bg-black/40 p-4">
            <div className="relative m-4 w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
              <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
                <h3 className="text-lg font-semibold text-slate-900">
                  {currentStatus === 'in' ? 'Ending cash count' : 'Starting cash count'}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {currentStatus === 'in'
                    ? 'Enter cash amounts for your shift.'
                    : 'Enter the starting cash in the drawer.'}
                </p>
              </div>

              <div className="space-y-4 px-5 py-5 sm:px-6">
                {currentStatus === 'out' ? (
                  <div className="space-y-4">
                    {expectedStartCashCents != null && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-xs font-medium text-slate-500">Previous shift ending balance</p>
                        <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
                          {formatCurrencyCents(expectedStartCashCents)}
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_9.5rem] sm:gap-4">
                      <CashInfoLabel
                        label="Starting cash"
                        hint="Cash amount in the drawer when you clock in"
                        required
                      />
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-slate-400">
                          $
                        </span>
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
                          className={`block w-full rounded-xl border py-2.5 pl-7 pr-3 text-sm font-semibold tabular-nums text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            cashError || startCashMismatch ? 'border-amber-400' : 'border-slate-200'
                          }`}
                          placeholder="0.00"
                          disabled={loading}
                        />
                      </div>
                    </div>
                    {startCashMismatch && (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
                        Amount does not match previous balance. If you continue, a warning will be sent to the manager.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {(
                      [
                        {
                          label: 'Collected cash',
                          value: collectedCash,
                          set: setCollectedCash,
                          hint: 'Total cash collected from customers',
                        },
                        {
                          label: 'Drop amount',
                          value: dropAmount,
                          set: setDropAmount,
                          hint: 'Cash removed from drawer during shift',
                        },
                        {
                          label: 'Cash in drawer',
                          value: cashAmount,
                          set: setCashAmount,
                          hint: 'Final cash remaining in drawer',
                        },
                      ] as Array<{
                        label: string
                        value: string
                        set: (v: string) => void
                        hint: string
                      }>
                    ).map((field) => (
                      <div
                        key={field.label}
                        className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_9.5rem] sm:gap-4"
                      >
                        <CashInfoLabel label={field.label} hint={field.hint} required />
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-slate-400">
                            $
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={field.value}
                            onChange={(e) => {
                              field.set(e.target.value)
                              setCashError(null)
                            }}
                            className={`block w-full rounded-xl border py-2.5 pl-7 pr-3 text-sm tabular-nums text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                              cashError ? 'border-red-300' : 'border-slate-200'
                            }`}
                            placeholder="0.00"
                            disabled={loading}
                          />
                        </div>
                      </div>
                    ))}

                    {marketplaceConfigured && (
                      <div className="grid grid-cols-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_9.5rem] sm:gap-4">
                        <CashInfoLabel
                          label="Marketplace sales"
                          hint="From dashboard item counts (read-only)"
                        />
                        <p className="text-right text-sm font-semibold tabular-nums text-slate-900 sm:pr-1">
                          {formatCurrencyCents(marketplaceTotalCents)}
                        </p>
                      </div>
                    )}
                  </>
                )}

                {cashError && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-600">
                    {cashError}
                  </p>
                )}
              </div>

              <div className="space-y-2 border-t border-slate-100 px-5 py-4 sm:px-6">
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
                        parseFloat(dropAmount) < 0))
                  }
                  className="flex w-full items-center justify-center rounded-xl bg-blue-600 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Processing…' : 'Continue'}
                </button>
                <button
                  type="button"
                  onClick={handleCashDialogCancel}
                  disabled={loading}
                  className="w-full py-2.5 text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
