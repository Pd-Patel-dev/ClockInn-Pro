'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import {
  AuthShell,
  AuthFieldError,
  authInputClass,
  authLabelClass,
} from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/Button'

const OTP_STORAGE_KEY = 'forgot_password_otp'

const passwordSchema = z
  .object({
    new_password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .refine((p) => /[A-Z]/.test(p), 'Must contain one uppercase letter')
      .refine((p) => /[a-z]/.test(p), 'Must contain one lowercase letter')
      .refine((p) => /[0-9]/.test(p), 'Must contain one number'),
    confirm_password: z.string().min(8, 'Confirm your password'),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "Passwords don't match",
    path: ['confirm_password'],
  })

type PasswordForm = z.infer<typeof passwordSchema>

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

function SetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [ready, setReady] = useState(false)

  const form = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { new_password: '', confirm_password: '' },
  })

  useEffect(() => {
    const emailParam = searchParams?.get('email')
    const storedOtp = typeof window !== 'undefined' ? sessionStorage.getItem(OTP_STORAGE_KEY) : null
    if (emailParam && storedOtp) {
      setEmail(decodeURIComponent(emailParam))
      setOtp(storedOtp)
      setReady(true)
    } else if (emailParam) {
      router.replace(`/forgot-password/verify?email=${encodeURIComponent(emailParam)}`)
    } else {
      router.replace('/forgot-password')
    }
  }, [searchParams, router])

  const onSubmit = async (data: PasswordForm) => {
    if (!email || !otp) {
      setError('Session expired. Please start over from the forgot password page.')
      return
    }
    const trimmedEmail = email.trim()
    const trimmedOtp = otp.trim()
    if (!trimmedEmail || trimmedOtp.length !== 6) {
      setError('Session expired or invalid code. Please start over from the forgot password page.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await api.post('/auth/reset-password', {
        email: trimmedEmail,
        otp: trimmedOtp,
        new_password: data.new_password,
        confirm_password: data.confirm_password,
      })
      sessionStorage.removeItem(OTP_STORAGE_KEY)
      setSuccess(true)
      setTimeout(() => router.push('/login'), 2000)
    } catch (err: unknown) {
      const ax = err as {
        response?: { data?: { detail?: string | Array<{ msg?: string; loc?: string[] }> } }
      }
      const detail = ax.response?.data?.detail
      let message = 'Failed to reset password. Please try again.'
      if (typeof detail === 'string') {
        message = detail
      } else if (Array.isArray(detail) && detail.length > 0 && detail[0]?.msg) {
        message = detail[0].msg
      }
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  if (!ready) {
    return <AuthLoadingFallback />
  }

  if (success) {
    return (
      <AuthShell
        eyebrow="Account recovery"
        headline="You’re all set"
        description="Your password has been updated. You can sign in with your new credentials."
        bullets={[]}
        mobileSubtitle="Password updated"
        formTitle="Password reset successfully"
        formDescription="Redirecting to sign in…"
        footer={
          <Link href="/login" className="font-medium text-accent hover:text-accent-hover">
            Go to sign in
          </Link>
        }
      >
        <div className="flex flex-col items-center py-2 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/25">
            <svg
              className="h-6 w-6 text-emerald-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm text-foreground-muted">Taking you back to the login page.</p>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      headline="Choose a new password"
      description="Pick something strong and unique. You’ll use it the next time you sign in."
      bullets={[
        'At least 8 characters',
        'Include upper and lowercase letters',
        'Include at least one number',
      ]}
      mobileSubtitle="Set new password"
      formTitle="Set new password"
      formDescription={
        <>
          Account: <span className="font-medium text-foreground">{email}</span>
        </>
      }
      footer={
        <Link href="/login" className="font-medium text-accent hover:text-accent-hover">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {error && (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 dark:border-red-500/30 dark:bg-red-500/10"
            role="alert"
          >
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        <div>
          <label htmlFor="new_password" className={authLabelClass}>
            New password
          </label>
          <input
            {...form.register('new_password')}
            id="new_password"
            type="password"
            autoComplete="new-password"
            className={authInputClass}
            placeholder="New password"
          />
          <AuthFieldError message={form.formState.errors.new_password?.message} />
          <p className="mt-2 text-xs text-foreground-subtle">
            At least 8 characters, with uppercase, lowercase, and a number.
          </p>
        </div>

        <div>
          <label htmlFor="confirm_password" className={authLabelClass}>
            Confirm password
          </label>
          <input
            {...form.register('confirm_password')}
            id="confirm_password"
            type="password"
            autoComplete="new-password"
            className={authInputClass}
            placeholder="Confirm password"
          />
          <AuthFieldError message={form.formState.errors.confirm_password?.message} />
        </div>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
          {loading ? 'Resetting…' : 'Reset password'}
        </Button>
      </form>
    </AuthShell>
  )
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<AuthLoadingFallback />}>
      <SetPasswordContent />
    </Suspense>
  )
}
