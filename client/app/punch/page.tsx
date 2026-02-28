'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
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

  const handlePunch = async () => {
    if (pinDisplay.length !== 4) {
      setMessage('Please enter a 4-digit PIN')
      return
    }

    console.log('handlePunch called:', { cashDrawerRequired, currentStatus })

    // If cash drawer is required, show dialog first
    // For clock-in: we need start cash
    // For clock-out: we need end cash (if there's a cash session)
    if (cashDrawerRequired) {
      console.log('Showing cash dialog')
      setPendingPunch(true)
      setShowCashDialog(true)
      setCashAmount('')
      setCollectedCash('')
      setDropAmount('')
      setBeveragesCash('')
      setCashError(null)
      return
    }

    // Otherwise, proceed directly with punch
    // If backend requires cash but we didn't provide it, it will return an error
    // and we can handle that
    console.log('Proceeding with punch without cash')
    await executePunch()
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
    clearPin()
  }

  if (loadingStatus) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="px-4 py-8 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">Punch In/Out</h1>
            {user && (
              <p className="text-sm text-gray-600">{user.name}</p>
            )}
          </div>

          {/* Status Card */}
          {currentStatus && (
            <div className={`mb-4 rounded-lg p-4 border ${
              currentStatus === 'in' 
                ? 'bg-yellow-50 border-yellow-200' 
                : 'bg-gray-50 border-gray-200'
            }`}>
              <p className="text-center font-medium text-gray-900">
                {currentStatus === 'in' ? 'Currently Clocked In' : 'Currently Clocked Out'}
              </p>
            </div>
          )}

          {/* Location Status */}
          <div className={`mb-6 rounded-lg p-3 border flex items-center justify-center gap-2 text-sm ${
            locationLoading 
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : location 
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-gray-50 border-gray-200 text-gray-600'
          }`}>
            {locationLoading ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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

          {/* Main Card */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            {/* Message Display */}
            {message && (
              <div
                className={`rounded-lg p-3 mb-6 ${
                  message.includes('failed') || message.includes('Invalid') || message.includes('Please enter')
                    ? 'bg-red-50 text-red-800 border border-red-200'
                    : 'bg-green-50 text-green-800 border border-green-200'
                }`}
              >
                <p className="text-center text-sm">{message.replace('✓ ', '')}</p>
              </div>
            )}

            {/* PIN Display */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3 text-center">
                Enter Your PIN
              </label>
              <input
                type="text"
                value={pinDisplay}
                readOnly
                className="block w-full px-4 py-4 border border-gray-300 rounded-lg text-center text-3xl font-mono tracking-widest focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
                placeholder="----"
              />
            </div>


            {/* Number Pad */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => appendPin(num.toString())}
                  disabled={loading}
                  className="py-4 px-4 border border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={clearPin}
                disabled={loading}
                className="py-4 px-4 border border-gray-300 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => appendPin('0')}
                disabled={loading}
                className="py-4 px-4 border border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                0
              </button>
              <button
                type="button"
                onClick={handlePunch}
                disabled={loading || pinDisplay.length !== 4}
                className={`py-4 px-4 border rounded-lg text-white font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed col-span-3 ${
                  currentStatus === 'in'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing...
                  </span>
                ) : (
                  currentStatus === 'in' ? 'Clock Out' : 'Clock In'
                )}
              </button>
            </div>

            {/* Instructions */}
            <div className="text-center text-sm text-gray-500 mt-6">
              <p>Enter your 4-digit PIN to {currentStatus === 'in' ? 'clock out' : 'clock in'}</p>
            </div>
          </div>

          {/* Cash Drawer Dialog */}
          {showCashDialog && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm overflow-y-auto h-full w-full z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg m-4 transform transition-all animate-in zoom-in-95 duration-200">
                {/* Header */}
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
                      ? 'Enter the final cash amount in the drawer' 
                      : 'Enter the starting cash amount in the drawer'}
                  </p>
                </div>

                {/* Content */}
                <div className="p-8">
                  {currentStatus === 'out' ? (
                    /* Clock-in: only starting cash */
                    <div className="mb-8">
                      <label className="block text-sm font-semibold text-gray-700 mb-4 text-center">
                        Cash Amount <span className="text-red-500">*</span>
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
                          className={`block w-full pl-12 pr-5 py-5 border-2 rounded-xl text-center text-3xl font-bold tracking-wide focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all ${
                            cashError
                              ? 'border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-100'
                              : 'border-gray-200 bg-gray-50 focus:border-blue-500 focus:bg-white'
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
                      <p className="mt-3 text-xs text-gray-500 text-center">
                        Enter the amount in dollars (e.g., 100.50)
                      </p>
                    </div>
                  ) : (
                    /* Clock-out: collected, drop, beverages, cash in drawer */
                    <div className="space-y-4 mb-8">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Collected Cash <span className="text-red-500">*</span></label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={collectedCash}
                            onChange={(e) => { setCollectedCash(e.target.value); setCashError(null) }}
                            className={`block w-full pl-8 pr-4 py-3 border rounded-lg ${cashError ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}
                            placeholder="0.00"
                            disabled={loading}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Drop Amount <span className="text-red-500">*</span></label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={dropAmount}
                            onChange={(e) => { setDropAmount(e.target.value); setCashError(null) }}
                            className={`block w-full pl-8 pr-4 py-3 border rounded-lg ${cashError ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}
                            placeholder="0.00"
                            disabled={loading}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Beverages Sold (Total) <span className="text-red-500">*</span></label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={beveragesCash}
                            onChange={(e) => { setBeveragesCash(e.target.value); setCashError(null) }}
                            className={`block w-full pl-8 pr-4 py-3 border rounded-lg ${cashError ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}
                            placeholder="0.00"
                            disabled={loading}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Cash in Drawer <span className="text-red-500">*</span></label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
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
                            className={`block w-full pl-12 pr-5 py-5 border-2 rounded-xl text-center text-2xl font-bold ${cashError ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'}`}
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

                  {/* Action Buttons */}
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
                      className="flex-1 px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 font-semibold text-base disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg hover:shadow-xl transition-all transform hover:scale-[1.02] active:scale-[0.98]"
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
      </div>
    </Layout>
  )
}
