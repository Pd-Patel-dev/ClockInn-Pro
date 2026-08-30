'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { AuthShell } from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/Button'

const OTP_STORAGE_KEY = 'forgot_password_otp'

function AuthLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page">
      <div
        className="h-9 w-9 animate-spin rounded-full border-2 border-border border-t-accent"
        aria-hidden
      />
    </div>
  )
}

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
    setLoading(true)
    try {
      sessionStorage.setItem(OTP_STORAGE_KEY, otp)
      router.push(`/forgot-password/set-password?email=${encodeURIComponent(email)}`)
    } catch {
      setError('Could not continue. Please try again.')
      setLoading(false)
    }
  }

  if (!email) {
    return <AuthLoadingFallback />
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      headline="Check your inbox"
      description="Enter the 6-digit code we sent to your registered email, then choose a new password."
      bullets={[
        'Code expires in 15 minutes',
        'Check spam if you don’t see the email',
        'You can resend after a short wait',
      ]}
      mobileSubtitle="Verify code"
      formTitle="Enter verification code"
      formDescription={
        <>
          Code sent to <span className="font-medium text-foreground">{email}</span>
        </>
      }
      footer={
        <Link href="/login" className="font-medium text-accent hover:text-accent-hover">
          Back to sign in
        </Link>
      }
    >
      <div className="space-y-5">
        {error && (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 dark:border-red-500/30 dark:bg-red-500/10"
            role="alert"
          >
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        <div>
          <label className="mb-3 block text-center text-sm font-medium text-foreground-muted">
            Verification code
          </label>
          <div className="flex justify-center gap-2" onPaste={handlePaste}>
            {pin.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputRefs.current[i] = el
                }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handlePinChange(i, e.target.value)}
                onKeyDown={(e) => handlePinKeyDown(i, e)}
                disabled={loading}
                aria-label={`Digit ${i + 1}`}
                className="h-12 w-11 rounded-xl border border-border bg-surface text-center text-lg font-semibold text-foreground shadow-sm transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60 sm:h-14 sm:w-12 sm:text-xl"
              />
            ))}
          </div>
        </div>

        <Button
          type="button"
          variant="primary"
          size="lg"
          className="w-full"
          loading={loading}
          disabled={pin.some((d) => d === '')}
          onClick={handleContinue}
        >
          Continue
        </Button>

        <div className="text-center">
          <button
            type="button"
            onClick={() => requestOtp(email)}
            disabled={resendCooldown > 0 || sending}
            className="text-sm font-medium text-accent hover:text-accent-hover disabled:cursor-not-allowed disabled:text-foreground-subtle"
          >
            {sending
              ? 'Sending…'
              : resendCooldown > 0
                ? `Resend code in ${resendCooldown}s`
                : 'Resend code'}
          </button>
        </div>

        <p className="text-center text-xs leading-relaxed text-foreground-subtle">
          If nothing arrives, ask your administrator to confirm Email Service is connected, or use{' '}
          <span className="font-medium text-foreground-muted">Employees → Resend invite</span> for
          new accounts.
        </p>
      </div>
    </AuthShell>
  )
}

export default function VerifyCodePage() {
  return (
    <Suspense fallback={<AuthLoadingFallback />}>
      <VerifyCodeContent />
    </Suspense>
  )
}
