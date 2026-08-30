'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { register } from '@/lib/auth'
import api from '@/lib/api'
import Link from 'next/link'
import {
  AuthShell,
  AuthFieldError,
  authInputClass,
  authLabelClass,
} from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/Button'

const registerSchema = z.object({
  company_name: z.string().min(1, 'Company name is required'),
  admin_name: z.string().min(1, 'Name is required'),
  admin_email: z.string().email('Invalid email address'),
  admin_password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
})

type RegisterForm = z.infer<typeof registerSchema>

function getPasswordStrength(pwd: string | undefined) {
  if (!pwd) return { strength: 0, label: '', barClass: '', labelClass: '' }
  let strength = 0
  if (pwd.length >= 8) strength++
  if (/[A-Z]/.test(pwd)) strength++
  if (/[a-z]/.test(pwd)) strength++
  if (/[0-9]/.test(pwd)) strength++
  if (/[^A-Za-z0-9]/.test(pwd)) strength++

  if (strength <= 2)
    return { strength, label: 'Weak', barClass: 'bg-danger', labelClass: 'text-danger' }
  if (strength <= 3)
    return { strength, label: 'Fair', barClass: 'bg-warning', labelClass: 'text-warning' }
  if (strength <= 4)
    return { strength, label: 'Good', barClass: 'bg-accent', labelClass: 'text-accent' }
  return { strength, label: 'Strong', barClass: 'bg-accent', labelClass: 'text-accent' }
}

export default function RegisterPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get('/auth/public-config')
      .then((res) => {
        if (cancelled) return
        const ok = Boolean(res.data?.allow_public_register)
        setAllowed(ok)
        if (!ok) router.replace('/login')
      })
      .catch(() => {
        if (!cancelled) router.replace('/login')
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [router])

  const {
    register: registerField,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
  })

  const password = watch('admin_password')
  const passwordStrength = getPasswordStrength(password)

  const onSubmit = async (data: RegisterForm) => {
    setError(null)
    setLoading(true)
    try {
      await register(data)
      router.push('/dashboard')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (checking || !allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent"
          aria-hidden
        />
      </div>
    )
  }

  return (
    <AuthShell
      eyebrow="Get started"
      headline="Create your workspace"
      description="Register your company once. You’ll add sites, roles, and schedules from the dashboard."
      bullets={[
        'One admin account per company signup',
        'Same security and roles as sign-in',
        'Invite team members after onboarding',
      ]}
      mobileSubtitle="Create your company account"
      formTitle="Register"
      formDescription="Company details and your admin login."
      footer={<>By registering you agree to our Terms of Service and Privacy Policy.</>}
    >
      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
        {error && (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 dark:border-red-500/30 dark:bg-red-500/10"
            role="alert"
          >
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        <div>
          <label htmlFor="company_name" className={authLabelClass}>
            Company name
          </label>
          <input
            {...registerField('company_name')}
            id="company_name"
            type="text"
            autoComplete="organization"
            className={authInputClass}
            placeholder="Acme Hospitality"
          />
          <AuthFieldError message={errors.company_name?.message} />
        </div>

        <div>
          <label htmlFor="admin_name" className={authLabelClass}>
            Your name
          </label>
          <input
            {...registerField('admin_name')}
            id="admin_name"
            type="text"
            autoComplete="name"
            className={authInputClass}
            placeholder="Jane Smith"
          />
          <AuthFieldError message={errors.admin_name?.message} />
        </div>

        <div>
          <label htmlFor="admin_email" className={authLabelClass}>
            Work email
          </label>
          <input
            {...registerField('admin_email')}
            id="admin_email"
            type="email"
            autoComplete="email"
            className={authInputClass}
            placeholder="you@company.com"
          />
          <AuthFieldError message={errors.admin_email?.message} />
        </div>

        <div>
          <label htmlFor="admin_password" className={authLabelClass}>
            Password
          </label>
          <input
            {...registerField('admin_password')}
            id="admin_password"
            type="password"
            autoComplete="new-password"
            className={authInputClass}
            placeholder="••••••••"
          />

          {password ? (
            <div className="mt-2.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-foreground-subtle">Strength</span>
                <span className={`text-xs font-medium ${passwordStrength.labelClass}`}>
                  {passwordStrength.label}
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-border-subtle"
                aria-hidden
              >
                <div
                  className={`h-full rounded-full transition-[width] duration-200 ${passwordStrength.barClass}`}
                  style={{ width: `${(passwordStrength.strength / 5) * 100}%` }}
                />
              </div>
            </div>
          ) : null}

          <AuthFieldError message={errors.admin_password?.message} />
          <p className="mt-2 text-xs text-foreground-subtle">
            At least 8 characters with uppercase, lowercase, and a number.
          </p>
        </div>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </Button>

        <p className="pt-1 text-center text-sm text-foreground-muted">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-accent hover:text-accent-hover">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}
