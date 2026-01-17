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
  const [cashError, setCashError] = useState<string | null>(null)
  const [showCashDialog, setShowCashDialog] = useState(false)
  const [pendingPunch, setPendingPunch] = useState(false)

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
            const requiredRoles = settings.cash_drawer_required_roles || ['EMPLOYEE']
            
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
      setCashError(null)
      return
    }

    // Otherwise, proceed directly with punch
    // If backend requires cash but we didn't provide it, it will return an error
    // and we can handle that
    console.log('Proceeding with punch without cash')
    await executePunch()
  }

  const executePunch = async () => {
    setMessage(null)
    setLoading(true)
    setShowCashDialog(false)
    
    try {
      const cashStartCents = cashDrawerRequired && currentStatus === 'out' 
        ? Math.round(parseFloat(cashAmount) * 100) 
        : undefined
      const cashEndCents = cashDrawerRequired && currentStatus === 'in'
        ? Math.round(parseFloat(cashAmount) * 100)
        : undefined

      const response = await api.post('/time/punch-me', {
        pin: pinDisplay,
        cash_start_cents: cashStartCents,
        cash_end_cents: cashEndCents,
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
    // Validate cash amount
    const cashValue = parseFloat(cashAmount)
    if (isNaN(cashValue) || cashValue < 0) {
      setCashError('Please enter a valid cash amount')
      return
    }
    setCashError(null)
    executePunch()
  }

  const handleCashDialogCancel = () => {
    setShowCashDialog(false)
    setPendingPunch(false)
    setCashAmount('')
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
            <div className={`mb-6 rounded-lg p-4 border ${
              currentStatus === 'in' 
                ? 'bg-yellow-50 border-yellow-200' 
                : 'bg-gray-50 border-gray-200'
            }`}>
              <p className="text-center font-medium text-gray-900">
                {currentStatus === 'in' ? 'Currently Clocked In' : 'Currently Clocked Out'}
              </p>
            </div>
          )}

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
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-[9999] flex items-center justify-center p-4">
              <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md m-4">
                <div className="px-8 py-6 border-b border-gray-200">
                  <h3 className="text-xl font-bold text-gray-900">
                    {currentStatus === 'in' ? 'Ending Cash Count' : 'Starting Cash Count'}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Please enter the cash amount in the drawer
                  </p>
                </div>
                <div className="p-8">
                  <div className="mb-6">
                    <label className="block text-sm font-semibold text-gray-700 mb-3 text-center">
                      Cash Amount ($) <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-500 text-xl">$</span>
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
                        className={`block w-full pl-10 pr-4 py-4 border rounded-lg text-center text-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          cashError ? 'border-red-300' : 'border-gray-300'
                        }`}
                        placeholder="0.00"
                        disabled={loading}
                      />
                    </div>
                    {cashError && (
                      <p className="mt-2 text-sm text-red-600 text-center">{cashError}</p>
                    )}
                    <p className="mt-2 text-xs text-gray-500 text-center">
                      Enter the cash amount in dollars (e.g., 100.50)
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={handleCashDialogSubmit}
                      disabled={loading || !cashAmount || parseFloat(cashAmount) < 0}
                      className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {loading ? (
                        <>
                          <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Processing...
                        </>
                      ) : (
                        'Continue'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleCashDialogCancel}
                      disabled={loading}
                      className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
