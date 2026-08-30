'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import Layout from '@/components/Layout'
import PageAtmosphere from '@/components/PageAtmosphere'
import BackButton from '@/components/BackButton'
import api from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import { useToast } from '@/components/Toast'
import logger from '@/lib/logger'
import EmployeeForm, {
  createEmployeeSchema,
  CreateEmployeeFormValues,
  EMPLOYEE_ROLE_OPTIONS,
  toCreatePayload,
  formatPayRateDisplay,
  payMethodLabel,
} from '@/components/employees/EmployeeForm'

function roleLabel(role?: string) {
  return EMPLOYEE_ROLE_OPTIONS.find((r) => r.value === role)?.label || role || 'Front Desk'
}

export default function CreateEmployeePage() {
  const router = useRouter()
  const toast = useToast()
  const [ready, setReady] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateEmployeeFormValues>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: {
      role: 'FRONTDESK',
      preferred_name: '',
      phone: '',
      pin: '',
      job_role: '',
      pay_method: 'HOURLY',
      pay_rate: '',
    },
  })

  const preview = watch()
  const displayName = preview.name?.trim() || 'New team member'
  const preferred = preview.preferred_name?.trim()
  const initial = (preferred || displayName).charAt(0).toUpperCase()
  const email = preview.email?.trim()
  const jobTitle = preview.job_role?.trim()
  const payRate = preview.pay_rate
  const role = preview.role || 'FRONTDESK'
  const payMethod =
    role === 'HOUSEKEEPING' ? preview.pay_method || 'HOURLY' : 'HOURLY'
  const hasPin = Boolean(preview.pin && String(preview.pin).length === 4)

  useEffect(() => {
    if (role !== 'HOUSEKEEPING' && preview.pay_method === 'PER_ROOM') {
      setValue('pay_method', 'HOURLY')
    }
  }, [role, preview.pay_method, setValue])

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const user = await getCurrentUser()
        if (!(user.permissions || []).includes('user_management')) {
          router.replace('/dashboard')
          return
        }
        setReady(true)
      } catch {
        router.replace('/login')
      }
    }
    checkAccess()
  }, [router])

  const onSubmit = async (data: CreateEmployeeFormValues) => {
    setSubmitting(true)
    try {
      const response = await api.post('/users/admin/employees', toCreatePayload(data))
      toast.success('Employee created. A password setup email was sent.')
      router.push(`/employees/${response.data.id}`)
    } catch (error: any) {
      logger.error('Failed to create employee', error)
      toast.error(error.response?.data?.detail || 'Failed to create employee')
    } finally {
      setSubmitting(false)
    }
  }

  if (!ready) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20 text-sm text-slate-500">Loading…</div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="relative max-w-6xl mx-auto px-1 pb-8">
        <PageAtmosphere tall />

        <div className="relative space-y-6">
          <div>
            <BackButton fallbackHref="/employees">Employees</BackButton>
          </div>

          {/* Hero */}
          <div className="overflow-hidden rounded-2xl border border-slate-800/10 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.45)]">
            <div className="relative bg-slate-900 px-5 py-6 sm:px-7 sm:py-8 text-white">
              <div
                aria-hidden
                className="absolute inset-0 opacity-40"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 12% 20%, rgba(45,212,191,0.28), transparent 42%), radial-gradient(circle at 88% 10%, rgba(59,130,246,0.22), transparent 36%)',
                }}
              />
              <div
                aria-hidden
                className="absolute inset-y-0 right-0 w-1/2 opacity-[0.07]"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(-32deg, transparent, transparent 10px, white 10px, white 11px)',
                }}
              />
              <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-xl">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Team · Add member
                  </p>
                  <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight">
                    New employee
                  </h1>
                  <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                    Capture identity, role, and pay in one pass. We’ll email them a secure link to
                    set their password.
                  </p>
                </div>
                <ol className="flex flex-wrap gap-2 text-xs">
                  {[
                    { n: '01', label: 'Identity' },
                    { n: '02', label: 'Access' },
                    { n: '03', label: 'Job & pay' },
                    { n: '04', label: 'Invite' },
                  ].map((step) => (
                    <li
                      key={step.n}
                      className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-inset ring-white/15"
                    >
                      <span className="font-semibold tabular-nums text-teal-200">{step.n}</span>
                      <span className="text-slate-200">{step.label}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-6 items-start">
            <form onSubmit={handleSubmit(onSubmit)} className="min-w-0">
              <EmployeeForm
                mode="create"
                register={register}
                errors={errors}
                submitting={submitting}
                onCancel={() => router.push('/employees')}
                showActions
                payMethod={payMethod}
                role={role}
              />
            </form>

            {/* Live preview */}
            <aside className="lg:sticky lg:top-6 space-y-4">
              <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
                <div className="bg-slate-900 px-5 py-5 text-white relative">
                  <div
                    aria-hidden
                    className="absolute inset-0 opacity-50"
                    style={{
                      backgroundImage:
                        'radial-gradient(circle at 80% 20%, rgba(45,212,191,0.25), transparent 50%)',
                    }}
                  />
                  <div className="relative flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 text-lg font-semibold">
                      {initial}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Preview
                      </p>
                      <p className="text-base font-semibold truncate">{displayName}</p>
                      {preferred && (
                        <p className="text-xs text-slate-300 truncate">Goes by {preferred}</p>
                      )}
                    </div>
                  </div>
                </div>
                <dl className="px-5 py-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">Email</dt>
                    <dd className="font-medium text-slate-800 truncate text-right">
                      {email || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">Role</dt>
                    <dd className="font-medium text-slate-800">{roleLabel(preview.role)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">Title</dt>
                    <dd className="font-medium text-slate-800 truncate text-right">
                      {jobTitle || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">Pay method</dt>
                    <dd className="font-medium text-slate-800">{payMethodLabel(payMethod)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">Pay</dt>
                    <dd className="font-medium text-slate-800 tabular-nums">
                      {payRate !== undefined && payRate !== '' && !Number.isNaN(Number(payRate))
                        ? formatPayRateDisplay(Number(payRate), payMethod)
                        : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">PIN</dt>
                    <dd className="font-medium text-slate-800">{hasPin ? 'Set' : 'Not set'}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-5 py-4 text-sm text-slate-600">
                <p className="font-semibold text-slate-900">After you create</p>
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed">
                  <li className="flex gap-2">
                    <span className="text-teal-600 font-semibold">1.</span>
                    Invite email with password setup link
                  </li>
                  <li className="flex gap-2">
                    <span className="text-teal-600 font-semibold">2.</span>
                    They appear in your employee directory
                  </li>
                  <li className="flex gap-2">
                    <span className="text-teal-600 font-semibold">3.</span>
                    You can edit details anytime from their profile
                  </li>
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </Layout>
  )
}
