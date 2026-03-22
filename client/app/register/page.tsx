'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { register } from '@/lib/auth'
import Link from 'next/link'

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

/** Muted strength meter: neutral track + semantic fill only where it helps (design system). */
function getPasswordStrength(pwd: string | undefined) {
  if (!pwd) return { strength: 0, label: '', barClass: '', labelClass: '' }
  let strength = 0
  if (pwd.length >= 8) strength++
  if (/[A-Z]/.test(pwd)) strength++
  if (/[a-z]/.test(pwd)) strength++
  if (/[0-9]/.test(pwd)) strength++
  if (/[^A-Za-z0-9]/.test(pwd)) strength++

  if (strength <= 2) return { strength, label: 'Weak', barClass: 'bg-red-500', labelClass: 'text-red-700' }
  if (strength <= 3) return { strength, label: 'Fair', barClass: 'bg-amber-500', labelClass: 'text-amber-800' }
  if (strength <= 4) return { strength, label: 'Good', barClass: 'bg-blue-500', labelClass: 'text-blue-700' }
  return { strength, label: 'Strong', barClass: 'bg-blue-600', labelClass: 'text-blue-800' }
}

const inputClass =
  'block w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm transition'

export default function RegisterPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Left: brand panel — aligned with login (no gradients) */}
      <div className="hidden lg:flex lg:w-1/2 bg-slate-900 text-white">
        <div className="flex flex-col justify-center px-14 max-w-xl mx-auto w-full">
          <div className="flex items-center gap-2 mb-6">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500" aria-hidden />
            <p className="text-sm font-medium uppercase tracking-wider text-slate-400">ClockInn</p>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white mb-3">Create your workspace</h1>
          <p className="text-slate-400 text-base leading-relaxed">
            Register your company once. You&apos;ll add sites, roles, and schedules from the dashboard.
          </p>
          <ul className="mt-10 space-y-3 text-sm text-slate-300">
            <li className="flex gap-2">
              <span className="text-slate-500 shrink-0">—</span>
              One admin account per company signup
            </li>
            <li className="flex gap-2">
              <span className="text-slate-500 shrink-0">—</span>
              Same security and roles as sign-in
            </li>
            <li className="flex gap-2">
              <span className="text-slate-500 shrink-0">—</span>
              Invite team members after onboarding
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
            <p className="text-sm text-slate-500">Create your company account</p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-8 sm:p-9 shadow-sm">
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-slate-900 tracking-tight">Register</h2>
              <p className="text-sm text-slate-500 mt-1.5">Company details and your admin login.</p>
            </div>

            <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50/80 px-4 py-3" role="alert">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              <div className="space-y-5">
                <div>
                  <label htmlFor="company_name" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Company name
                  </label>
                  <input
                    {...registerField('company_name')}
                    id="company_name"
                    type="text"
                    autoComplete="organization"
                    className={inputClass}
                    placeholder="Acme Hospitality"
                  />
                  {errors.company_name && (
                    <p className="mt-1 text-sm text-red-600 flex items-center">
                      <svg className="w-4 h-4 mr-1 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                        <path
                          fillRule="evenodd"
                          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {errors.company_name.message}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="admin_name" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Your name
                  </label>
                  <input
                    {...registerField('admin_name')}
                    id="admin_name"
                    type="text"
                    autoComplete="name"
                    className={inputClass}
                    placeholder="Jane Smith"
                  />
                  {errors.admin_name && (
                    <p className="mt-1 text-sm text-red-600 flex items-center">
                      <svg className="w-4 h-4 mr-1 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                        <path
                          fillRule="evenodd"
                          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {errors.admin_name.message}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="admin_email" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Work email
                  </label>
                  <input
                    {...registerField('admin_email')}
                    id="admin_email"
                    type="email"
                    autoComplete="email"
                    className={inputClass}
                    placeholder="you@company.com"
                  />
                  {errors.admin_email && (
                    <p className="mt-1 text-sm text-red-600 flex items-center">
                      <svg className="w-4 h-4 mr-1 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                        <path
                          fillRule="evenodd"
                          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {errors.admin_email.message}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="admin_password" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Password
                  </label>
                  <input
                    {...registerField('admin_password')}
                    id="admin_password"
                    type="password"
                    autoComplete="new-password"
                    className={inputClass}
                    placeholder="••••••••"
                  />

                  {password ? (
                    <div className="mt-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-500">Strength</span>
                        <span className={`text-xs font-medium ${passwordStrength.labelClass}`}>
                          {passwordStrength.label}
                        </span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden" aria-hidden>
                        <div
                          className={`h-full rounded-full transition-[width] duration-200 ${passwordStrength.barClass}`}
                          style={{ width: `${(passwordStrength.strength / 5) * 100}%` }}
                        />
                      </div>
                    </div>
                  ) : null}

                  {errors.admin_password && (
                    <p className="mt-1 text-sm text-red-600 flex items-center">
                      <svg className="w-4 h-4 mr-1 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                        <path
                          fillRule="evenodd"
                          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {errors.admin_password.message}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    At least 8 characters with uppercase, lowercase, and a number.
                  </p>
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
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" aria-hidden>
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Creating account…
                    </>
                  ) : (
                    'Create account'
                  )}
                </button>
              </div>

              <div className="text-center pt-2">
                <p className="text-sm text-slate-600">
                  Already have an account?{' '}
                  <Link href="/login" className="font-medium text-blue-600 hover:text-blue-700">
                    Sign in
                  </Link>
                </p>
              </div>
            </form>
          </div>

          <p className="mt-8 text-center text-xs text-slate-400">
            By registering you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  )
}
