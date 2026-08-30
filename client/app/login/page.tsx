'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { login, getCurrentUser } from '@/lib/auth'
import api, { startTokenRefreshInterval } from '@/lib/api'
import Link from 'next/link'
import {
  AuthShell,
  AuthFieldError,
  authInputClass,
  authLabelClass,
} from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/Button'

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginForm = z.infer<typeof loginSchema>

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [allowPublicRegister, setAllowPublicRegister] = useState(false)
  const currentYear = new Date().getFullYear()

  useEffect(() => {
    let cancelled = false
    api
      .get('/auth/public-config')
      .then((res) => {
        if (!cancelled) setAllowPublicRegister(Boolean(res.data?.allow_public_register))
      })
      .catch(() => {
        if (!cancelled) setAllowPublicRegister(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (searchParams?.get('expired') === 'true') {
      setSessionExpired(true)
    }
  }, [searchParams])

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginForm) => {
    setError(null)
    setSessionExpired(false)
    setLoading(true)
    try {
      await login(data)
      reset({ email: data.email, password: '' })
      startTokenRefreshInterval()

      try {
        const currentUser = await getCurrentUser()
        if (currentUser.verification_required || !currentUser.email_verified) {
          setLoading(false)
          window.location.href = `/verify-email?email=${encodeURIComponent(currentUser.email)}`
          return
        }
        const nextRaw = searchParams?.get('next') || ''
        const nextPath =
          nextRaw.startsWith('/') &&
          !nextRaw.startsWith('//') &&
          ['/payroll', '/dashboard', '/settings', '/employees', '/schedules', '/reports'].some(
            (allowed) => nextRaw === allowed || nextRaw.startsWith(`${allowed}/`)
          )
            ? nextRaw
            : null

        if (currentUser.role === 'DEVELOPER') {
          router.push('/developer')
        } else if (nextPath) {
          router.push(nextPath)
        } else {
          router.push('/dashboard')
        }
      } catch {
        router.push('/dashboard')
      }
    } catch (err: any) {
      reset(undefined, { keepValues: false })
      if (err.response?.status === 429) {
        const msg = err.response?.data?.detail?.message || err.response?.data?.message
        setError(msg || 'Too many failed attempts. Please try again in a few minutes.')
        setLoading(false)
        return
      }
      if (!err.response) {
        if (
          err.code === 'ERR_NETWORK' ||
          err.message?.includes('Network Error') ||
          err.message?.includes('ERR_EMPTY_RESPONSE')
        ) {
          setError(
            'Unable to connect to the server. Please make sure the server is running and try again.'
          )
          setLoading(false)
          return
        }
        setError('Network error. Please check your connection and try again.')
        setLoading(false)
        return
      }

      if (err.response?.status === 403) {
        const responseData = err.response?.data as Record<string, unknown> | undefined
        const detail = responseData?.detail
        const detailObj =
          typeof detail === 'object' && detail !== null
            ? (detail as Record<string, unknown>)
            : null
        const bodyStr = responseData != null ? JSON.stringify(responseData) : ''
        const isVerificationRequired =
          (err as { isVerificationRequired?: boolean }).isVerificationRequired === true ||
          detailObj?.error === 'EMAIL_VERIFICATION_REQUIRED' ||
          detail === 'EMAIL_VERIFICATION_REQUIRED' ||
          responseData?.error === 'EMAIL_VERIFICATION_REQUIRED' ||
          bodyStr.includes('EMAIL_VERIFICATION_REQUIRED')

        if (isVerificationRequired) {
          const email =
            detailObj && typeof detailObj.email === 'string'
              ? detailObj.email
              : (err as { verificationEmail?: string }).verificationEmail || data.email
          setLoading(false)
          window.location.href = `/verify-email?email=${encodeURIComponent(email || '')}`
          return
        }
      }

      let errorMessage = 'Login failed. Please try again.'
      const responseData = err.response?.data
      const detail = responseData?.detail

      if (process.env.NODE_ENV === 'development') {
        const safeDetail =
          typeof detail === 'string'
            ? detail
            : detail &&
                typeof detail === 'object' &&
                !('access_token' in (detail as object)) &&
                !('refresh_token' in (detail as object))
              ? detail
              : '[redacted]'
        console.error('Login error:', { status: err.response?.status, detail: safeDetail })
      }

      if (responseData?.errors && Array.isArray(responseData.errors)) {
        const validationErrors = responseData.errors
          .map((e: any) => {
            const field = e.field || e.loc?.join('.') || 'field'
            const msg = e.message || e.msg || 'Invalid value'
            return `${field}: ${msg}`
          })
          .join(', ')
        errorMessage = `Validation error: ${validationErrors}`
      } else if (detail) {
        if (typeof detail === 'string') {
          errorMessage = detail
        } else if (typeof detail === 'object' && detail?.message) {
          errorMessage = detail.message
        } else if (typeof detail === 'object' && detail?.error) {
          errorMessage = detail.error
        } else if (Array.isArray(detail)) {
          const validationErrors = detail
            .map((e: any) => {
              const field = e.loc?.join('.') || 'field'
              const msg = e.msg || e.message || 'Invalid value'
              return `${field}: ${msg}`
            })
            .join(', ')
          errorMessage = `Validation error: ${validationErrors}`
        }
      } else if (responseData?.message) {
        errorMessage = responseData.message
      } else if (err.message) {
        errorMessage = err.message
      }

      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Workforce · Operations"
      headline="Time & attendance, clearly organized"
      description="A reliable workspace for teams to track hours, schedules, housekeeping, and payroll in one place."
      bullets={[
        'Accurate punch and schedule data',
        'Built for hotels and multi-site operations',
        'Role-based access for staff and managers',
      ]}
      mobileSubtitle="Sign in to continue"
      formTitle="Sign in"
      formDescription="Use your work email and password."
      footer={<>© {currentYear} ClockInn. All rights reserved.</>}
    >
      <form
        className="space-y-5"
        method="post"
        action="#"
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit(onSubmit)(e)
        }}
      >
        {sessionExpired && (
          <div
            className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
            role="status"
          >
            <p className="text-sm text-amber-900 dark:text-amber-100">
              Your session has expired. Please sign in again.
            </p>
          </div>
        )}
        {error && (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 dark:border-red-500/30 dark:bg-red-500/10"
            role="alert"
          >
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        <div>
          <label htmlFor="email" className={authLabelClass}>
            Email
          </label>
          <input
            {...register('email')}
            id="email"
            type="email"
            autoComplete="email"
            className={authInputClass}
            placeholder="you@company.com"
          />
          <AuthFieldError message={errors.email?.message} />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <label htmlFor="password" className="text-sm font-medium text-foreground-muted">
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-accent hover:text-accent-hover"
            >
              Forgot password?
            </Link>
          </div>
          <input
            {...register('password')}
            id="password"
            type="password"
            autoComplete="current-password"
            className={authInputClass}
            placeholder="••••••••"
          />
          <AuthFieldError message={errors.password?.message} />
        </div>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>

        {allowPublicRegister && (
          <p className="pt-1 text-center text-sm text-foreground-muted">
            New company?{' '}
            <Link href="/register" className="font-medium text-accent hover:text-accent-hover">
              Create an account
            </Link>
          </p>
        )}
      </form>
    </AuthShell>
  )
}

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

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthLoadingFallback />}>
      <LoginContent />
    </Suspense>
  )
}
