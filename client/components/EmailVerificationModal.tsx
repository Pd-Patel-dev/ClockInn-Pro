'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import api from '@/lib/api'
import logger from '@/lib/logger'

interface EmailVerificationModalProps {
  email: string
  isOpen: boolean
  onVerified: () => void
  onClose?: () => void
}

export default function EmailVerificationModal({
  email,
  isOpen,
  onVerified,
  onClose,
}: EmailVerificationModalProps) {
  const [pin, setPin] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [sending, setSending] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Auto-send verification PIN on open
  useEffect(() => {
    if (isOpen && email) {
      handleSendPin()
    }
  }, [isOpen, email])

  // Countdown timer for resend
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => {
        setResendCooldown(resendCooldown - 1)
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [resendCooldown])

  const handleSendPin = useCallback(async () => {
    if (resendCooldown > 0) return
    
    setSending(true)
    setError(null)
    try {
      await api.post('/auth/send-verification-pin', { email })
      setResendCooldown(60)
      logger.info('Verification PIN sent')
    } catch (err: any) {
      logger.error('Failed to send verification PIN', err as Error)
      // Don't show error - generic message already returned
    } finally {
      setSending(false)
    }
  }, [email, resendCooldown])

  const handlePinChange = (index: number, value: string) => {
    if (loading) return
    
    // Only allow digits
    if (value && !/^\d$/.test(value)) return
    
    const newPin = [...pin]
    newPin[index] = value
    setPin(newPin)
    setError(null)

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }

    // Auto-submit when 6 digits are entered
    if (value && index === 5 && newPin.every(d => d !== '')) {
      handleVerify(newPin.join(''))
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'Delete') {
      const newPin = [...pin]
      newPin[index] = ''
      setPin(newPin)
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pastedData = e.clipboardData.getData('text').trim()
    if (/^\d{6}$/.test(pastedData)) {
      const newPin = pastedData.split('')
      setPin(newPin)
      inputRefs.current[5]?.focus()
      // Auto-submit
      setTimeout(() => handleVerify(pastedData), 100)
    }
  }

  const handleVerify = async (pinToVerify?: string) => {
    const pinString = pinToVerify || pin.join('')
    
    if (pinString.length !== 6) {
      setError('Please enter a 6-digit code')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await api.post('/auth/verify-email', {
        email,
        pin: pinString,
      })
      
      // Clear PIN
      setPin(['', '', '', '', '', ''])
      onVerified()
    } catch (err: any) {
      const errorMessage = err.response?.data?.detail || 'Invalid verification code. Please try again.'
      setError(errorMessage)
      // Clear PIN on error
      setPin(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Verify Your Email</h2>
        <p className="text-gray-600 mb-6">
          For your security, please verify your email to continue. A 6-digit code has been sent to <strong>{email}</strong>.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Enter 6-digit code
          </label>
          <div className="flex gap-2 justify-center" onPaste={handlePaste}>
            {pin.map((digit, index) => (
              <input
                key={index}
                ref={(el) => (inputRefs.current[index] = el)}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handlePinChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                disabled={loading}
                className="w-12 h-14 text-center text-2xl font-semibold border-2 border-gray-300 rounded-lg focus:border-teal-500 focus:ring-2 focus:ring-teal-200 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => handleVerify()}
            disabled={loading || pin.some(d => d === '')}
            className="w-full py-3 bg-teal-600 text-white rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Verifying...' : 'Verify Email'}
          </button>

          <div className="text-center">
            <button
              onClick={handleSendPin}
              disabled={resendCooldown > 0 || sending}
              className="text-sm text-teal-600 hover:text-teal-700 disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              {sending ? 'Sending...' : resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
            </button>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

