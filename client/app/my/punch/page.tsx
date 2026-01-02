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

  useEffect(() => {
    const fetchUserAndStatus = async () => {
      try {
        const currentUser = await getCurrentUser()
        setUser(currentUser)
        
        try {
          const response = await api.get('/time/my?limit=1')
          const entries = response.data.entries || []
          if (entries.length > 0 && !entries[0].clock_out_at) {
            setCurrentStatus('in')
          } else {
            setCurrentStatus('out')
          }
        } catch (err) {
          setCurrentStatus('out')
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

    setMessage(null)
    setLoading(true)
    try {
      const response = await api.post('/time/punch-me', {
        pin: pinDisplay,
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
      setTimeout(() => setMessage(null), 5000)
    } catch (err: any) {
      setMessage(err.response?.data?.detail || 'Punch failed. Please try again.')
      clearPin()
    } finally {
      setLoading(false)
    }
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
            <div className="mb-8">
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
        </div>
      </div>
    </Layout>
  )
}
