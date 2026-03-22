'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import logger from '@/lib/logger'
import { useToast } from '@/components/Toast'
import BackButton from '@/components/BackButton'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FormField, Input, Select } from '@/components/FormField'
import { ButtonSpinner } from '@/components/LoadingSpinner'

const ROLES = ['ADMIN', 'DEVELOPER', 'MAINTENANCE', 'FRONTDESK', 'HOUSEKEEPING'] as const
const developerUserSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  role: z.enum(ROLES),
  status: z.enum(['active', 'inactive']),
  email_verified: z.boolean(),
  verification_required: z.boolean(),
  pin: z.string().max(4).optional().or(z.literal('')),
  pay_rate: z.string().optional(),
})
type DeveloperUserForm = z.infer<typeof developerUserSchema>

interface DeveloperUser {
  id: string
  company_id: string
  company_name: string
  name: string
  email: string
  role: string
  status: string
  email_verified: boolean
  verification_required: boolean
  created_at: string
  last_login_at: string | null
  has_pin: boolean
  pay_rate?: number
}

const isSuperAccount = (u: DeveloperUser) => u.role === 'DEVELOPER'

export default function DeveloperUserPage() {
  const router = useRouter()
  const params = useParams()
  const userId = params?.id as string
  const toast = useToast()
  const [user, setUser] = useState<DeveloperUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const form = useForm<DeveloperUserForm>({
    resolver: zodResolver(developerUserSchema),
    defaultValues: {
      name: '',
      email: '',
      role: 'FRONTDESK',
      status: 'active',
      email_verified: false,
      verification_required: true,
      pin: '',
      pay_rate: '',
    },
  })

  useEffect(() => {
    const run = async () => {
      try {
        const currentUser = await getCurrentUser()
        if (currentUser.role !== 'DEVELOPER') {
          router.push('/dashboard')
          return
        }
        const res = await api.get(`/developer/users/${userId}`)
        const u = res.data as DeveloperUser
        setUser(u)
        form.reset({
          name: u.name,
          email: u.email,
          role: u.role as DeveloperUserForm['role'],
          status: u.status as 'active' | 'inactive',
          email_verified: u.email_verified,
          verification_required: u.verification_required,
          pin: '',
          pay_rate: u.pay_rate != null ? String(u.pay_rate) : '',
        })
      } catch (e: any) {
        logger.error('Developer user fetch failed', e as Error, { userId })
        if (e.response?.status === 404) setUser(null)
      } finally {
        setLoading(false)
      }
    }
    if (userId) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, router])

  const onSubmit = async (data: DeveloperUserForm) => {
    if (!userId) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: data.name,
        email: data.email,
        role: data.role,
        status: data.status,
        email_verified: data.email_verified,
        verification_required: data.verification_required,
      }
      if (data.pin !== undefined && data.pin !== '') payload.pin = data.pin
      if (data.pay_rate !== undefined && data.pay_rate !== '') {
        const pr = parseFloat(data.pay_rate)
        if (!isNaN(pr) && pr >= 0) payload.pay_rate = pr
      }
      await api.put(`/developer/users/${userId}`, payload)
      toast.success('User updated successfully')
      const res = await api.get(`/developer/users/${userId}`)
      const updated = res.data as DeveloperUser
      setUser(updated)
      form.reset({
        name: updated.name,
        email: updated.email,
        role: updated.role as DeveloperUserForm['role'],
        status: updated.status as 'active' | 'inactive',
        email_verified: updated.email_verified,
        verification_required: updated.verification_required,
        pin: '',
        pay_rate: updated.pay_rate != null ? String(updated.pay_rate) : '',
      })
    } catch (e: any) {
      logger.error('Developer user update failed', e as Error)
      toast.error(e.response?.data?.detail || 'Failed to update user')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      </Layout>
    )
  }

  if (!user) {
    return (
      <Layout>
        <div className="px-4 py-8">
          <p className="text-slate-600">User not found.</p>
          <BackButton fallbackHref="/developer" className="mt-2 text-blue-600 hover:underline">
            Back to Developer Portal
          </BackButton>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0 max-w-2xl">
        <BackButton
          fallbackHref={isSuperAccount(user) ? '/developer' : `/developer/companies/${user.company_id}`}
          className="text-sm text-blue-600 hover:text-blue-700 mb-4"
        >
          Back
        </BackButton>

        <h1 className="text-2xl font-bold text-slate-900 mb-1">Edit User (Developer)</h1>
        <p className="text-sm text-slate-600 mb-6">
          {isSuperAccount(user) ? 'Super account (no company)' : `${user.company_name} — modify user info and verification`}
        </p>

        <form onSubmit={form.handleSubmit(onSubmit)} className="bg-white rounded-lg shadow p-6 space-y-6">
          <FormField label="Name" error={form.formState.errors.name?.message} required>
            <Input {...form.register('name')} error={!!form.formState.errors.name} />
          </FormField>
          <FormField label="Email" error={form.formState.errors.email?.message} required>
            <Input type="email" {...form.register('email')} error={!!form.formState.errors.email} />
          </FormField>
          <FormField label="Role" error={form.formState.errors.role?.message}>
            <Select {...form.register('role')} error={!!form.formState.errors.role}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Status" error={form.formState.errors.status?.message}>
            <Select {...form.register('status')} error={!!form.formState.errors.status}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </FormField>

          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Verification</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  {...form.register('email_verified')}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700">Email verified</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  {...form.register('verification_required')}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700">Verification required</span>
              </label>
            </div>
          </div>

          <FormField label="PIN (4 digits)" hint="Leave empty to keep current PIN" error={form.formState.errors.pin?.message}>
            <Input
              type="text"
              maxLength={4}
              placeholder="••••"
              {...form.register('pin')}
              error={!!form.formState.errors.pin}
            />
          </FormField>
          <FormField label="Pay rate (optional)" hint="Hourly rate in dollars" error={form.formState.errors.pay_rate?.message}>
            <Input type="number" step="0.01" min={0} {...form.register('pay_rate')} error={!!form.formState.errors.pay_rate} />
          </FormField>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <ButtonSpinner />}
              {saving ? 'Saving...' : 'Save'}
            </button>
            <BackButton
              fallbackHref={isSuperAccount(user) ? '/developer' : `/developer/companies/${user.company_id}`}
              className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
              showArrow={false}
            >
              Cancel
            </BackButton>
          </div>
        </form>
      </div>
    </Layout>
  )
}
