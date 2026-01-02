'use client'

import { useState } from 'react'
import api from '@/lib/api'

export default function KioskPage() {
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pinDisplay, setPinDisplay] = useState('')
  const [success, setSuccess] = useState(false)

  const appendPin = (digit: string) => {
    if (pinDisplay.length < 4) {
      setPinDisplay(pinDisplay + digit)
    }
  }

  const clearPin = () => {
    setPinDisplay('')
    setMessage(null)
    setSuccess(false)
  }

  const handlePunch = async () => {
    if (pinDisplay.length !== 4) {
      setMessage('Please enter a 4-digit PIN')
      setSuccess(false)
      return
    }

    setMessage(null)
    setSuccess(false)
    setLoading(true)
    try {
      const response = await api.post('/time/punch-by-pin', {
        pin: pinDisplay,
      })
      const entry = response.data
      
      // Clear PIN immediately after successful punch
      setPinDisplay('')
      
      // Show success message with employee name
      const employeeName = entry.employee_name || 'Employee'
      if (entry.clock_out_at) {
        setMessage(`✓ ${employeeName} Clocked Out Successfully`)
        setSuccess(true)
      } else {
        setMessage(`✓ ${employeeName} Clocked In Successfully`)
        setSuccess(true)
      }
      
      // Auto-clear message after 3 seconds
      setTimeout(() => {
        setMessage(null)
        setSuccess(false)
      }, 3000)
    } catch (err: any) {
      setMessage(err.response?.data?.detail || 'Punch failed. Please try again.')
      setSuccess(false)
      setPinDisplay('') // Clear PIN on error too
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-2xl p-8 md:p-12">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Clock In/Out</h1>
          <p className="text-gray-600">Enter your PIN to punch</p>
        </div>

        <div className="space-y-6">
          {/* Message Display */}
          {message && (
            <div
              className={`rounded-lg p-4 text-center font-semibold ${
                success
                  ? 'bg-green-50 text-green-800 border-2 border-green-200'
                  : 'bg-red-50 text-red-800 border-2 border-red-200'
              }`}
            >
              {message}
            </div>
          )}

          {/* PIN Display */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2 text-center">
              Enter Your PIN
            </label>
            <input
              type="text"
              value={pinDisplay}
              readOnly
              className="block w-full px-4 py-6 border-2 border-gray-300 rounded-lg shadow-sm text-center text-5xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="----"
            />
          </div>

          {/* Number Pad */}
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => appendPin(num.toString())}
                disabled={loading}
                className="py-5 px-4 border-2 border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 text-3xl font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95"
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              onClick={clearPin}
              disabled={loading}
              className="py-5 px-4 border-2 border-gray-300 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => appendPin('0')}
              disabled={loading}
              className="py-5 px-4 border-2 border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 text-3xl font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95"
            >
              0
            </button>
            <button
              type="button"
              onClick={handlePunch}
              disabled={loading || pinDisplay.length !== 4}
              className="py-5 px-4 border-2 border-transparent rounded-lg bg-primary-600 text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed col-span-3 font-bold text-xl transition-all hover:scale-105 active:scale-95"
            >
              {loading ? 'Processing...' : 'Punch In/Out'}
            </button>
          </div>
        </div>

        {/* Instructions */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>No login required. Enter your 4-digit PIN to automatically clock in or out.</p>
        </div>
      </div>
    </div>
  )
}

