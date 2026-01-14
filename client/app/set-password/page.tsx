'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import logger from '@/lib/logger'

const setPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(8, 'Password must be at least 8 characters'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
}).refine((data) => {
  // Check for at least one uppercase letter
  if (!/[A-Z]/.test(data.password)) return false
  // Check for at least one lowercase letter
  if (!/[a-z]/.test(data.password)) return false
  // Check for at least one number
  if (!/[0-9]/.test(data.password)) return false
  return true
}, {
  message: "Password must contain at least one uppercase letter, one lowercase letter, and one number",
  path: ["password"],
})

type SetPasswordForm = z.infer<typeof setPasswordSchema>

function SetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [token, setToken] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [userName, setUserName] = useState<string>('')
  const [loadingUserInfo, setLoadingUserInfo] = useState(true)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SetPasswordForm>({
    resolver: zodResolver(setPasswordSchema),
  })

  useEffect(() => {
    const tokenParam = searchParams?.get('token')
    if (tokenParam) {
      setToken(tokenParam)
      // Fetch user info from token
      fetchUserInfo(tokenParam)
    } else {
      setError('Invalid or missing token. Please check your email link.')
      setLoadingUserInfo(false)
    }
  }, [searchParams])

  const fetchUserInfo = async (tokenParam: string) => {
    try {
      const response = await api.get('/auth/set-password/info', {
        params: { token: tokenParam }
      })
      setUserName(response.data.name || '')
      setLoadingUserInfo(false)
    } catch (err: any) {
      logger.error('Failed to fetch user info', err as Error)
      setLoadingUserInfo(false)
      // Don't show error here, let the form submission handle it
    }
  }

  const onSubmit = async (data: SetPasswordForm) => {
    if (!token) {
      setError('Invalid or missing token. Please check your email link.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await api.post('/auth/set-password', {
        token,
        password: data.password,
      })
      
      setSuccess(true)
      logger.info('Password set successfully')
      
      // Redirect to login after 2 seconds
      setTimeout(() => {
        router.push('/login')
      }, 2000)
    } catch (err: any) {
      logger.error('Failed to set password', err as Error)
      
      // Handle network errors
      if (!err.response) {
        setError('Network error. Please check your connection and try again.')
      } else {
        // Handle API errors
        const errorMessage = err.response?.data?.detail || 'Failed to set password. Please try again.'
        setError(errorMessage)
      }
    } finally {
      setLoading(false)
    }
  }

  if (success) {
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
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Password Set Successfully!</h1>
            <p className="text-gray-600 mb-4">
              Your password has been set. Redirecting to login...
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (loadingUserInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto"></div>
          <div className="mt-4 text-gray-600">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {userName ? `Welcome, ${userName}!` : 'Set Your Password'}
            </h1>
            <p className="text-gray-600">
              {userName 
                ? `Please set a password for your account to get started.`
                : 'Please set a password for your account to get started.'
              }
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                New Password
              </label>
              <input
                {...register('password')}
                type="password"
                id="password"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Enter your password"
                disabled={loading || !token}
              />
              {errors.password && (
                <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Must be at least 8 characters with uppercase, lowercase, and a number
              </p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                Confirm Password
              </label>
              <input
                {...register('confirmPassword')}
                type="password"
                id="confirmPassword"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Confirm your password"
                disabled={loading || !token}
              />
              {errors.confirmPassword && (
                <p className="mt-1 text-sm text-red-600">{errors.confirmPassword.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !token}
              className="w-full py-3 bg-teal-600 text-white rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {loading ? 'Setting Password...' : 'Set Password'}
            </button>
          </form>

          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs text-blue-800">
              <strong>Note:</strong> This link will expire in 7 days. If you need a new link, please contact your administrator.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    }>
      <SetPasswordContent />
    </Suspense>
  )
}
