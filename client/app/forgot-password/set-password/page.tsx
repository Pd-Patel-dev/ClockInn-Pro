'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'

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
    setLoading(true)
    setError(null)
    try {
      await api.post('/auth/reset-password', {
        email,
        otp,
        new_password: data.new_password,
        confirm_password: data.confirm_password,
      })
      sessionStorage.removeItem(OTP_STORAGE_KEY)
      setSuccess(true)
      setTimeout(() => router.push('/login'), 2000)
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } }
      setError(ax.response?.data?.detail || 'Failed to reset password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
              <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Password reset successfully</h1>
            <p className="text-gray-600">Redirecting to login...</p>
          </div>
        </div>
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
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Set new password</h2>
            <p className="text-gray-600 mb-6">
              Enter your new password for <strong className="text-gray-700">{email}</strong>.
            </p>

            {error && (
              <div className="mb-6 rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-800">
                {error}
              </div>
            )}

            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div>
                <label htmlFor="new_password" className="block text-sm font-medium text-gray-700 mb-2">
                  New password
                </label>
                <input
                  {...form.register('new_password')}
                  type="password"
                  autoComplete="new-password"
                  className="block w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="New password"
                />
                {form.formState.errors.new_password && (
                  <p className="mt-1 text-sm text-red-600">{form.formState.errors.new_password.message}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  At least 8 characters, with uppercase, lowercase, and a number
                </p>
              </div>
              <div>
                <label htmlFor="confirm_password" className="block text-sm font-medium text-gray-700 mb-2">
                  Confirm password
                </label>
                <input
                  {...form.register('confirm_password')}
                  type="password"
                  autoComplete="new-password"
                  className="block w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Confirm password"
                />
                {form.formState.errors.confirm_password && (
                  <p className="mt-1 text-sm text-red-600">{form.formState.errors.confirm_password.message}</p>
                )}
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {loading ? 'Resetting...' : 'Reset password'}
              </button>
            </form>

            <div className="mt-6 text-center">
              <Link
                href={email ? `/forgot-password/verify?email=${encodeURIComponent(email)}` : '/forgot-password'}
                className="text-sm font-medium text-blue-600 hover:text-blue-500"
              >
                Use a different code
              </Link>
            </div>
            <div className="mt-2 text-center">
              <Link href="/login" className="text-sm text-gray-500 hover:text-gray-700">
                Back to login
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      }
    >
      <SetPasswordContent />
    </Suspense>
  )
}
