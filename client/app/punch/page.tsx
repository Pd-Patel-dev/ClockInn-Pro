'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import ConfirmationDialog from '@/components/ConfirmationDialog'
import api from '@/lib/api'
import { getCurrentUser, User } from '@/lib/auth'

export default function MyPunchPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pinDisplay, setPinDisplay] = useState('')
  const [currentStatus, setCurrentStatus] = useState<'in' | 'out' | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [cashDrawerRequired, setCashDrawerRequired] = useState(false)
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

  // Request location when page loads
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
        (error) => {
          console.log('Location error:', error.message)
          setLocationError(error.message)
          setLocationLoading(false)
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      )
    }
    getLocation()
  }, [])

  useEffect(() => {
    const fetchUserAndStatus = async () => {
      try {
        const currentUser = await getCurrentUser()
        setUser(currentUser)
        
        // Check if user needs email verification
        if (!currentUser.email_verified || currentUser.verification_required) {
          router.push(`/verify-email?email=${encodeURIComponent(currentUser.email)}`)
          return
        }
        
        try {
          const response = await api.get('/time/my?limit=1')
          const entries = response.data.entries || []
          const hasOpenEntry = entries.length > 0 && !entries[0].clock_out_at
          if (hasOpenEntry) {
            setCurrentStatus('in')
          } else {
            setCurrentStatus('out')
          }
          
          // Check if cash drawer is required
          try {
            const companyResponse = await api.get('/company/info')
            const settings = companyResponse.data?.settings || {}
            const cashEnabled = settings.cash_drawer_enabled || false
            const requiredForAll = settings.cash_drawer_required_for_all !== false
            const requiredRoles = settings.cash_drawer_required_roles || ['FRONTDESK']
            
            if (cashEnabled && (requiredForAll || requiredRoles.includes(currentUser.role))) {
              setCashDrawerRequired(true)
            } else {
              setCashDrawerRequired(false)
            }
          } catch (err) {
            // If we can't get company settings, assume not required
            setCashDrawerRequired(false)
          }
        } catch (err) {
          setCurrentStatus('out')
          setCashDrawerRequired(false)
        }
      } catch (error) {
        router.push('/login')
      } finally {
        setLoadingStatus(false)
      }
    }
    fetchUserAndStatus()
  }, [router])

  const appendPin = (digit: string) => {
    if (pinDisplay.length < 4) {
      setPinDisplay(pinDisplay + digit)
    }
  }

  const clearPin = () => {
    setPinDisplay('')
  }

  const handlePunch = () => {
    if (pinDisplay.length !== 4) {
      setMessage('Please enter a 4-digit PIN')
      return
    }
    if (loading || showPunchConfirm || showCashDialog) return
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

  const confirmPunchIntent = async () => {
    setShowPunchConfirm(false)
    setPunchConfirmAfterCash(false)
    await executePunch()
  }

  const cancelPunchConfirm = () => {
    setShowPunchConfirm(false)
    if (punchConfirmAfterCash) {
      setPunchConfirmAfterCash(false)
      setPendingPunch(true)
      setShowCashDialog(true)
    }
  }

  // Helper to get current location as a promise
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
        () => {
          resolve(null)
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 }
      )
    })
  }

  const executePunch = async () => {
    setMessage(null)
    setLoading(true)
    setShowCashDialog(false)
    
    try {
      // Try to get fresh location if not already available
      let currentLocation = location
      if (!currentLocation) {
        currentLocation = await getCurrentLocation()
        if (currentLocation) {
          setLocation(currentLocation)
        }
      }

      const cashStartCents = cashDrawerRequired && currentStatus === 'out'
        ? Math.round(parseFloat(cashAmount) * 100)
        : undefined
      const cashEndCents = cashDrawerRequired && currentStatus === 'in'
        ? Math.round(parseFloat(cashAmount) * 100)
        : undefined
      const collectedCashCents = cashDrawerRequired && currentStatus === 'in'
        ? Math.round(parseFloat(collectedCash || '0') * 100)
        : undefined
      const dropAmountCents = cashDrawerRequired && currentStatus === 'in'
        ? Math.round(parseFloat(dropAmount || '0') * 100)
        : undefined
      const beveragesCashCents = cashDrawerRequired && currentStatus === 'in'
        ? Math.round(parseFloat(beveragesCash || '0') * 100)
        : undefined

      console.log('Punching with location:', currentLocation)

      const response = await api.post('/time/punch-me', {
        pin: pinDisplay,
        cash_start_cents: cashStartCents,
        cash_end_cents: cashEndCents,
        collected_cash_cents: collectedCashCents,
        drop_amount_cents: dropAmountCents,
        beverages_cash_cents: beveragesCashCents,
        latitude: currentLocation?.latitude,
        longitude: currentLocation?.longitude,
      })
      const entry = response.data
      
      if (entry.clock_out_at) {
        setMessage(`✓ Clocked out at ${new Date(entry.clock_out_at).toLocaleString()}`)
        setCurrentStatus('out')
      } else {
        setMessage(`✓ Clocked in at ${new Date(entry.clock_in_at).toLocaleString()}`)
        setCurrentStatus('in')
      }
      clearPin()
      setCashAmount('')
      setCollectedCash('')
      setDropAmount('')
      setBeveragesCash('')
      setCashError(null)
      setPendingPunch(false)
      setTimeout(() => setMessage(null), 5000)
    } catch (err: any) {
      const errorDetail = err.response?.data?.detail
      
      // Check if verification is required
      if (err.response?.status === 403 && 
          (errorDetail?.error === 'EMAIL_VERIFICATION_REQUIRED' || 
           (typeof errorDetail === 'object' && errorDetail?.error === 'EMAIL_VERIFICATION_REQUIRED'))) {
        const email = errorDetail?.email || user?.email
        router.push(`/verify-email?email=${encodeURIComponent(email || '')}`)
        return
      }
      
      // Check if error is about missing cash
      const errorMessage = typeof errorDetail === 'string' ? errorDetail : errorDetail?.message || 'Punch failed. Please try again.'
      
      if (errorMessage.includes('cash') || errorMessage.includes('Cash')) {
        // Cash is required but wasn't provided - show dialog
        console.log('Backend requires cash, showing dialog')
        setCashDrawerRequired(true)
        setPendingPunch(true)
        setShowCashDialog(true)
        setCashAmount('')
        setCollectedCash('')
        setDropAmount('')
        setBeveragesCash('')
        setCashError(null)
        setMessage(null) // Clear error message since we're showing dialog
      } else {
        setMessage(errorMessage)
      clearPin()
        setPendingPunch(false)
        setShowCashDialog(false)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCashDialogSubmit = () => {
    const cashValue = parseFloat(cashAmount)
    if (isNaN(cashValue) || cashValue < 0) {
      setCashError('Please enter a valid cash amount')
      return
    }
    // On clock-out, also validate collected, drop, beverages
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
    clearPin()
  }

  if (loadingStatus) {
    return (
      <Layout>
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-sm px-4 py-10">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-semibold text-slate-900">Punch In / Out</h1>
            <p className="mt-1 text-sm text-slate-500">Enter your 4-digit PIN</p>
            {user && <p className="mt-1 text-xs text-slate-400">{user.name}</p>}
          </div>

          {currentStatus && (
            <div className="mb-6 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
              <div className="flex items-center gap-2.5">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    currentStatus === 'in' ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'
                  }`}
                />
                <span className="text-sm font-medium text-slate-800">
                  {currentStatus === 'in' ? 'Clocked In' : 'Clocked Out'}
                </span>
              </div>
              <div
                className={`inline-flex max-w-[55%] shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
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
                    <span className="truncate">Getting location…</span>
                  </>
                ) : location ? (
                  <>
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="truncate">Location ready</span>
                  </>
                ) : (
                  <>
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                    <span className="truncate">Unavailable</span>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="relative rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/80 backdrop-blur-[1px]">
                <div className="flex flex-col items-center gap-2">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
                  <span className="text-xs text-slate-500">Processing…</span>
                </div>
              </div>
            )}

            {message && (
              <p
                className={`mb-4 min-h-[20px] text-center text-sm ${
                  message.includes('failed') || message.includes('Invalid') || message.includes('Please enter')
                    ? 'text-red-500'
                    : 'text-emerald-600'
                }`}
              >
                {message.replace('✓ ', '')}
              </p>
            )}

            <div className="mb-8 flex justify-center gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`h-3.5 w-3.5 rounded-full transition-all duration-150 ${
                    pinDisplay.length > i ? 'scale-110 bg-blue-600' : 'bg-slate-200'
                  }`}
                />
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => appendPin(num.toString())}
                  disabled={loading}
                  className="h-14 rounded-xl border border-slate-200 bg-slate-50 text-lg font-medium text-slate-900 transition-all duration-100 hover:bg-slate-100 active:scale-95 active:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={clearPin}
                disabled={loading}
                className="h-14 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium text-slate-500 transition-all duration-100 hover:bg-slate-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => appendPin('0')}
                disabled={loading}
                className="h-14 rounded-xl border border-slate-200 bg-slate-50 text-lg font-medium text-slate-900 transition-all duration-100 hover:bg-slate-100 active:scale-95 active:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                0
              </button>
              <button
                type="button"
                onClick={handlePunch}
                disabled={loading || showPunchConfirm || showCashDialog || pinDisplay.length !== 4}
                className="flex h-14 items-center justify-center rounded-xl bg-blue-600 font-medium text-white transition-all duration-100 hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
            </div>

            <p className="mt-6 text-center text-xs text-slate-500">
              Enter your 4-digit PIN to {currentStatus === 'in' ? 'clock out' : 'clock in'}
            </p>
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
                  ? 'Confirm you want to clock out with your PIN.'
                  : 'Confirm you want to clock in with your PIN.'
            }
            confirmText={currentStatus === 'in' ? 'Clock out' : 'Clock in'}
            cancelText="Cancel"
            onConfirm={() => void confirmPunchIntent()}
            onCancel={cancelPunchConfirm}
          />

          {/* Cash Drawer Dialog */}
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
                    /* Clock-in: only starting cash */
                    <div className="mb-8">
                      <label className="mb-4 block text-center text-sm font-medium text-slate-700">
                        Cash amount <span className="text-red-500">*</span>
                      </label>
                      <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                          <span className="text-slate-400 text-2xl font-medium">$</span>
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
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              handleCashDialogSubmit()
                            }
                          }}
                          autoFocus
                          className={`block w-full rounded-xl border-2 py-5 pl-12 pr-5 text-center text-3xl font-semibold tracking-wide text-slate-900 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            cashError
                              ? 'border-red-300 bg-red-50'
                              : 'border-slate-200 bg-white'
                          }`}
                          placeholder="0.00"
                          disabled={loading}
                        />
                      </div>
                      {cashError && (
                        <div className="mt-3 flex items-center justify-center gap-2 text-sm text-red-600">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <span>{cashError}</span>
                        </div>
                      )}
                      <p className="mt-3 text-xs text-slate-500 text-center">
                        Enter the amount in dollars (e.g., 100.50)
                      </p>
                    </div>
                  ) : (
                    /* Clock-out: collected, drop, beverages, cash in drawer */
                    <div className="space-y-4 mb-8">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Collected Cash <span className="text-red-500">*</span></label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={collectedCash}
                            onChange={(e) => { setCollectedCash(e.target.value); setCashError(null) }}
                            className={`block w-full rounded-xl border py-3 pl-8 pr-4 text-sm text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 ${cashError ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}
                            placeholder="0.00"
                            disabled={loading}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Drop Amount <span className="text-red-500">*</span></label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={dropAmount}
                            onChange={(e) => { setDropAmount(e.target.value); setCashError(null) }}
                            className={`block w-full rounded-xl border py-3 pl-8 pr-4 text-sm text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 ${cashError ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}
                            placeholder="0.00"
                            disabled={loading}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Beverages Sold (Total) <span className="text-red-500">*</span></label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={beveragesCash}
                            onChange={(e) => { setBeveragesCash(e.target.value); setCashError(null) }}
                            className={`block w-full rounded-xl border py-3 pl-8 pr-4 text-sm text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 ${cashError ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}
                            placeholder="0.00"
                            disabled={loading}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Cash in Drawer <span className="text-red-500">*</span></label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={cashAmount}
                            onChange={(e) => {
                              setCashAmount(e.target.value)
                              setCashError(null)
                            }}
                            onKeyPress={(e) => { if (e.key === 'Enter') handleCashDialogSubmit() }}
                            className={`block w-full rounded-xl border-2 py-5 pl-12 pr-5 text-center text-2xl font-semibold text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 ${cashError ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}
                            placeholder="0.00"
                            disabled={loading}
                          />
                        </div>
                      </div>
                      {cashError && (
                        <div className="flex items-center justify-center gap-2 text-sm text-red-600">
                          <span>{cashError}</span>
                        </div>
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
                          <svg className="h-5 w-5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>Processing…</span>
                        </>
                      ) : (
                        <>
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Continue</span>
                        </>
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
