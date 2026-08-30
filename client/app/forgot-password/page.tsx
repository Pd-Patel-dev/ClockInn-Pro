'use client'

import { useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
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

const emailSchema = z.object({
  email: z.string().email('Invalid email address'),
})

type EmailForm = z.infer<typeof emailSchema>

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
      const ax = err as { response?: { status?: number; data?: { detail?: string | string[] } } }
      const d = ax.response?.data?.detail
      const msg = Array.isArray(d) ? d[0] : d
      if (ax.response?.status === 503) {
        setError(
          msg ||
            'We could not send the email right now. Try again in a few minutes or contact your administrator.'
        )
      } else {
        setError(msg || 'Failed to send code. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      headline="Reset your password"
      description="We’ll email a short verification code to the address on your account. Check spam if you don’t see it."
      bullets={[
        'Codes go only to your registered work email',
        'Expires in 15 minutes for security',
        'You’ll set a new password after verifying',
      ]}
      mobileSubtitle="Forgot password"
      formTitle="Forgot password"
      formDescription={
        <>
          Enter your <span className="font-medium text-foreground">registered work email</span>. We
          only send the code to the email on your account.
        </>
      }
      footer={
        <Link href="/login" className="font-medium text-accent hover:text-accent-hover">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={emailForm.handleSubmit(onSubmit)} className="space-y-5">
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
            {...emailForm.register('email')}
            id="email"
            type="email"
            autoComplete="email"
            className={authInputClass}
            placeholder="you@company.com"
          />
          <AuthFieldError message={emailForm.formState.errors.email?.message} />
        </div>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
          {loading ? 'Sending…' : 'Send verification code'}
        </Button>
      </form>
    </AuthShell>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<AuthLoadingFallback />}>
      <ForgotPasswordContent />
    </Suspense>
  )
}
