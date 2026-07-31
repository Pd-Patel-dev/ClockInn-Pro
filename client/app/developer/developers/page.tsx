'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import logger from '@/lib/logger'
import { useToast } from '@/components/Toast'
import { DeveloperAuthLoading, useDeveloperAuth } from '@/components/developer/useDeveloperAuth'
import { PortalUserTable } from '@/components/developer/PortalUserTable'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

export default function DeveloperDevelopersPage() {
  const { user, loading: authLoading } = useDeveloperAuth()
  const toast = useToast()
  const [rows, setRows] = useState<Parameters<typeof PortalUserTable>[0]['rows']>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const params: Record<string, string> = { role: 'DEVELOPER' }
        if (search.trim()) params.q = search.trim()
        const res = await api.get('/developer/users', { params })
        if (!cancelled) setRows(Array.isArray(res.data) ? res.data : [])
      } catch (e) {
        if (!cancelled) {
          setRows([])
          logger.error('Failed to load developers', e as Error)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    const t = setTimeout(load, search ? 250 : 0)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [authLoading, user, search, refreshKey])

  useEffect(() => {
    if (!dialogOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || submitting) return
      setDialogOpen(false)
      setFormError(null)
      setForm({ name: '', email: '', password: '', confirmPassword: '' })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dialogOpen, submitting])

  const closeDialog = () => {
    if (submitting) return
    setDialogOpen(false)
    setFormError(null)
    setForm({ name: '', email: '', password: '', confirmPassword: '' })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (form.password !== form.confirmPassword) {
      setFormError('Passwords do not match')
      return
    }
    if (form.password.length < 8) {
      setFormError('Password must be at least 8 characters')
      return
    }
    setSubmitting(true)
    try {
      await api.post('/developer/accounts', {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      })
      toast.success('Developer account created. They can log in with the email and password you set.')
      closeDialog()
      setRefreshKey((k) => k + 1)
    } catch (err: unknown) {
      const error = err as { response?: { status?: number; data?: { detail?: string } }; message?: string }
      const statusCode = error.response?.status
      const msg = error.response?.data?.detail || error.message || 'Failed to create developer account'
      if (statusCode === 409) {
        const conflictMsg =
          'This email is already in use by another user (in any company). Emails must be unique across the entire platform.'
        setFormError(conflictMsg)
        toast.error(conflictMsg)
      } else {
        setFormError(typeof msg === 'string' ? msg : JSON.stringify(msg))
        toast.error(typeof msg === 'string' ? msg : 'Failed to create developer account')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) return <DeveloperAuthLoading />

  return (
    <div className="mx-auto max-w-6xl">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Developers</CardTitle>
            <CardDescription>Platform developer accounts (no company).</CardDescription>
          </div>
          <Button className="shrink-0" onClick={() => { setFormError(null); setDialogOpen(true) }}>
            Add developer
          </Button>
        </CardHeader>
        <CardBody>
          <div className="mb-4">
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email…"
              className="max-w-md"
            />
          </div>
          {loading ? (
            <p className="text-sm text-foreground-muted">Loading developers…</p>
          ) : (
            <PortalUserTable rows={rows} showCompany={false} emptyLabel="No developers found." countLabel="developer(s)" />
          )}
        </CardBody>
      </Card>

      <Modal
        open={dialogOpen}
        onClose={closeDialog}
        title="Add developer account"
        description="Developer accounts have platform-wide access and do not belong to any company."
      >
        {formError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            {formError}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground-muted">Name</label>
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Developer name"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground-muted">Email</label>
            <Input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="developer@example.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground-muted">Password</label>
            <Input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Min 8 characters"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground-muted">Confirm password</label>
            <Input
              type="password"
              required
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              placeholder="Repeat password"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" className="flex-1" disabled={submitting} onClick={closeDialog}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={submitting}>
              Create
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
