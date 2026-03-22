'use client'

import { useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import BackButton from '@/components/BackButton'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'

const emailSchema = z.object({
  email: z.string().email('Invalid email address'),
})

type EmailForm = z.infer<typeof emailSchema>

function ForgotPasswordContent() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const emailForm = useForm<EmailForm>({
    resolver: zodResolver(emailSchema),
  })

  const onSubmit = async (data: EmailForm) => {
    setLoading(true)
    setError(null)
    try {
      await api.post('/auth/forgot-password', { email: data.email })
      router.push(`/forgot-password/verify?email=${encodeURIComponent(data.email)}`)
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string | string[] } } }
      const d = ax.response?.data?.detail
      setError(
        Array.isArray(d) ? d[0] ?? 'Failed to send code. Please try again.' : (d || 'Failed to send code. Please try again.')
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      <div className="hidden lg:flex lg:w-1/2 bg-slate-900 text-white">
        <div className="flex flex-col justify-center px-14 max-w-xl mx-auto w-full">
          <div className="flex items-center gap-2 mb-6">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500" aria-hidden />
            <p className="text-sm font-medium uppercase tracking-wider text-slate-400">ClockInn</p>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white mb-3">Reset your password</h1>
          <p className="text-slate-400 text-base leading-relaxed">
            We&apos;ll email a short verification code to the address on your account. Check spam if you don&apos;t see it.
          </p>
        </div>
      </div>
      <div className="w-full lg:w-1/2 flex items-center justify-center px-4 sm:px-6 lg:px-10 py-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden text-center mb-10">
            <div className="inline-flex items-center gap-2 justify-center mb-2">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-600" aria-hidden />
              <span className="text-lg font-semibold text-slate-900">ClockInn</span>
            </div>
            <p className="text-sm text-slate-500">Forgot password</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-8 sm:p-9 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900 tracking-tight mb-1.5">Forgot password</h2>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
              Enter your <strong className="font-medium text-slate-700">registered work email</strong>. We only send the code to the email on your account.
            </p>

            {error && (
              <div className="mb-6 rounded-md border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-red-800" role="alert">
                {error}
              </div>
            )}

            <form onSubmit={emailForm.handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Email
                </label>
                <input
                  {...emailForm.register('email')}
                  id="email"
                  type="email"
                  autoComplete="email"
                  className="block w-full px-3 py-2.5 border border-slate-300 rounded-md bg-white text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 sm:text-sm"
                  placeholder="you@company.com"
                />
                {emailForm.formState.errors.email && (
                  <p className="mt-1 text-sm text-red-600">{emailForm.formState.errors.email.message}</p>
                )}
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 focus:ring-offset-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Sending…' : 'Send verification code'}
              </button>
            </form>

            <div className="mt-8 text-center">
              <BackButton fallbackHref="/login" className="text-sm font-medium text-blue-600 hover:text-blue-700">
                Back to sign in
              </BackButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="h-9 w-9 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-hidden />
        </div>
      }
    >
      <ForgotPasswordContent />
    </Suspense>
  )
}
