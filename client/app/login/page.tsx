'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { login, getCurrentUser } from '@/lib/auth'
import { startTokenRefreshInterval } from '@/lib/api'
import Link from 'next/link'

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
  const [currentYear, setCurrentYear] = useState<number | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    // Check if session expired
    if (searchParams?.get('expired') === 'true') {
      setSessionExpired(true)
    }
    // Set current year on client side to avoid hydration mismatch
    setCurrentYear(new Date().getFullYear())
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
      // Clear password from form state immediately after successful auth
      reset({ email: data.email, password: '' })
      // Start proactive token refresh after login
      startTokenRefreshInterval()
      
      // Get current user to check role and verification status
      try {
        const currentUser = await getCurrentUser()
        // If email not verified, send to verify-email page (user has tokens so that page can load)
        if (currentUser.verification_required || !currentUser.email_verified) {
          setLoading(false)
          window.location.href = `/verify-email?email=${encodeURIComponent(currentUser.email)}`
          return
        }
        if (currentUser.role === 'DEVELOPER') {
          router.push('/developer')
        } else {
          router.push('/dashboard')
        }
      } catch (err) {
        // If we can't get user, default to dashboard
        router.push('/dashboard')
      }
    } catch (err: any) {
      // Clear password field on any error so it is not left in memory longer than needed
      reset(undefined, { keepValues: false })
      // Handle rate limiting (429)
      if (err.response?.status === 429) {
        const msg = err.response?.data?.detail?.message || err.response?.data?.message
        setError(msg || 'Too many failed attempts. Please try again in a few minutes.')
        setLoading(false)
        return
      }
      // Handle network errors (server not responding)
      if (!err.response) {
        if (err.code === 'ERR_NETWORK' || err.message?.includes('Network Error') || err.message?.includes('ERR_EMPTY_RESPONSE')) {
          setError('Unable to connect to the server. Please make sure the server is running and try again.')
          setLoading(false)
          return
        }
        setError('Network error. Please check your connection and try again.')
        setLoading(false)
        return
      }
      
      // Handle email verification required (403) - only redirect in this case
      if (err.response?.status === 403) {
        const responseData = err.response?.data as Record<string, unknown> | undefined
        const detail = responseData?.detail
        const detailObj = typeof detail === 'object' && detail !== null ? detail as Record<string, unknown> : null
        const bodyStr = responseData != null ? JSON.stringify(responseData) : ''
        const isVerificationRequired =
          (err as { isVerificationRequired?: boolean }).isVerificationRequired === true ||
          detailObj?.error === 'EMAIL_VERIFICATION_REQUIRED' ||
          detail === 'EMAIL_VERIFICATION_REQUIRED' ||
          responseData?.error === 'EMAIL_VERIFICATION_REQUIRED' ||
          bodyStr.includes('EMAIL_VERIFICATION_REQUIRED')

        if (isVerificationRequired) {
          const email =
            (detailObj && typeof detailObj.email === 'string')
              ? detailObj.email
              : (err as { verificationEmail?: string }).verificationEmail || data.email
          setLoading(false)
          // Use full navigation so verify-email page loads reliably
          window.location.href = `/verify-email?email=${encodeURIComponent(email || '')}`
          return
        }
      }

      // For 401, 403 (non-verification), 400, etc.: stay on login page and show error
      let errorMessage = 'Login failed. Please try again.'
      const responseData = err.response?.data
      const detail = responseData?.detail
      
      // Log error for debugging (never log credentials or tokens)
      if (process.env.NODE_ENV === 'development') {
        const safeDetail = typeof detail === 'string' ? detail : (detail && typeof detail === 'object' && !('access_token' in (detail as object)) && !('refresh_token' in (detail as object)) ? detail : '[redacted]')
        console.error('Login error:', { status: err.response?.status, detail: safeDetail })
      }
      
      // Handle validation errors (422 or 400 with errors array)
      if (responseData?.errors && Array.isArray(responseData.errors)) {
        const validationErrors = responseData.errors.map((e: any) => {
          const field = e.field || e.loc?.join('.') || 'field'
          const msg = e.message || e.msg || 'Invalid value'
          return `${field}: ${msg}`
        }).join(', ')
        errorMessage = `Validation error: ${validationErrors}`
      } else if (detail) {
        if (typeof detail === 'string') {
          errorMessage = detail
        } else if (typeof detail === 'object' && detail?.message) {
          errorMessage = detail.message
        } else if (typeof detail === 'object' && detail?.error) {
          errorMessage = detail.error
        } else if (Array.isArray(detail)) {
          // Pydantic validation errors can be an array
          const validationErrors = detail.map((e: any) => {
            const field = e.loc?.join('.') || 'field'
            const msg = e.msg || e.message || 'Invalid value'
            return `${field}: ${msg}`
          }).join(', ')
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
    <div className="min-h-screen flex bg-slate-50">
      {/* Left: calm brand panel — no gradients (design system) */}
      <div className="hidden lg:flex lg:w-1/2 bg-slate-900 text-white">
        <div className="flex flex-col justify-center px-14 max-w-xl mx-auto w-full">
          <div className="flex items-center gap-2 mb-6">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500" aria-hidden />
            <p className="text-sm font-medium uppercase tracking-wider text-slate-400">ClockInn</p>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white mb-3">Time & attendance</h1>
          <p className="text-slate-400 text-base leading-relaxed">
            A clear, reliable workspace for teams to track hours, schedules, and payroll in one place.
          </p>
          <ul className="mt-10 space-y-3 text-sm text-slate-300">
            <li className="flex gap-2">
              <span className="text-slate-500 shrink-0">—</span>
              Accurate punch and schedule data
            </li>
            <li className="flex gap-2">
              <span className="text-slate-500 shrink-0">—</span>
              Built for hotels and multi-site operations
            </li>
            <li className="flex gap-2">
              <span className="text-slate-500 shrink-0">—</span>
              Role-based access for staff and managers
            </li>
          </ul>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center px-4 sm:px-6 lg:px-10 py-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden text-center mb-10">
            <div className="inline-flex items-center gap-2 justify-center mb-2">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-600" aria-hidden />
              <span className="text-lg font-semibold text-slate-900">ClockInn</span>
            </div>
            <p className="text-sm text-slate-500">Sign in to continue</p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-8 sm:p-9 shadow-sm">
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-slate-900 tracking-tight">Sign in</h2>
              <p className="text-sm text-slate-500 mt-1.5">Use your work email and password.</p>
            </div>

            <form
              className="space-y-6"
              method="post"
              action="#"
              onSubmit={(e) => {
                e.preventDefault()
                handleSubmit(onSubmit)(e)
              }}
            >
              {sessionExpired && (
                <div className="rounded-md border border-amber-200 bg-amber-50/80 px-4 py-3" role="status">
                  <p className="text-sm text-amber-900">Your session has expired. Please sign in again.</p>
                </div>
              )}
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50/80 px-4 py-3" role="alert">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              <div className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Email
                  </label>
                  <input
                    {...register('email')}
                    id="email"
                    type="email"
                    autoComplete="email"
                    className="block w-full px-3 py-2.5 border border-slate-300 rounded-md bg-white text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 sm:text-sm"
                    placeholder="you@company.com"
                  />
                  {errors.email && (
                    <p className="mt-1 text-sm text-red-600 flex items-center">
                      <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      {errors.email.message}
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                      Password
                    </label>
                    {mounted && (
                      <Link
                        href="/forgot-password"
                        className="text-sm font-medium text-blue-600 hover:text-blue-700"
                      >
                        Forgot password?
                      </Link>
                    )}
                  </div>
                  <input
                    {...register('password')}
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    className="block w-full px-3 py-2.5 border border-slate-300 rounded-md bg-white text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 sm:text-sm"
                    placeholder="••••••••"
                  />
                  {errors.password && (
                    <p className="mt-1 text-sm text-red-600 flex items-center">
                      <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      {errors.password.message}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center items-center py-2.5 px-4 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 focus:ring-offset-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Signing in...
                    </>
                  ) : (
                    'Sign in'
                  )}
                </button>
              </div>

              <div className="text-center pt-2">
                <p className="text-sm text-slate-600">
                  New company?{' '}
                  <Link href="/register" className="font-medium text-blue-600 hover:text-blue-700">
                    Create an account
                  </Link>
                </p>
              </div>
            </form>
          </div>

          <p className="mt-8 text-center text-xs text-slate-400">
            © {currentYear || new Date().getFullYear()} ClockInn. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="h-9 w-9 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-hidden />
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
