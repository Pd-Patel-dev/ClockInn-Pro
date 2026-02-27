'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'

const OTP_STORAGE_KEY = 'forgot_password_otp'

function VerifyCodeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [sending, setSending] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const resendCooldownRef = useRef(0)

  useEffect(() => {
    const emailParam = searchParams?.get('email')
    if (emailParam) {
      setEmail(decodeURIComponent(emailParam))
    } else {
      router.replace('/forgot-password')
    }
  }, [searchParams, router])

  const requestOtp = async (emailAddress: string) => {
    setSending(true)
    setError(null)
    try {
      await api.post('/auth/forgot-password', { email: emailAddress })
      setResendCooldown(60)
      resendCooldownRef.current = 60
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } }
      setError(ax.response?.data?.detail || 'Failed to send code. Please try again.')
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => {
      setResendCooldown((prev) => {
        const next = prev - 1
        resendCooldownRef.current = next
        return next
      })
    }, 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  const handlePinChange = (index: number, value: string) => {
    if (!/^\d$/.test(value) && value !== '') return
    const newPin = [...pin]
    newPin[index] = value
    setPin(newPin)
    setError(null)
    if (value && index < 5) inputRefs.current[index + 1]?.focus()
  }

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text').trim()
    if (/^\d{6}$/.test(text)) {
      setPin(text.split(''))
      inputRefs.current[5]?.focus()
    }
  }

  const handleContinue = () => {
    const otp = pin.join('')
    if (otp.length !== 6) {
      setError('Please enter the 6-digit code.')
      return
    }
    if (!email) {
      router.replace('/forgot-password')
      return
    }
    try {
      sessionStorage.setItem(OTP_STORAGE_KEY, otp)
      router.push(`/forgot-password/set-password?email=${encodeURIComponent(email)}`)
    } catch {
      setError('Could not continue. Please try again.')
    }
  }

  if (!email) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 relative overflow-hidden">
        <div className="absolute inset-0 bg-black/10" />
        <div className="relative z-10 flex flex-col justify-center px-12 text-white">
          <h1 className="text-5xl font-bold mb-4">ClockInn</h1>
          <p className="text-xl text-blue-100">Time & Attendance Management</p>
        </div>
      </div>
      <div className="w-full lg:w-1/2 flex items-center justify-center bg-gray-50 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">ClockInn</h1>
          </div>
          <div className="bg-white rounded-2xl shadow-xl p-8 sm:p-10">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Enter verification code</h2>
            <p className="text-gray-600 mb-6">
              We sent a 6-digit code to your registered email only.
            </p>
            <p className="text-sm text-gray-600 mb-6">
              Code sent to <strong className="text-gray-700">{email}</strong>
            </p>

            {error && (
              <div className="mb-6 rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-800">
                {error}
              </div>
            )}

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3 text-center">
                  Verification code
                </label>
                <div className="flex gap-2 justify-center" onPaste={handlePaste}>
                  {pin.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { inputRefs.current[i] = el }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handlePinChange(i, e.target.value)}
                      onKeyDown={(e) => handlePinKeyDown(i, e)}
                      disabled={loading}
                      className="w-12 h-14 text-center text-xl font-semibold border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                    />
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleContinue}
                disabled={loading || pin.some((d) => d === '')}
                className="w-full py-3 px-4 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                Continue
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => requestOtp(email)}
                  disabled={resendCooldown > 0 || sending}
                  className="text-sm text-blue-600 hover:text-blue-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  {sending ? 'Sending...' : resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                </button>
              </div>
            </div>

            <div className="mt-6 text-center">
              <Link href="/login" className="text-sm text-gray-500 hover:text-gray-700">
                Back to login
              </Link>
            </div>

            <p className="mt-6 text-xs text-gray-500 text-center">
              Code expires in 15 minutes. Check spam if you don&apos;t see the email.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function VerifyCodePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      }
    >
      <VerifyCodeContent />
    </Suspense>
  )
}
