'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import logger from '@/lib/logger'
import { getCurrentUser } from '@/lib/auth'

function VerifyEmailContent() {
  const router = useRouter()
  const [email, setEmail] = useState<string>('')
  const [pin, setPin] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [sending, setSending] = useState(false)
  const [checkingUser, setCheckingUser] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [verificationSuccess, setVerificationSuccess] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const initializationRef = useRef<string | null>(null) // Track what we've already initialized
  const resendCooldownRef = useRef(0) // Ref to track latest cooldown value (avoids stale closures)

  const handleSendPin = useCallback(async () => {
    const currentCooldown = resendCooldownRef.current
    if (currentCooldown > 0) {
      setError(`Please wait ${currentCooldown} seconds before requesting a new code.`)
      return
    }
    setSending(true)
    setError(null)
    try {
      const response = await api.post<{ message?: string }>('/auth/send-verification-pin')
      setResendCooldown(60)
      resendCooldownRef.current = 60
      logger.info('Verification PIN sent')
      if (response.data?.message?.includes('already verified')) {
        setError('Email is already verified. Redirecting...')
        setTimeout(async () => {
          try {
            const currentUser = await getCurrentUser()
            if (currentUser.role === 'DEVELOPER') {
              router.push('/developer')
            } else {
              router.push('/dashboard')
            }
          } catch (err) {
            router.push('/dashboard')
          }
        }, 2000)
      }
    } catch (err: any) {
      logger.error('Failed to send verification PIN', err as Error)
      
      // Handle network errors
      if (!err.response) {
        setError('Network error. Please check your connection and try again.')
      } else {
        // Don't show error if it's the generic "email sent" message (security)
        const errorMsg = err.response?.data?.detail || err.response?.data?.message
        if (errorMsg && !errorMsg.includes('already verified')) {
          // Check for specific error types
          if (errorMsg.includes('cooldown') || errorMsg.includes('wait')) {
            // Extract remaining seconds from error message and update cooldown
            const waitMatch = errorMsg.match(/wait (\d+) seconds/)
            if (waitMatch) {
              const remainingSeconds = parseInt(waitMatch[1], 10)
              setResendCooldown(remainingSeconds)
              resendCooldownRef.current = remainingSeconds
            }
            setError(errorMsg) // Show cooldown message directly
          } else {
            setError('Failed to send verification code. Please try again.')
          }
        }
      }
    } finally {
      setSending(false)
    }
  }, [router])

  // Get email from logged-in user only (registered email); no changing email
  useEffect(() => {
    const checkUserAndEmail = async () => {
      if (initializationRef.current === 'done') return

      try {
        let user = null
        try {
          user = await getCurrentUser()
        } catch {
          // Not logged in
        }

        if (!user) {
          router.push('/login')
          return
        }

        if (user.email_verified && !user.verification_required) {
          if (user.role === 'DEVELOPER') router.push('/developer')
          else router.push('/dashboard')
          return
        }

        setEmail(user.email)
        setCheckingUser(false)
        initializationRef.current = 'done'
        handleSendPin()
      } catch {
        router.push('/login')
      }
    }
    checkUserAndEmail()
  }, [router, handleSendPin])

  // Keep ref in sync with state
  useEffect(() => {
    resendCooldownRef.current = resendCooldown
  }, [resendCooldown])

  // Countdown timer for resend
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => {
        setResendCooldown((prev) => {
          const newValue = prev - 1
          resendCooldownRef.current = newValue
          return newValue
        })
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [resendCooldown])

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
    } else {
      // Invalid paste - show error
      setError('Please paste a valid 6-digit code')
      // Clear any partial paste
      setPin(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    }
  }

  const handleVerify = async (pinToVerify?: string) => {
    if (!email) {
      setError('Email address not found. Please try logging in again.')
      return
    }

    const pinString = pinToVerify || pin.join('')
    
    if (pinString.length !== 6) {
      setError('Please enter a 6-digit code')
      return
    }

    setLoading(true)
    setError(null)
    setVerifying(true)

    try {
      await api.post('/auth/verify-email', {
        email,
        pin: pinString,
      })
      
      // Clear PIN
      setPin(['', '', '', '', '', ''])
      
      // Show success state
      setVerificationSuccess(true)
      setVerifying(false)
      
      // Redirect to dashboard after showing success message
      setTimeout(() => {
        router.push('/dashboard')
      }, 2000)
    } catch (err: any) {
      setVerifying(false)
      // Handle network errors
      if (!err.response) {
        setError('Network error. Please check your connection and try again.')
      } else {
        // Handle API errors
        const errorMessage = err.response?.data?.detail || 'Invalid verification code. Please try again.'
        setError(errorMessage)
      }
      // Clear PIN on error
      setPin(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  if (checkingUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto"></div>
          <div className="mt-4 text-gray-600">Loading...</div>
        </div>
      </div>
    )
  }

  if (verificationSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="bg-white rounded-lg shadow-xl p-8 text-center">
            <div className="mb-4">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
                <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Email Verified Successfully!</h1>
            <p className="text-gray-600 mb-4">
              Redirecting to dashboard...
            </p>
            <div className="mt-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600 mx-auto"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="bg-white rounded-lg shadow-xl p-8 text-center">
            <div className="mb-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto"></div>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Verifying Email...</h1>
            <p className="text-gray-600">
              Please wait while we verify your email address.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Verify Your Email</h1>
            <p className="text-gray-600">
              For your security, please verify your email to continue.
            </p>
            <p className="text-sm text-gray-500 mt-2">
              We send the verification code to your <strong className="text-gray-700">registered email</strong> only.
            </p>
            {email && (
              <p className="text-sm text-gray-500 mt-1">
                A 6-digit code has been sent to <strong className="text-gray-700">{email}</strong>
              </p>
            )}
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-3 text-center">
              Enter 6-digit code
            </label>
            <div className="flex gap-3 justify-center" onPaste={handlePaste}>
              {pin.map((digit, index) => (
                <input
                  key={index}
                  ref={(el: HTMLInputElement | null) => {
                    inputRefs.current[index] = el
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handlePinChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  disabled={loading}
                  autoFocus={index === 0}
                  className="w-14 h-16 text-center text-3xl font-semibold border-2 border-gray-300 rounded-lg focus:border-teal-500 focus:ring-2 focus:ring-teal-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <button
              onClick={() => handleVerify()}
              disabled={loading || pin.some(d => d === '')}
              className="w-full py-3 bg-teal-600 text-white rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {loading ? 'Verifying...' : 'Verify Email'}
            </button>

            <div className="text-center">
              <button
                onClick={() => handleSendPin()}
                disabled={resendCooldown > 0 || sending}
                className="text-sm text-teal-600 hover:text-teal-700 disabled:text-gray-400 disabled:cursor-not-allowed font-medium"
              >
                {sending ? 'Sending...' : resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
              </button>
            </div>

            <div className="text-center pt-4 border-t border-gray-200">
              <button
                onClick={() => router.push('/login')}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Back to Login
              </button>
            </div>
          </div>

          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs text-blue-800">
              <strong>Tip:</strong> Check your spam folder if you don&apos;t see the email. The code expires in 15 minutes.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  )
}

