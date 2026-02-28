'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser, User } from '@/lib/auth'
import { format } from 'date-fns'

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
        } catch {
          setCashDrawerRequired(false)
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
      const ax = err as { response?: { data?: { detail?: string } } }
      const detail = ax.response?.data?.detail
      const errorMessage = typeof detail === 'string' ? detail : 'Punch failed. Please try again.'
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
  }, [location, cashDrawerRequired, currentStatus, cashAmount, collectedCash, dropAmount, beveragesCash, fetchStatusAndEntries])

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
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-6 lg:px-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Punch In / Out</h1>
        <p className="text-sm text-gray-600 mb-4">{user.name}</p>

        {/* Location status */}
        <div
          className={`mb-4 rounded-lg p-3 border flex items-center justify-center gap-2 text-sm ${
            locationLoading
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : location
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-gray-50 border-gray-200 text-gray-600'
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

        {/* Status & Button */}
        <div
          className={`rounded-xl border-2 p-6 mb-6 text-center ${
            currentStatus === 'in' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <p className="text-sm font-medium text-gray-600 mb-1">
            {currentStatus === 'in' ? 'Currently clocked in' : 'Currently clocked out'}
          </p>
          <button
            type="button"
            onClick={handlePunch}
            disabled={loading}
            className={`mt-4 w-full max-w-xs mx-auto py-4 px-6 rounded-xl font-semibold text-white shadow-md hover:opacity-95 disabled:opacity-60 disabled:cursor-not-allowed transition ${
              currentStatus === 'in' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Processing...
              </span>
            ) : currentStatus === 'in' ? 'Clock Out' : 'Clock In'}
          </button>
        </div>

        {message && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-800 border border-green-200 text-center text-sm">
            {message}
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 border border-red-200 text-center text-sm">
            {error}
          </div>
        )}

        {/* Last 10 time entries */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-900">Past 10 time entries</h2>
          </div>
          {loadingList ? (
            <div className="p-8 flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : entries.length === 0 ? (
            <div className="p-6 text-center text-gray-500 text-sm">No time entries yet.</div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {entries.map((entry) => (
                <li key={entry.id} className="px-4 py-3 flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium text-gray-900">{formatDate(entry)}</span>
                    <span className="text-gray-500 ml-2">
                      {formatTime(entry, 'clock_in_at')} – {formatTime(entry, 'clock_out_at')}
                    </span>
                  </div>
                  {entry.clock_out_at && entry.rounded_hours != null && (
                    <span className="text-gray-500 tabular-nums">{entry.rounded_hours.toFixed(1)}h</span>
                  )}
                  {entry.clock_out_at == null && <span className="text-amber-600 font-medium">Open</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Cash Drawer Dialog – same as PIN-based punch */}
        {showCashDialog && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm overflow-y-auto h-full w-full z-[9999] flex items-center justify-center p-4">
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg m-4">
              <div className="px-8 pt-8 pb-6 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-t-2xl border-b border-gray-100">
                <div className="flex items-center justify-center mb-3">
                  <div className="p-3 bg-blue-100 rounded-full">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 text-center mb-2">
                  {currentStatus === 'in' ? 'Ending Cash Count' : 'Starting Cash Count'}
                </h3>
                <p className="text-sm text-gray-600 text-center">
                  {currentStatus === 'in'
                    ? 'Enter all cash amounts for your shift'
                    : 'Enter the starting cash amount in the drawer'}
                </p>
              </div>
              <div className="p-8">
                {currentStatus === 'out' ? (
                  /* Clock-in: only starting cash */
                  <div className="mb-8">
                    <label className="block text-sm font-semibold text-gray-700 mb-4 text-center">
                      Starting Cash Amount <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                        <span className="text-gray-400 text-2xl font-medium">$</span>
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
                        className={`block w-full pl-12 pr-5 py-5 border-2 rounded-xl text-center text-3xl font-bold focus:outline-none focus:ring-4 focus:ring-blue-100 ${
                          cashError ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 focus:border-blue-500'
                        }`}
                        placeholder="0.00"
                        disabled={loading}
                      />
                    </div>
                    {cashError && (
                      <div className="mt-3 flex items-center justify-center gap-2 text-sm text-red-600">
                        <span>{cashError}</span>
                      </div>
                    )}
                    <p className="mt-3 text-xs text-gray-500 text-center">Enter the amount in dollars (e.g., 100.50)</p>
                  </div>
                ) : (
                  /* Clock-out: collected cash, beverages sold, cash in drawer */
                  <div className="space-y-6 mb-8">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-3">
                        Collected Cash Amount <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <span className="text-gray-400 text-xl font-medium">$</span>
                        </div>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={collectedCash}
                          onChange={(e) => {
                            setCollectedCash(e.target.value)
                            setCashError(null)
                          }}
                          className={`block w-full pl-10 pr-4 py-4 border-2 rounded-xl text-lg font-semibold focus:outline-none focus:ring-4 focus:ring-blue-100 ${
                            cashError ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 focus:border-blue-500'
                          }`}
                          placeholder="0.00"
                          disabled={loading}
                        />
                      </div>
                      <p className="mt-2 text-xs text-gray-500">Total cash collected from customers</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-3">
                        Drop Amount <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <span className="text-gray-400 text-xl font-medium">$</span>
                        </div>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={dropAmount}
                          onChange={(e) => {
                            setDropAmount(e.target.value)
                            setCashError(null)
                          }}
                          className={`block w-full pl-10 pr-4 py-4 border-2 rounded-xl text-lg font-semibold focus:outline-none focus:ring-4 focus:ring-blue-100 ${
                            cashError ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 focus:border-blue-500'
                          }`}
                          placeholder="0.00"
                          disabled={loading}
                        />
                      </div>
                      <p className="mt-2 text-xs text-gray-500">Cash removed/dropped from drawer during shift</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-3">
                        Beverages Sold (Total) <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <span className="text-gray-400 text-xl font-medium">$</span>
                        </div>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={beveragesCash}
                          onChange={(e) => {
                            setBeveragesCash(e.target.value)
                            setCashError(null)
                          }}
                          className={`block w-full pl-10 pr-4 py-4 border-2 rounded-xl text-lg font-semibold focus:outline-none focus:ring-4 focus:ring-blue-100 ${
                            cashError ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 focus:border-blue-500'
                          }`}
                          placeholder="0.00"
                          disabled={loading}
                        />
                      </div>
                      <p className="mt-2 text-xs text-gray-500">Total beverage sales during shift (all payment types)</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-3">
                        Cash in Drawer <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <span className="text-gray-400 text-xl font-medium">$</span>
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
                          className={`block w-full pl-10 pr-4 py-4 border-2 rounded-xl text-lg font-semibold focus:outline-none focus:ring-4 focus:ring-blue-100 ${
                            cashError ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 focus:border-blue-500'
                          }`}
                          placeholder="0.00"
                          disabled={loading}
                        />
                      </div>
                      <p className="mt-2 text-xs text-gray-500">Final cash amount remaining in drawer</p>
                    </div>
                    {cashError && (
                      <div className="flex items-center justify-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                        <span>{cashError}</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-3">
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
                    className="flex-1 px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Processing...</span>
                      </>
                    ) : (
                      <>
                        <span>Continue</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleCashDialogCancel}
                    disabled={loading}
                    className="px-6 py-4 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
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
