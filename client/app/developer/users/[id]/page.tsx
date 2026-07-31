'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import api from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import logger from '@/lib/logger'
import { useToast } from '@/components/Toast'
import BackButton from '@/components/BackButton'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FormField, Input, Select } from '@/components/FormField'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  TabPanel,
  Tabs,
} from '@/components/ui'

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
  company_id: string | null
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

const USER_TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Security' },
  { id: 'danger', label: 'Danger Zone' },
]

const isPlatformDeveloper = (u: DeveloperUser) => u.role === 'DEVELOPER' || u.company_id == null

export default function DeveloperUserPage() {
  const router = useRouter()
  const params = useParams()
  const userId = params?.id as string
  const toast = useToast()
  const [user, setUser] = useState<DeveloperUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [userTab, setUserTab] = useState('profile')

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
      } catch (e: unknown) {
        const err = e as { response?: { status?: number } }
        logger.error('Developer user fetch failed', e as Error, { userId })
        if (err.response?.status === 404) setUser(null)
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
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      logger.error('Developer user update failed', e as Error)
      toast.error(err.response?.data?.detail || 'Failed to update user')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
        <div className="min-h-[40vh] flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
    )
  }

  if (!user) {
    return (
        <div className="py-4">
          <p className="text-slate-600">User not found.</p>
          <BackButton fallbackHref="/developer/users" className="mt-2 text-blue-600 hover:underline">
            Back to users
          </BackButton>
        </div>
    )
  }

  return (
      <div className="max-w-5xl">
        <BackButton
          fallbackHref={isPlatformDeveloper(user) ? '/developer/developers' : `/developer/companies/${user.company_id}`}
          className="text-sm text-accent hover:underline mb-4"
        >
          Back
        </BackButton>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <Card>
            <CardBody className="flex flex-col items-center text-center sm:items-start sm:text-left">
              <Avatar name={user.name} size="lg" className="mb-3" />
              <h1 className="text-lg font-semibold text-foreground">{user.name}</h1>
              <p className="text-sm text-foreground-muted">{user.email}</p>
              <div className="mt-3 flex flex-wrap gap-2 justify-center sm:justify-start">
                <Badge variant="info">{user.role}</Badge>
                <Badge variant={user.status === 'active' ? 'success' : 'neutral'}>{user.status}</Badge>
              </div>
              <dl className="mt-4 w-full space-y-2 text-left text-sm">
                <div>
                  <dt className="text-foreground-muted">Company</dt>
                  <dd className="font-medium text-foreground">
                    {isPlatformDeveloper(user) ? 'Platform (none)' : user.company_name}
                  </dd>
                </div>
                <div>
                  <dt className="text-foreground-muted">Email verified</dt>
                  <dd>{user.email_verified ? 'Yes' : 'No'}</dd>
                </div>
                <div>
                  <dt className="text-foreground-muted">Last login</dt>
                  <dd>{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : '—'}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <div>
            <Tabs tabs={USER_TABS} value={userTab} onChange={setUserTab} className="mb-2" />

            <TabPanel id="profile" value={userTab}>
              <Card>
                <CardHeader>
                  <CardTitle>Profile</CardTitle>
                </CardHeader>
                <CardBody>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <FormField label="Name" error={form.formState.errors.name?.message} required>
                      <Input {...form.register('name')} error={!!form.formState.errors.name} />
                    </FormField>
                    <FormField label="Email" error={form.formState.errors.email?.message} required>
                      <Input type="email" {...form.register('email')} error={!!form.formState.errors.email} />
                    </FormField>
                    <FormField
                      label="Role"
                      error={form.formState.errors.role?.message}
                      hint={
                        isPlatformDeveloper(user)
                          ? 'Contact support to convert a developer account to a tenant user'
                          : undefined
                      }
                    >
                      <Select
                        {...form.register('role')}
                        error={!!form.formState.errors.role}
                        disabled={isPlatformDeveloper(user)}
                        title={
                          isPlatformDeveloper(user)
                            ? 'Contact support to convert a developer account to a tenant user'
                            : undefined
                        }
                      >
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

                    <div className="border-t border-border pt-4">
                      <h3 className="text-sm font-semibold text-foreground mb-3">Verification</h3>
                      <div className="space-y-3">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            {...form.register('email_verified')}
                            className="rounded border-border text-accent focus:ring-accent"
                          />
                          <span className="text-sm text-foreground-muted">Email verified</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            {...form.register('verification_required')}
                            className="rounded border-border text-accent focus:ring-accent"
                          />
                          <span className="text-sm text-foreground-muted">Verification required</span>
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
                      <Button type="submit" disabled={saving} loading={saving}>
                        Save
                      </Button>
                      <BackButton
                        fallbackHref={isPlatformDeveloper(user) ? '/developer' : `/developer/companies/${user.company_id}`}
                        className="inline-flex h-9 items-center rounded-control border border-border px-4 text-sm text-foreground-muted hover:bg-border-subtle"
                        showArrow={false}
                      >
                        Cancel
                      </BackButton>
                    </div>
                  </form>
                </CardBody>
              </Card>
            </TabPanel>

            <TabPanel id="security" value={userTab}>
              <Card>
                <CardHeader>
                  <CardTitle>Security</CardTitle>
                </CardHeader>
                <CardBody>
                  <p className="text-sm text-foreground-muted">
                    Force logout for all active sessions will be available when session management is exposed on the developer API.
                  </p>
                </CardBody>
              </Card>
            </TabPanel>

            <TabPanel id="danger" value={userTab}>
              <Card className="border-red-500/30">
                <CardHeader>
                  <CardTitle className="text-danger">Danger zone</CardTitle>
                </CardHeader>
                <CardBody>
                  <p className="text-sm text-foreground-muted">
                    Account deletion and irreversible actions are not enabled on this page yet. Use company or user management APIs when available.
                  </p>
                </CardBody>
              </Card>
            </TabPanel>
          </div>
        </div>
      </div>
  )
}
