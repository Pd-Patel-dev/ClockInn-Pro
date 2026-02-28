'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import api from '@/lib/api'

interface CompanyInfo {
  name: string
  slug: string
  kiosk_enabled: boolean
  cash_drawer_enabled?: boolean
  cash_drawer_required_for_all?: boolean
  cash_drawer_required_roles?: string[]
  cash_drawer_starting_amount_cents?: number
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
  const [locationLoading, setLocationLoading] = useState(false)

  // Request location when page loads
  useEffect(() => {
    const getLocation = () => {
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
        () => {
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
        setError(err.response?.data?.detail || 'Company not found')
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
      // Try to get fresh location if not already available
      let currentLocation = location
      if (!currentLocation) {
        currentLocation = await getCurrentLocation()
        if (currentLocation) {
          setLocation(currentLocation)
        }
      }

      console.log('Kiosk punching with location:', currentLocation)

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
  }, [slug, location, getCurrentLocation])

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
          // Keep PIN visible but don't clear it yet
        } else {
          // No cash drawer, proceed directly with clock-out
          await executePunch(pin)
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
          // Keep PIN visible but don't clear it yet
        } else {
          // No cash drawer, proceed directly with clock-in
          await executePunch(pin)
        }
      }
    } catch (err: any) {
      const errorDetail = err.response?.data?.detail
      const errorMessage = typeof errorDetail === 'string' ? errorDetail : errorDetail?.message || 'Invalid PIN. Please try again.'
      setMessage(errorMessage)
      setSuccess(false)
      setPinDisplay('')
    } finally {
      setCheckingPin(false)
    }
  }, [slug, executePunch])

  const handlePunch = useCallback(async (pin?: string) => {
    const pinToUse = pin || pinDisplay
    if (pinToUse.length !== 4) {
      setMessage('Please enter a 4-digit PIN')
      setSuccess(false)
      return
    }

    // Don't show dialog if already pending or dialog is open
    if (pendingPunch || showCashDialog || checkingPin) {
      return
    }

    // First check PIN and get employee status
    await checkPin(pinToUse)
  }, [pinDisplay, checkPin, pendingPunch, showCashDialog, checkingPin])

  const handleCashDialogSubmit = useCallback(async () => {
    // Validate cash amount
    const cashValue = parseFloat(cashAmount)
    if (isNaN(cashValue) || cashValue < 0) {
      setCashError('Please enter a valid cash amount')
      return
    }
    
    let collectedCents: number | undefined = undefined
    let beveragesCents: number | undefined = undefined
    
    // For clock-out, validate and collect additional cash fields
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
      
      collectedCents = Math.round(collectedValue * 100)
      const dropCents = Math.round(dropValue * 100)
      beveragesCents = Math.round(beveragesValue * 100)
    }
    
    setCashError(null)
    
    // Close dialog immediately to prevent it from showing again
    setShowCashDialog(false)
    
    const cashCents = Math.round(cashValue * 100)
    const pinToUse = pinDisplay
    
    // Try with start cash first (assuming clock-in)
    // If backend says we need end cash, it will return an error and we'll adjust
    if (isClockIn) {
      await executePunch(pinToUse, cashCents, undefined, undefined, undefined, undefined)
    } else {
      // For clock-out, we need end cash, collected cash, drop amount, and beverages cash
      const dropCents = Math.round(parseFloat(dropAmount || '0') * 100)
      await executePunch(pinToUse, undefined, cashCents, collectedCents, dropCents, beveragesCents)
    }
  }, [cashAmount, collectedCash, dropAmount, beveragesCash, pinDisplay, isClockIn, executePunch])

  const handleCashDialogCancel = useCallback(() => {
    setShowCashDialog(false)
    setPendingPunch(false)
    setCashAmount('')
    setCashError(null)
    setPinDisplay('')
  }, [])

  // Auto-check PIN when it reaches 4 digits (but not when cash dialog is open or checking)
  useEffect(() => {
    if (pinDisplay.length === 4 && !loading && !showCashDialog && !pendingPunch && !checkingPin) {
      handlePunch(pinDisplay)
    }
  }, [pinDisplay, loading, showCashDialog, pendingPunch, checkingPin, handlePunch])

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
      if (showCashDialog) return
      
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
  }, [loading, appendPin, deletePin, handlePunch, clearPin, pinDisplay, showCashDialog])

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    }).toLowerCase()
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-8">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Kiosk Not Available</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    )
  }

  // Loading state
  if (loadingCompany) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-700 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  const companyName = companyInfo?.name || 'Company'
  const kioskLocation = 'Main Office' // Could be fetched from company settings

  return (
    <div className="min-h-screen flex">
      <div className="w-full flex">
        {/* Left Panel - Dark Teal */}
        <div className="w-1/3 bg-teal-700 flex flex-col justify-between p-8">
          {/* Top Section */}
          <div>
            {/* Date */}
            <p className="text-gray-300 text-sm mb-6">{currentDate}</p>
            
            {/* Large Time Display */}
            <h1 className="text-6xl font-bold text-white mb-12">
              {formatTime(currentTime)}
            </h1>
          </div>

          {/* Bottom Section */}
          <div className="space-y-2">
            {/* Company Name */}
            <p className="text-white text-xl font-medium">{companyName}</p>
            
            {/* Kiosk Location */}
            <p className="text-white text-sm opacity-90">Kiosk: {kioskLocation}</p>
            
            {/* Logo/App Name */}
            <div className="mt-8">
              <p className="text-white text-2xl font-semibold">ClockInn</p>
            </div>
          </div>
        </div>

        {/* Right Panel - White */}
        <div className="flex-1 bg-white flex flex-col justify-center items-center p-12">
          <div className="w-full max-w-md">
            {/* Greeting */}
            {employeeInfo ? (
              <>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">
                  {isClockIn ? `Welcome, ${employeeInfo.name}!` : `Hello, ${employeeInfo.name}!`}
                </h2>
                <p className="text-gray-600 text-sm mb-2">
                  {isClockIn 
                    ? 'Ready to start your shift? Please enter the starting cash amount.'
                    : `You clocked in at ${employeeInfo.clockInAt || 'earlier'}. Ready to end your shift?`
                  }
                </p>
              </>
            ) : (
              <>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              Enter your PIN
            </h2>
            {/* Instructions */}
            <p className="text-gray-600 text-sm mb-8">
              Please enter your 4-digit PIN code to verify it&apos;s you. You can use your keyboard or the keypad below.
            </p>
              </>
            )}

            {/* Status Message */}
            {message && (
              <div
                className={`mb-6 rounded-lg p-3 text-center text-sm font-medium ${
                  success
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {message}
              </div>
            )}

            {/* PIN Indicators - only show when not showing employee info */}
            {!employeeInfo && (
            <div className="flex justify-center gap-4 mb-12">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className={`w-4 h-4 rounded-full border-2 transition-all ${
                    pinDisplay.length > index
                      ? 'bg-teal-700 border-teal-700'
                      : 'border-gray-400'
                  }`}
                />
              ))}
            </div>
            )}

            {/* Loading indicator when checking PIN */}
            {checkingPin && (
              <div className="flex justify-center items-center mb-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-700"></div>
                <span className="ml-3 text-gray-600">Verifying PIN...</span>
              </div>
            )}

            {/* Numeric Keypad */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => appendPin(num.toString())}
                  disabled={loading}
                  className="h-14 bg-white hover:bg-gray-50 active:bg-gray-100 border border-gray-300 rounded-lg text-lg font-semibold text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 shadow-sm hover:shadow focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1"
                >
                  {num}
                </button>
              ))}
              
              {/* Bottom Row: Clear and 0 */}
              <button
                type="button"
                onClick={clearPin}
                disabled={loading || pinDisplay.length === 0}
                className="col-span-2 h-14 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 border border-gray-300 rounded-lg text-base font-semibold text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 shadow-sm hover:shadow focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => appendPin('0')}
                disabled={loading}
                className="h-14 bg-white hover:bg-gray-50 active:bg-gray-100 border border-gray-300 rounded-lg text-lg font-semibold text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 shadow-sm hover:shadow focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1"
              >
                0
              </button>
            </div>

            {/* Punch Button */}
            <button
              type="button"
              onClick={() => handlePunch()}
              disabled={loading || pinDisplay.length !== 4}
              className="w-full h-16 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white rounded-lg text-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 mb-6"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </span>
              ) : (
                'Punch In/Out'
              )}
            </button>

            {/* Links */}
            <div className="flex flex-col items-center gap-4">
              <button
                type="button"
                onClick={() => router.push('/login')}
                className="text-teal-700 text-sm hover:text-teal-800 hover:underline focus:outline-none transition-colors"
              >
                Reset my PIN number
              </button>
              
              <button
                type="button"
                onClick={() => router.push('/')}
                className="text-gray-600 text-sm hover:text-gray-800 hover:underline focus:outline-none flex items-center gap-1 transition-colors"
              >
                <span>←</span> Cancel
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Cash Drawer Dialog */}
      {showCashDialog && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm overflow-y-auto h-full w-full z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl m-4 transform transition-all animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="px-8 pt-8 pb-6 bg-gradient-to-r from-teal-50 to-emerald-50 rounded-t-2xl border-b border-gray-100">
              <div className="flex items-center justify-center mb-3">
                <div className="p-3 bg-teal-100 rounded-full">
                  <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 text-center mb-2">
                {isClockIn ? 'Start Your Shift' : 'End Your Shift'}
              </h3>
              {employeeInfo && (
                <p className="text-lg text-teal-600 mt-2 text-center font-semibold">
                  {isClockIn ? `Welcome, ${employeeInfo.name}!` : `Hello, ${employeeInfo.name}!`}
                </p>
              )}
              <p className="text-sm text-gray-600 mt-2 text-center">
                {isClockIn ? 'Enter the starting cash amount in the drawer' : 'Enter all cash amounts for your shift'}
              </p>
            </div>

            {/* Content */}
            <div className="p-8">
              {isClockIn ? (
                // Clock-in: Only need starting cash
                <div className="mb-8">
                  <label className="block text-sm font-semibold text-gray-700 mb-4 text-center">
                    Starting Cash Amount <span className="text-red-500">*</span>
                  </label>
                  <div className="relative group">
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
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          handleCashDialogSubmit()
                        }
                      }}
                      autoFocus
                      className={`block w-full pl-12 pr-5 py-5 border-2 rounded-xl text-center text-3xl font-bold tracking-wide focus:outline-none focus:ring-4 focus:ring-teal-100 transition-all ${
                        cashError 
                          ? 'border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-100' 
                          : 'border-gray-200 bg-gray-50 focus:border-teal-500 focus:bg-white'
                      }`}
                      placeholder={companyInfo?.cash_drawer_starting_amount_cents 
                        ? (companyInfo.cash_drawer_starting_amount_cents / 100).toFixed(2)
                        : "0.00"}
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
                  <p className="mt-3 text-xs text-gray-500 text-center">
                    Enter the starting cash amount in dollars
                  </p>
                </div>
              ) : (
                // Clock-out: Need collected cash, beverages cash, and drawer cash
                <div className="space-y-6 mb-8">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>Collected Cash Amount</span>
                        <span className="text-red-500">*</span>
                      </div>
                    </label>
                    <div className="relative group">
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
                        autoFocus
                        className={`block w-full pl-10 pr-4 py-4 border-2 rounded-xl text-lg font-semibold focus:outline-none focus:ring-4 focus:ring-teal-100 transition-all ${
                          cashError 
                            ? 'border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-100' 
                            : 'border-gray-200 bg-gray-50 focus:border-teal-500 focus:bg-white'
                        }`}
                        placeholder="0.00"
                        disabled={loading}
                      />
                    </div>
                    <p className="mt-2 text-xs text-gray-500">Total cash collected from customers</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <div className="flex items-center gap-2">
                        <span>Drop Amount</span>
                        <span className="text-red-500">*</span>
                      </div>
                    </label>
                    <div className="relative group">
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
                        className={`block w-full pl-10 pr-4 py-4 border-2 rounded-xl text-lg font-semibold focus:outline-none focus:ring-4 focus:ring-teal-100 transition-all ${
                          cashError 
                            ? 'border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-100' 
                            : 'border-gray-200 bg-gray-50 focus:border-teal-500 focus:bg-white'
                        }`}
                        placeholder="0.00"
                        disabled={loading}
                      />
                    </div>
                    <p className="mt-2 text-xs text-gray-500">Cash removed/dropped from drawer during shift</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span>Beverages Sold (Total)</span>
                        <span className="text-red-500">*</span>
                      </div>
                    </label>
                    <div className="relative group">
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
                        className={`block w-full pl-10 pr-4 py-4 border-2 rounded-xl text-lg font-semibold focus:outline-none focus:ring-4 focus:ring-teal-100 transition-all ${
                          cashError 
                            ? 'border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-100' 
                            : 'border-gray-200 bg-gray-50 focus:border-teal-500 focus:bg-white'
                        }`}
                        placeholder="0.00"
                        disabled={loading}
                      />
                    </div>
                    <p className="mt-2 text-xs text-gray-500">Total beverage sales during shift (all payment types)</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        <span>Cash in Drawer</span>
                        <span className="text-red-500">*</span>
                      </div>
                    </label>
                    <div className="relative group">
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
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            handleCashDialogSubmit()
                          }
                        }}
                        className={`block w-full pl-10 pr-4 py-4 border-2 rounded-xl text-lg font-semibold focus:outline-none focus:ring-4 focus:ring-teal-100 transition-all ${
                          cashError 
                            ? 'border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-100' 
                            : 'border-gray-200 bg-gray-50 focus:border-teal-500 focus:bg-white'
                        }`}
                        placeholder="0.00"
                        disabled={loading}
                      />
                    </div>
                    <p className="mt-2 text-xs text-gray-500">Final cash amount remaining in drawer</p>
                  </div>
                  
                  {cashError && (
                    <div className="flex items-center justify-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      <span>{cashError}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={handleCashDialogSubmit}
                  disabled={
                    loading || 
                    !cashAmount || 
                    parseFloat(cashAmount) < 0 ||
                    (!isClockIn && (!collectedCash || parseFloat(collectedCash) < 0 || !dropAmount || parseFloat(dropAmount) < 0 || !beveragesCash || parseFloat(beveragesCash) < 0))
                  }
                  className="flex-1 px-6 py-4 bg-gradient-to-r from-teal-600 to-emerald-600 text-white rounded-xl hover:from-teal-700 hover:to-emerald-700 font-semibold text-base disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg hover:shadow-xl transition-all transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  className="px-6 py-4 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-semibold text-base disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

