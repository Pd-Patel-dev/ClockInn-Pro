'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import api from '@/lib/api'
import ConfirmationDialog from '@/components/ConfirmationDialog'

interface CompanyInfo {
  name: string
  slug: string
  kiosk_enabled: boolean
  cash_drawer_enabled?: boolean
  cash_drawer_required_for_all?: boolean
  cash_drawer_required_roles?: string[]
  cash_drawer_starting_amount_cents?: number
  geofence_enabled?: boolean
}

export default function KioskSlugPage() {
  const router = useRouter()
  const params = useParams()
  const slug = params?.slug as string
  
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pinDisplay, setPinDisplay] = useState('')
  const [success, setSuccess] = useState(false)
  const [employeeName, setEmployeeName] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [currentDate, setCurrentDate] = useState('')
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null)
  const [loadingCompany, setLoadingCompany] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCashDialog, setShowCashDialog] = useState(false)
  const [showPunchConfirm, setShowPunchConfirm] = useState(false)
  const [punchConfirmNext, setPunchConfirmNext] = useState<'execute' | 'execute_after_cash' | null>(null)
  const [cashAmount, setCashAmount] = useState('')
  const [collectedCash, setCollectedCash] = useState('')
  const [dropAmount, setDropAmount] = useState('')
  const [beveragesCash, setBeveragesCash] = useState('')
  const [cashError, setCashError] = useState<string | null>(null)
  const [pendingPunch, setPendingPunch] = useState(false)
  const [isClockIn, setIsClockIn] = useState(false) // Track if this is clock-in or clock-out
  const [checkingPin, setCheckingPin] = useState(false)
  const [employeeInfo, setEmployeeInfo] = useState<{
    name: string
    isClockedIn: boolean
    clockInAt?: string
  } | null>(null)
  const [location, setLocation] = useState<{ latitude: string; longitude: string } | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [locationLoading, setLocationLoading] = useState(false)

  // Request location when page loads (needed for geofence when punching)
  useEffect(() => {
    const getLocation = () => {
      if (!navigator.geolocation) {
        setLocationError('Location not supported')
        return
      }
      setLocationError(null)
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
          setLocationError('Could not get location')
          setLocationLoading(false)
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      )
    }
    getLocation()
  }, [])

  // Fetch company info by slug
  useEffect(() => {
    const fetchCompany = async () => {
      if (!slug) {
        setError('Invalid kiosk URL')
        setLoadingCompany(false)
        return
      }

      try {
        const response = await api.get(`/kiosk/${slug}/info`)
        setCompanyInfo(response.data)
        
        // Check if kiosk is disabled
        if (!response.data.kiosk_enabled) {
          setError('Kiosk is disabled for this company')
        }
      } catch (err: any) {
        const detail = err.response?.data?.detail
        const msg = typeof detail === 'string' ? detail : detail?.message || 'Company not found'
        if (err.response?.status === 403 && msg.includes('office network')) {
          setError('Kiosk is only available on the office network. Please connect to the office network and try again.')
        } else {
          setError(msg)
        }
      } finally {
        setLoadingCompany(false)
      }
    }

    fetchCompany()
  }, [slug])

  // Update time every second
  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setCurrentTime(now)
      setCurrentDate(now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))
    }
    updateTime()
    const interval = setInterval(updateTime, 1000)
    return () => clearInterval(interval)
  }, [])

  // Helper to get current location as a promise
  const getCurrentLocation = useCallback((): Promise<{ latitude: string; longitude: string } | null> => {
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
  }, [])

  const executePunch = useCallback(async (
    pin: string,
    cashStartCents?: number,
    cashEndCents?: number,
    collectedCashCents?: number,
    dropAmountCents?: number,
    beveragesCashCents?: number
  ) => {
    if (!slug) {
      setMessage('Invalid kiosk URL')
      setSuccess(false)
      return
    }

    setMessage(null)
    setSuccess(false)
    setLoading(true)
    setShowCashDialog(false)
    
    try {
      // When geofence is on, location is required (same as in-site punching)
      let currentLocation = location
      if (!currentLocation) {
        currentLocation = await getCurrentLocation()
        if (currentLocation) setLocation(currentLocation)
      }
      if (companyInfo?.geofence_enabled && !currentLocation) {
        setMessage('Location is required to punch at the office. Please enable location access and try again.')
        setSuccess(false)
        setLoading(false)
        return
      }

      const response = await api.post('/kiosk/clock', {
        company_slug: slug,
        pin: pin,
        cash_start_cents: cashStartCents,
        cash_end_cents: cashEndCents,
        collected_cash_cents: collectedCashCents,
        drop_amount_cents: dropAmountCents,
        beverages_cash_cents: beveragesCashCents,
        latitude: currentLocation?.latitude,
        longitude: currentLocation?.longitude,
      })
      const entry = response.data
      
      // Store employee name for confirmation message
      const name = entry.employee_name || 'Employee'
      setEmployeeName(name)
      
      // Clear PIN and employee info immediately after successful punch
      setPinDisplay('')
      setCashAmount('')
      setCollectedCash('')
      setDropAmount('')
      setBeveragesCash('')
      setCashError(null)
      setPendingPunch(false)
      setShowCashDialog(false) // Close cash dialog on success
      setEmployeeInfo(null) // Clear employee info after successful punch
      
      // Show success message with employee name
      if (entry.clock_out_at) {
        setMessage(`${name} - Clocked Out`)
        setSuccess(true)
        setIsClockIn(false)
      } else {
        setMessage(`${name} - Clocked In`)
        setSuccess(true)
        setIsClockIn(true)
      }
      
      // Auto-clear message after 10 seconds
      setTimeout(() => {
        setMessage(null)
        setSuccess(false)
      }, 10000)
    } catch (err: any) {
      const errorDetail = err.response?.data?.detail
      
      // Check if verification is required
      if (err.response?.status === 403 &&
          (errorDetail?.error === 'EMAIL_VERIFICATION_REQUIRED' ||
           (typeof errorDetail === 'object' && errorDetail?.error === 'EMAIL_VERIFICATION_REQUIRED'))) {
        setMessage(errorDetail?.message || 'Your email must be verified to use the kiosk. Please verify your email first by logging into your account.')
        setSuccess(false)
        setPinDisplay('')
        setPendingPunch(false)
        setShowCashDialog(false)
      } else if (err.response?.status === 403 && (typeof errorDetail === 'string' && errorDetail.includes('office network'))) {
        setMessage('Kiosk is only available on the office network. Please connect to the office network and try again.')
        setSuccess(false)
        setPinDisplay('')
        setPendingPunch(false)
        setShowCashDialog(false)
      } else if (err.response?.status === 403 && (typeof errorDetail === 'string' && (errorDetail.includes('outside the allowed area') || errorDetail.includes('must be at the office')))) {
        setMessage('You must be at the office to punch in/out. You are currently outside the allowed area.')
        setSuccess(false)
        setPinDisplay('')
        setPendingPunch(false)
        setShowCashDialog(false)
      } else if (err.response?.status === 400 && typeof errorDetail === 'string' && errorDetail.includes('Location is required')) {
        setMessage('Location is required to punch at the office. Please enable location access and try again.')
        setSuccess(false)
        setPinDisplay('')
        setPendingPunch(false)
        setShowCashDialog(false)
      } else {
        const errorMessage = typeof errorDetail === 'string' ? errorDetail : errorDetail?.message || 'Invalid PIN. Please try again.'
        
        // Check if error is about missing cash
        const errorLower = errorMessage.toLowerCase()
        if (errorLower.includes('cash') || errorLower.includes('start') || errorLower.includes('end')) {
          // Cash is required but wasn't provided - show dialog
          setPendingPunch(true)
          setShowCashDialog(true)
          setCashAmount('')
          setCollectedCash('')
          setDropAmount('')
          setBeveragesCash('')
          setCashError(null)
          setMessage(null) // Clear error message since we're showing dialog
          
          // Determine if we need start or end cash based on error message
          if (errorLower.includes('ending') || errorLower.includes('end cash') || errorLower.includes('clock out')) {
            setIsClockIn(false) // Need end cash = clock-out
          } else if (errorLower.includes('starting') || errorLower.includes('start cash') || errorLower.includes('clock in')) {
            setIsClockIn(true) // Need start cash = clock-in
          } else {
            // Default to clock-in (start cash) if we can't determine
            setIsClockIn(true)
          }
        } else {
          setMessage(errorMessage)
          setSuccess(false)
          setPinDisplay('')
          setPendingPunch(false)
          setShowCashDialog(false)
        }
      }
    } finally {
      setLoading(false)
    }
  }, [slug, location, companyInfo?.geofence_enabled, getCurrentLocation])

  const checkPin = useCallback(async (pin: string) => {
    if (!slug || pin.length !== 4) {
      return
    }

    setCheckingPin(true)
    setMessage(null)
    setSuccess(false)
    setEmployeeInfo(null)

    try {
      const response = await api.post('/kiosk/check-pin', {
        company_slug: slug,
        pin: pin,
      })

      const data = response.data

      if (!data.valid) {
        setMessage('Invalid PIN. Please try again.')
        setSuccess(false)
        setPinDisplay('')
        return
      }

      if (data.requires_verification) {
        setMessage(data.verification_message || 'Your email must be verified to use the kiosk.')
        setSuccess(false)
        setPinDisplay('')
        return
      }

      // PIN is valid, store employee info
      const empInfo = {
        name: data.employee_name || 'Employee',
        isClockedIn: data.is_clocked_in,
        clockInAt: data.clock_in_at,
      }
      setEmployeeInfo(empInfo)

      // Determine if we need cash drawer
      const needsCash = data.cash_drawer_enabled && data.cash_drawer_required

      if (data.is_clocked_in) {
        // Employee is clocked in - show end shift form
        setIsClockIn(false)
        if (needsCash) {
          setPendingPunch(true)
          setShowCashDialog(true)
          setCashAmount('')
          setCollectedCash('')
          setDropAmount('')
          setBeveragesCash('')
          setCashError(null)
        } else {
          setPunchConfirmNext('execute')
          setShowPunchConfirm(true)
        }
      } else {
        // Employee is not clocked in - show start shift form with greeting
        setIsClockIn(true)
        if (needsCash) {
          setPendingPunch(true)
          setShowCashDialog(true)
          setCashAmount('')
          setCollectedCash('')
          setDropAmount('')
          setBeveragesCash('')
          setCashError(null)
        } else {
          setPunchConfirmNext('execute')
          setShowPunchConfirm(true)
        }
      }
    } catch (err: any) {
      const errorDetail = err.response?.data?.detail
      const errorMessage = typeof errorDetail === 'string' ? errorDetail : errorDetail?.message || 'Invalid PIN. Please try again.'
      if (err.response?.status === 403 && typeof errorDetail === 'string' && errorDetail.includes('office network')) {
        setMessage('Kiosk is only available on the office network. Please connect to the office network and try again.')
      } else {
        setMessage(errorMessage)
      }
      setSuccess(false)
      setPinDisplay('')
    } finally {
      setCheckingPin(false)
    }
  }, [slug])

  const handlePunch = useCallback(async (pin?: string) => {
    const pinToUse = pin || pinDisplay
    if (pinToUse.length !== 4) {
      setMessage('Please enter a 4-digit PIN')
      setSuccess(false)
      return
    }

    // Don't show dialog if already pending or dialog is open
    if (pendingPunch || showCashDialog || checkingPin || showPunchConfirm) {
      return
    }

    // First check PIN and get employee status
    await checkPin(pinToUse)
  }, [pinDisplay, checkPin, pendingPunch, showCashDialog, checkingPin, showPunchConfirm])

  const handleCashDialogSubmit = useCallback(async () => {
    // Validate cash amount
    const cashValue = parseFloat(cashAmount)
    if (isNaN(cashValue) || cashValue < 0) {
      setCashError('Please enter a valid cash amount')
      return
    }
    
    // For clock-out, validate additional cash fields
    if (!isClockIn) {
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
    setPunchConfirmNext('execute_after_cash')
    setShowPunchConfirm(true)
  }, [cashAmount, collectedCash, dropAmount, beveragesCash, isClockIn])

  const handleCashDialogCancel = useCallback(() => {
    setShowCashDialog(false)
    setPendingPunch(false)
    setCashAmount('')
    setCashError(null)
    setPinDisplay('')
  }, [])

  const performKioskPunchWithEnteredCash = useCallback(async () => {
    const cashValue = parseFloat(cashAmount)
    const cashCents = Math.round(cashValue * 100)
    const pinToUse = pinDisplay
    if (isClockIn) {
      await executePunch(pinToUse, cashCents, undefined, undefined, undefined, undefined)
    } else {
      const collectedCents = Math.round(parseFloat(collectedCash) * 100)
      const dropCents = Math.round(parseFloat(dropAmount || '0') * 100)
      const beveragesCents = Math.round(parseFloat(beveragesCash) * 100)
      await executePunch(pinToUse, undefined, cashCents, collectedCents, dropCents, beveragesCents)
    }
  }, [cashAmount, collectedCash, dropAmount, beveragesCash, pinDisplay, isClockIn, executePunch])

  const handleKioskPunchConfirm = useCallback(() => {
    const next = punchConfirmNext
    setShowPunchConfirm(false)
    setPunchConfirmNext(null)
    if (next === 'execute') {
      void executePunch(pinDisplay)
    } else if (next === 'execute_after_cash') {
      void performKioskPunchWithEnteredCash()
    }
  }, [punchConfirmNext, pinDisplay, executePunch, performKioskPunchWithEnteredCash])

  const handleKioskPunchCancel = useCallback(() => {
    const next = punchConfirmNext
    setShowPunchConfirm(false)
    setPunchConfirmNext(null)
    if (next === 'execute_after_cash') {
      setShowCashDialog(true)
      setPendingPunch(true)
    } else {
      setPendingPunch(false)
      setPinDisplay('')
      setEmployeeInfo(null)
    }
  }, [punchConfirmNext])

  // Auto-check PIN when it reaches 4 digits (but not when cash dialog is open or checking)
  useEffect(() => {
    if (
      pinDisplay.length === 4 &&
      !loading &&
      !showCashDialog &&
      !pendingPunch &&
      !checkingPin &&
      !showPunchConfirm
    ) {
      handlePunch(pinDisplay)
    }
  }, [pinDisplay, loading, showCashDialog, pendingPunch, checkingPin, showPunchConfirm, handlePunch])

  const appendPin = useCallback((digit: string) => {
    if (!loading) {
      setPinDisplay(prev => {
        if (prev.length < 4) {
          return prev + digit
        }
        return prev
      })
    }
  }, [loading])

  const deletePin = useCallback(() => {
    if (!loading) {
      setPinDisplay(prev => prev.slice(0, -1))
      setMessage(null)
      setSuccess(false)
    }
  }, [loading])

  const clearPin = useCallback(() => {
    setPinDisplay('')
    setMessage(null)
    setSuccess(false)
  }, [])

  // Handle keyboard input for PIN entry
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't interfere if cash dialog is open
      if (showCashDialog || showPunchConfirm) return

      if (loading) return

      if (event.key >= '0' && event.key <= '9') {
        event.preventDefault()
        appendPin(event.key)
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        deletePin()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (pinDisplay.length === 4) {
          handlePunch(pinDisplay)
        }
      } else if (event.key === 'Escape') {
        event.preventDefault()
        clearPin()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [loading, appendPin, deletePin, handlePunch, clearPin, pinDisplay, showCashDialog, showPunchConfirm])

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    }).toLowerCase()
  }

  // Error state
  if (error) {
    const isDisabled = error.includes('disabled')
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div
          className={`w-full max-w-md rounded-2xl border p-8 text-center ${
            isDisabled
              ? 'border-amber-500/30 bg-slate-900'
              : 'border-red-500/20 bg-slate-900'
          }`}
        >
          <div
            className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full ${
              isDisabled ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'
            }`}
          >
            {isDisabled ? (
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
          <h1 className="text-lg font-semibold text-white">
            {isDisabled ? 'Kiosk unavailable' : 'Kiosk not available'}
          </h1>
          <p className="mt-2 text-sm text-slate-400">{error}</p>
        </div>
      </div>
    )
  }

  // Loading state
  if (loadingCompany) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
        <div className="h-8 w-8 rounded-full border-2 border-slate-700 border-t-blue-500 animate-spin" />
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    )
  }

  const companyName = companyInfo?.name || 'Company'
  const kioskLocation = 'Main Office' // Could be fetched from company settings

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Left Panel — brand & clock */}
      <div className="relative w-[45%] min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col items-center justify-center px-10 border-r border-slate-700/50">
        <div className="mb-12 flex items-center gap-3">
          <span className="block h-3 w-3 rounded-full bg-blue-500" />
          <span className="text-2xl font-semibold tracking-tight text-white">ClockInn</span>
        </div>

        <div className="text-center">
          <p className="text-7xl font-light tabular-nums tracking-tight text-white">
            {formatTime(currentTime)}
          </p>
          <p className="mt-3 text-lg font-light text-slate-400">{currentDate}</p>
        </div>

        <div className="mt-14 text-center">
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-slate-500">Property</p>
          <p className="text-xl font-medium text-slate-200">{companyName}</p>
          <p className="mt-2 text-sm text-slate-500">Kiosk: {kioskLocation}</p>
        </div>

        {companyInfo?.geofence_enabled && (
          <div className="absolute bottom-8 left-0 flex w-[100%] justify-center px-4">
            <div
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                locationLoading
                  ? 'border-transparent bg-slate-700/50 text-slate-400'
                  : location
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                    : 'border-amber-500/20 bg-amber-500/10 text-amber-400'
              }`}
            >
              {locationLoading ? (
                <>
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-blue-500" />
                  Getting location…
                </>
              ) : location ? (
                <>Location ready</>
              ) : locationError ? (
                <>Location unavailable</>
              ) : (
                <>Location required</>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right Panel — PIN */}
      <div className="flex min-h-screen flex-1 flex-col items-center justify-center bg-slate-950 px-12">
        <div className="w-full max-w-[320px]">
          {companyInfo?.geofence_enabled && (
            <p className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-300">
              Punch in/out is only allowed when you are at the office.
            </p>
          )}

          {employeeInfo ? (
            <>
              <h2 className="mb-2 text-center text-2xl font-semibold text-white">
                {isClockIn ? `Welcome, ${employeeInfo.name}!` : `Hello, ${employeeInfo.name}!`}
              </h2>
              <p className="mb-6 text-center text-sm text-slate-400">
                {isClockIn
                  ? 'Ready to start your shift? Please enter the starting cash amount.'
                  : `You clocked in at ${employeeInfo.clockInAt || 'earlier'}. Ready to end your shift?`}
              </p>
            </>
          ) : (
            <div className="mb-8 text-center">
              <h2 className="text-2xl font-semibold text-white">Welcome</h2>
              <p className="mt-1.5 text-sm text-slate-400">Enter your PIN to clock in or out</p>
              <p className="mt-3 text-xs text-slate-500">
                Use your keyboard or the keypad below. 4 digits, then submit.
              </p>
            </div>
          )}

          {message && (
            <p
              className={`mb-4 text-center text-sm ${
                success ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {message}
            </p>
          )}

          {!employeeInfo && (
            <div className="mb-8 flex justify-center gap-4">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className={`h-4 w-4 rounded-full transition-all duration-150 ${
                    pinDisplay.length > index
                      ? 'scale-110 bg-blue-500'
                      : 'border border-slate-600 bg-slate-700'
                  }`}
                />
              ))}
            </div>
          )}

          {checkingPin && (
            <div className="mt-6 mb-6 flex items-center justify-center gap-2 text-sm text-slate-400">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
              Verifying…
            </div>
          )}

          <div className="relative mx-auto grid w-full max-w-[260px] grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => appendPin(num.toString())}
                disabled={loading}
                className="h-16 rounded-2xl border border-slate-700/50 bg-slate-800 text-xl font-medium text-white transition-all duration-100 hover:border-slate-600 hover:bg-slate-700 active:scale-95 active:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              onClick={clearPin}
              disabled={loading || pinDisplay.length === 0}
              className="h-16 rounded-2xl border border-slate-700/30 bg-slate-800/50 text-sm font-medium text-slate-400 transition-all duration-100 hover:bg-slate-700/50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => appendPin('0')}
              disabled={loading}
              className="h-16 rounded-2xl border border-slate-700/50 bg-slate-800 text-xl font-medium text-white transition-all duration-100 hover:border-slate-600 hover:bg-slate-700 active:scale-95 active:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => handlePunch()}
              disabled={loading || pinDisplay.length !== 4}
              className="flex h-16 items-center justify-center rounded-2xl bg-blue-600 text-white transition-all duration-100 hover:bg-blue-500 active:scale-95 active:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              )}
            </button>
          </div>

          <div className="mt-10 flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="text-sm text-slate-400 transition-colors hover:text-white focus:outline-none"
            >
              Reset my PIN number
            </button>
            <button
              type="button"
              onClick={() => router.push('/')}
              className="flex items-center gap-1 text-sm text-slate-500 transition-colors hover:text-slate-300 focus:outline-none"
            >
              <span>←</span> Cancel
            </button>
          </div>
        </div>
      </div>

      <ConfirmationDialog
        isOpen={showPunchConfirm}
        title={isClockIn ? 'Clock in?' : 'Clock out?'}
        message={
          punchConfirmNext === 'execute_after_cash'
            ? employeeInfo
              ? `Submit punch for ${employeeInfo.name} with the cash amounts you entered?`
              : 'Submit punch with the cash amounts you entered?'
            : employeeInfo
              ? isClockIn
                ? `Confirm clock in for ${employeeInfo.name}.`
                : `Confirm clock out for ${employeeInfo.name}.`
              : isClockIn
                ? 'Confirm you want to clock in.'
                : 'Confirm you want to clock out.'
        }
        confirmText={isClockIn ? 'Clock in' : 'Clock out'}
        cancelText="Cancel"
        onConfirm={handleKioskPunchConfirm}
        onCancel={handleKioskPunchCancel}
      />

      {/* Cash Drawer Dialog */}
      {showCashDialog && (
        <div className="fixed inset-0 z-[9999] flex h-full w-full items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
          <div className="relative m-4 max-h-[90vh] w-full max-w-sm transform overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="p-6">
              <h3 className="text-center text-lg font-semibold text-white">
                {isClockIn ? 'Start Your Shift' : 'End Your Shift'}
              </h3>
              {employeeInfo && (
                <p className="mt-1 text-center text-sm font-medium text-slate-300">
                  {isClockIn ? `Welcome, ${employeeInfo.name}!` : `Hello, ${employeeInfo.name}!`}
                </p>
              )}
              <p className="mb-6 mt-1 text-center text-sm text-slate-400">
                {isClockIn ? 'Enter the starting cash amount in the drawer' : 'Enter all cash amounts for your shift'}
              </p>

            {/* Content */}
            <div>
              {isClockIn ? (
                // Clock-in: Only need starting cash
                <div className="mb-8">
                  <label className="mb-4 block text-center text-xs font-medium uppercase tracking-wide text-slate-400">
                    Starting Cash Amount <span className="text-red-400">*</span>
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
                      className={`block w-full rounded-xl border-2 py-5 pl-12 pr-5 text-center text-3xl font-semibold tracking-wide text-white transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 focus:ring-offset-slate-900 ${
                        cashError 
                          ? 'border-red-400/50 bg-red-950/30' 
                          : 'border-slate-700 bg-slate-800'
                      }`}
                      placeholder={companyInfo?.cash_drawer_starting_amount_cents 
                        ? (companyInfo.cash_drawer_starting_amount_cents / 100).toFixed(2)
                        : "0.00"}
                      disabled={loading}
                    />
                  </div>
                  {cashError && (
                    <div className="mt-3 flex items-center justify-center gap-2 text-xs text-red-400">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      <span>{cashError}</span>
                    </div>
                  )}
                  <p className="mt-3 text-center text-xs text-slate-500">
                    Enter the starting cash amount in dollars
                  </p>
                </div>
              ) : (
                // Clock-out: Need collected cash, beverages cash, and drawer cash
                <div className="space-y-6 mb-8">
                  <div>
                    <label className="mb-3 block text-xs font-medium uppercase tracking-wide text-slate-400">
                      <div className="flex items-center gap-2">
                        <svg className="h-4 w-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>Collected Cash Amount</span>
                        <span className="text-red-400">*</span>
                      </div>
                    </label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <span className="text-slate-400 text-xl font-medium">$</span>
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
                        autoFocus
                        className={`block w-full rounded-xl border-2 py-4 pl-10 pr-4 text-base text-white transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 focus:ring-offset-slate-900 ${
                          cashError 
                            ? 'border-red-400/50 bg-red-950/30' 
                            : 'border-slate-700 bg-slate-800'
                        }`}
                        placeholder="0.00"
                        disabled={loading}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Total cash collected from customers</p>
                  </div>
                  
                  <div>
                    <label className="mb-3 block text-xs font-medium uppercase tracking-wide text-slate-400">
                      <div className="flex items-center gap-2">
                        <span>Drop Amount</span>
                        <span className="text-red-400">*</span>
                      </div>
                    </label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <span className="text-slate-400 text-xl font-medium">$</span>
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
                        className={`block w-full rounded-xl border-2 py-4 pl-10 pr-4 text-base text-white transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 focus:ring-offset-slate-900 ${
                          cashError 
                            ? 'border-red-400/50 bg-red-950/30' 
                            : 'border-slate-700 bg-slate-800'
                        }`}
                        placeholder="0.00"
                        disabled={loading}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Cash removed/dropped from drawer during shift</p>
                  </div>
                  
                  <div>
                    <label className="mb-3 block text-xs font-medium uppercase tracking-wide text-slate-400">
                      <div className="flex items-center gap-2">
                        <svg className="h-4 w-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span>Beverages Sold (Total)</span>
                        <span className="text-red-400">*</span>
                      </div>
                    </label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <span className="text-slate-400 text-xl font-medium">$</span>
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
                        className={`block w-full rounded-xl border-2 py-4 pl-10 pr-4 text-base text-white transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 focus:ring-offset-slate-900 ${
                          cashError 
                            ? 'border-red-400/50 bg-red-950/30' 
                            : 'border-slate-700 bg-slate-800'
                        }`}
                        placeholder="0.00"
                        disabled={loading}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Total beverage sales during shift (all payment types)</p>
                  </div>
                  
                  <div>
                    <label className="mb-3 block text-xs font-medium uppercase tracking-wide text-slate-400">
                      <div className="flex items-center gap-2">
                        <svg className="h-4 w-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        <span>Cash in Drawer</span>
                        <span className="text-red-400">*</span>
                      </div>
                    </label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <span className="text-slate-400 text-xl font-medium">$</span>
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
                        className={`block w-full rounded-xl border-2 py-4 pl-10 pr-4 text-base text-white transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 focus:ring-offset-slate-900 ${
                          cashError 
                            ? 'border-red-400/50 bg-red-950/30' 
                            : 'border-slate-700 bg-slate-800'
                        }`}
                        placeholder="0.00"
                        disabled={loading}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Final cash amount remaining in drawer</p>
                  </div>
                  
                  {cashError && (
                    <div className="flex items-center justify-center gap-2 rounded-lg border border-red-500/20 bg-red-950/30 p-3 text-sm text-red-400">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      <span>{cashError}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="mt-2 space-y-2 border-t border-slate-700/50 pt-4">
                <button
                  type="button"
                  onClick={handleCashDialogSubmit}
                  disabled={
                    loading || 
                    !cashAmount || 
                    parseFloat(cashAmount) < 0 ||
                    (!isClockIn && (!collectedCash || parseFloat(collectedCash) < 0 || !dropAmount || parseFloat(dropAmount) < 0 || !beveragesCash || parseFloat(beveragesCash) < 0))
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <svg className="h-5 w-5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Processing...</span>
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
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 py-3 font-medium text-slate-300 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

