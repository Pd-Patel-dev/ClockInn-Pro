'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api, { createCompanyWithAdmin } from '@/lib/api'
import logger from '@/lib/logger'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

const browserTimezone =
  typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago' : 'America/Chicago'

const companyTimezones = [
  'America/Chicago',
  'America/New_York',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
]

const emptyForm = () => ({
  name: '',
  timezone: browserTimezone,
  address: '',
  phone: '',
  email: '',
  email_verification_required: true,
  admin_name: '',
  admin_email: '',
  admin_pin: '',
})

export function CreateCompanyDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated?: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [form, setForm] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [adminEmailError, setAdminEmailError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [credentialsModal, setCredentialsModal] = useState<{
    companyId: string
    companyName: string
    adminEmail: string
    emailSent: boolean
  } | null>(null)

  const resetForm = () => {
    setForm(emptyForm())
    setAdminEmailError(null)
    setFormError(null)
  }

  const handleClose = (force = false) => {
    if (submitting && !force) return
    resetForm()
    onClose()
  }

  useEffect(() => {
    if (open) resetForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdminEmailError(null)
    setFormError(null)
    if (form.admin_pin && !/^\d{4}$/.test(form.admin_pin)) {
      setFormError('Admin PIN must be exactly 4 digits')
      return
    }
    setSubmitting(true)
    try {
      const result = await createCompanyWithAdmin({
        name: form.name.trim(),
        timezone: form.timezone || browserTimezone,
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        email_verification_required: form.email_verification_required,
        admin_name: form.admin_name.trim(),
        admin_email: form.admin_email.trim(),
        admin_pin: form.admin_pin.trim() || null,
      })
      toast.success(
        result.password_setup_email_sent
          ? `Company '${result.company.name}' created. Password setup email sent to ${result.admin.email}.`
          : `Company '${result.company.name}' created. Warning: password setup email may not have been sent to ${result.admin.email}.`,
      )
      setCredentialsModal({
        companyId: result.company.id,
        companyName: result.company.name,
        adminEmail: result.admin.email,
        emailSent: !!result.password_setup_email_sent,
      })
      handleClose(true)
      onCreated?.()
    } catch (err: unknown) {
      const error = err as { response?: { status?: number; data?: { detail?: string } }; message?: string }
      const statusCode = error.response?.status
      const msg = error.response?.data?.detail || error.message || 'Failed to create company'
      if (statusCode === 409) {
        setAdminEmailError('This email is already in use on the platform.')
      } else {
        setFormError(typeof msg === 'string' ? msg : 'Failed to create company')
      }
      logger.error('Developer create company failed', err as Error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Modal
        open={open && !credentialsModal}
        onClose={() => handleClose()}
        title="Create company"
        description="Create a tenant company and its first admin in one step."
        size="lg"
      >
        {formError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            {formError}
          </div>
        )}
        <form onSubmit={handleSubmit} className="grid max-h-[60vh] grid-cols-1 gap-6 overflow-y-auto md:grid-cols-2">
          <div className="space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-foreground">Company details</h4>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-muted">Name *</label>
              <Input
                required
                minLength={2}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-muted">Timezone</label>
              <Select
                value={form.timezone}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              >
                {!companyTimezones.includes(form.timezone) && (
                  <option value={form.timezone}>{form.timezone}</option>
                )}
                {companyTimezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-muted">Address</label>
              <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-muted">Phone</label>
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-muted">Company contact email</label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground-muted">
              <input
                type="checkbox"
                checked={form.email_verification_required}
                onChange={(e) => setForm((f) => ({ ...f, email_verification_required: e.target.checked }))}
                className="rounded border-border text-accent focus:ring-accent"
              />
              Email verification required for company users
            </label>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-foreground">First admin</h4>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-muted">Admin name *</label>
              <Input
                required
                minLength={2}
                value={form.admin_name}
                onChange={(e) => setForm((f) => ({ ...f, admin_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-muted">Admin email *</label>
              <Input
                type="email"
                required
                error={!!adminEmailError}
                value={form.admin_email}
                onChange={(e) => {
                  setAdminEmailError(null)
                  setForm((f) => ({ ...f, admin_email: e.target.value }))
                }}
              />
              {adminEmailError && <p className="mt-1 text-xs text-red-600">{adminEmailError}</p>}
              <p className="mt-2 text-xs text-foreground-subtle">
                The admin will receive a secure email link to set their own password. The link expires in 48 hours and
                can only be used once.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-muted">Admin PIN (optional)</label>
              <Input
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                value={form.admin_pin}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    admin_pin: e.target.value.replace(/\D/g, '').slice(0, 4),
                  }))
                }
                placeholder="4 digits"
              />
            </div>
          </div>

          <div className="flex gap-3 md:col-span-2">
            <Button type="button" variant="secondary" className="flex-1" disabled={submitting} onClick={() => handleClose()}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={submitting}>
              Create Company
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!credentialsModal}
        onClose={() => setCredentialsModal(null)}
        title="Company created"
        hideClose
        footer={
          <Button
            className="w-full"
            onClick={() => {
              const id = credentialsModal!.companyId
              setCredentialsModal(null)
              router.push(`/developer/companies/${id}`)
            }}
          >
            Continue to company
          </Button>
        }
      >
        {credentialsModal?.emailSent ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
            A secure set-password link was emailed to the admin. The link expires in 48 hours and can only be used once.
            Login is blocked until they set a password.
          </p>
        ) : (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            Company was created, but the password setup email may not have been sent. Check Email Service / Gmail
            configuration and ask the admin to request a new invite if needed.
          </p>
        )}
        <div className="mt-4 space-y-2 text-sm">
          <p>
            <span className="text-foreground-muted">Company:</span>{' '}
            <span className="font-medium">{credentialsModal?.companyName}</span>
          </p>
          <p>
            <span className="text-foreground-muted">Admin email:</span>{' '}
            <span className="font-medium">{credentialsModal?.adminEmail}</span>
          </p>
        </div>
      </Modal>
    </>
  )
}
