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
        setMessage(`${employeeName} - Clocked Out`)
        setSuccess(true)
      } else {
        setMessage(`${employeeName} - Clocked In`)
        setSuccess(true)
      }
      
      // Auto-clear message after 3 seconds
      setTimeout(() => {
        setMessage(null)
        setSuccess(false)
      }, 3000)
    } catch (err: any) {
      setMessage(err.response?.data?.detail || 'Invalid PIN. Please try again.')
      setSuccess(false)
      setPinDisplay('') // Clear PIN on error too
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Time Clock</h1>
          <p className="text-gray-500 text-sm">Enter your PIN to clock in or out</p>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-3xl shadow-xl p-8 border border-gray-100">
          {/* Status Message */}
          {message && (
            <div
              className={`mb-6 rounded-xl p-4 text-center font-medium transition-all ${
                success
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                {success ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                )}
                <span>{message}</span>
              </div>
            </div>
          )}

          {/* PIN Display */}
          <div className="mb-8">
            <div className="flex justify-center gap-3 mb-4">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className={`w-14 h-14 rounded-xl border-2 flex items-center justify-center transition-all ${
                    pinDisplay.length > index
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-gray-50 border-gray-200 text-gray-400'
                  }`}
                >
                  {pinDisplay.length > index ? (
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <span className="text-2xl">•</span>
                  )}
                </div>
              ))}
            </div>
            <p className="text-center text-xs text-gray-400">
              {pinDisplay.length === 0 && 'Enter 4-digit PIN'}
              {pinDisplay.length > 0 && pinDisplay.length < 4 && `${4 - pinDisplay.length} more digit${4 - pinDisplay.length > 1 ? 's' : ''}`}
              {pinDisplay.length === 4 && 'Ready to punch'}
            </p>
          </div>

          {/* Number Pad */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => appendPin(num.toString())}
                disabled={loading || pinDisplay.length === 4}
                className="aspect-square bg-gray-50 hover:bg-gray-100 active:bg-gray-200 border border-gray-200 rounded-xl text-2xl font-semibold text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              onClick={clearPin}
              disabled={loading}
              className="aspect-square bg-gray-100 hover:bg-gray-200 active:bg-gray-300 border border-gray-300 rounded-xl text-sm font-semibold text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => appendPin('0')}
              disabled={loading || pinDisplay.length === 4}
              className="aspect-square bg-gray-50 hover:bg-gray-100 active:bg-gray-200 border border-gray-200 rounded-xl text-2xl font-semibold text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              0
            </button>
            <button
              type="button"
              onClick={handlePunch}
              disabled={loading || pinDisplay.length !== 4}
              className="col-span-3 h-14 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-lg"
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
                'Punch'
              )}
            </button>
          </div>
        </div>

        {/* Footer Note */}
        <p className="mt-6 text-center text-xs text-gray-400">
          No login required • Secure PIN entry
        </p>
      </div>
    </div>
  )
}

