'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import api from '@/lib/api'

interface CompanyInfo {
  name: string
  slug: string
  kiosk_enabled: boolean
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

  const handlePunch = useCallback(async (pin?: string) => {
    const pinToUse = pin || pinDisplay
    if (pinToUse.length !== 4) {
      setMessage('Please enter a 4-digit PIN')
      setSuccess(false)
      return
    }

    if (!slug) {
      setMessage('Invalid kiosk URL')
      setSuccess(false)
      return
    }

    setMessage(null)
    setSuccess(false)
    setLoading(true)
    try {
      const response = await api.post('/kiosk/clock', {
        company_slug: slug,
        pin: pinToUse,
      })
      const entry = response.data
      
      // Store employee name for confirmation message
      const name = entry.employee_name || 'Employee'
      setEmployeeName(name)
      
      // Clear PIN immediately after successful punch
      setPinDisplay('')
      
      // Show success message with employee name
      if (entry.clock_out_at) {
        setMessage(`${name} - Clocked Out`)
        setSuccess(true)
      } else {
        setMessage(`${name} - Clocked In`)
        setSuccess(true)
      }
      
      // Auto-clear message after 10 seconds
      setTimeout(() => {
        setMessage(null)
        setSuccess(false)
      }, 10000)
    } catch (err: any) {
      setMessage(err.response?.data?.detail || 'Invalid PIN. Please try again.')
      setSuccess(false)
      setPinDisplay('') // Clear PIN on error too
    } finally {
      setLoading(false)
    }
  }, [pinDisplay, slug])

  // Auto-submit when PIN reaches 4 digits
  useEffect(() => {
    if (pinDisplay.length === 4 && !loading) {
      handlePunch(pinDisplay)
    }
  }, [pinDisplay, loading, handlePunch])

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
  }, [loading, appendPin, deletePin, handlePunch, clearPin, pinDisplay])

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
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              Enter your PIN
            </h2>
            
            {/* Instructions */}
            <p className="text-gray-600 text-sm mb-8">
              Please enter your 4-digit PIN code to verify it&apos;s you. You can use your keyboard or the keypad below.
            </p>

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

            {/* PIN Indicators */}
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
    </div>
  )
}

