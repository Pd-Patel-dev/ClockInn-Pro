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
        
        // Check if user has an open entry (clocked in)
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
          <div className="text-lg">Loading...</div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-2xl font-bold text-center mb-2">Punch In/Out</h1>
          {user && (
            <p className="text-center text-gray-600 mb-6">{user.name}</p>
          )}
          
          {/* Current Status */}
          {currentStatus && (
            <div className={`rounded-md p-4 mb-6 text-center ${
              currentStatus === 'in' 
                ? 'bg-yellow-50 text-yellow-800 border border-yellow-200' 
                : 'bg-gray-50 text-gray-800 border border-gray-200'
            }`}>
              <p className="font-semibold">
                {currentStatus === 'in' ? '🟢 Currently Clocked In' : '⚪ Currently Clocked Out'}
              </p>
            </div>
          )}

          {/* Message Display */}
          {message && (
            <div
              className={`rounded-md p-4 mb-6 ${
                message.includes('failed') || message.includes('Invalid') || message.includes('Please enter')
                  ? 'bg-red-50 text-red-800 border border-red-200'
                  : 'bg-green-50 text-green-800 border border-green-200'
              }`}
            >
              {message}
            </div>
          )}

          {/* PIN Display */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2 text-center">
              Enter Your PIN
            </label>
            <input
              type="text"
              value={pinDisplay}
              readOnly
              className="block w-full px-3 py-4 border-2 border-gray-300 rounded-md shadow-sm text-center text-3xl font-mono tracking-widest focus:outline-none focus:ring-primary-500 focus:border-primary-500"
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
                className="py-4 px-4 border-2 border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 text-2xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              onClick={clearPin}
              disabled={loading}
              className="py-4 px-4 border-2 border-gray-300 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => appendPin('0')}
              disabled={loading}
              className="py-4 px-4 border-2 border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 text-2xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              0
            </button>
            <button
              type="button"
              onClick={handlePunch}
              disabled={loading || pinDisplay.length !== 4}
              className={`py-4 px-4 border-2 border-transparent rounded-md text-white font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed col-span-3 transition-colors ${
                currentStatus === 'in'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {loading ? 'Processing...' : currentStatus === 'in' ? 'Clock Out' : 'Clock In'}
            </button>
          </div>

          {/* Instructions */}
          <div className="text-center text-sm text-gray-500 mt-6">
            <p>Enter your 4-digit PIN to {currentStatus === 'in' ? 'clock out' : 'clock in'}</p>
          </div>
        </div>
      </div>
    </Layout>
  )
}

