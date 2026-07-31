'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import logger from '@/lib/logger'
import { useToast } from '@/components/Toast'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Modal,
  TabPanel,
  Tabs,
  Textarea,
} from '@/components/ui'

type EmailTab = 'overview' | 'templates' | 'delivery' | 'configuration' | 'suppressions'

const EMAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'templates', label: 'Templates' },
  { id: 'delivery', label: 'Delivery Log' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'suppressions', label: 'Suppressions' },
]

const STUB_TEMPLATES = [
  { id: 'welcome', name: 'Welcome', subject: 'Welcome to ClockInn Pro', status: 'active' as const },
  { id: 'password-reset', name: 'Password Reset', subject: 'Reset your password', status: 'active' as const },
  { id: 'verify-email', name: 'Email Verification', subject: 'Verify your email address', status: 'active' as const },
  { id: 'leave-approved', name: 'Leave Approved', subject: 'Your leave request was approved', status: 'draft' as const },
  { id: 'payroll-ready', name: 'Payroll Ready', subject: 'Payroll is ready for review', status: 'draft' as const },
]

const STUB_DELIVERY = [
  { id: '1', to: 'user@example.com', template: 'Email Verification', status: 'delivered', at: '2026-07-30T12:00:00Z' },
  { id: '2', to: 'admin@example.com', template: 'Welcome', status: 'delivered', at: '2026-07-29T09:15:00Z' },
  { id: '3', to: 'bounce@invalid.test', template: 'Password Reset', status: 'bounced', at: '2026-07-28T16:42:00Z' },
]

const STUB_SUPPRESSIONS = [
  { email: 'bounce@invalid.test', reason: 'Hard bounce', since: '2026-07-28' },
  { email: 'unsub@example.com', reason: 'Complaint', since: '2026-07-15' },
]

export default function EmailSettingsPage() {
  const router = useRouter()
  const toast = useToast()
  const [authReady, setAuthReady] = useState(false)
  const [tab, setTab] = useState<EmailTab>('overview')
  const [gmailHealth, setGmailHealth] = useState<{
    status?: string
    message?: string
    needs_reauthorization?: boolean
  } | null>(null)
  const [emailServiceDetails, setEmailServiceDetails] = useState<{
    email_service?: Record<string, unknown>
    configuration?: Record<string, unknown>
  } | null>(null)
  const [checkingGmail, setCheckingGmail] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [sendingTest, setSendingTest] = useState(false)
  const [templateModal, setTemplateModal] = useState<{ name: string; mode: 'edit' | 'preview' } | null>(null)

  const checkGmailHealth = useCallback(async () => {
    setCheckingGmail(true)
    try {
      const [healthRes, statsRes] = await Promise.all([
        api.get('/admin/gmail/health'),
        api.get('/developer/stats').catch(() => null),
      ])
      setGmailHealth(healthRes.data)
      if (statsRes?.data) {
        setEmailServiceDetails({
          email_service: statsRes.data.email_service,
          configuration: statsRes.data.configuration,
        })
      }
    } catch (error) {
      logger.error('Failed to check Gmail health', error as Error)
      toast.error('Failed to check Gmail service status')
      setGmailHealth({ status: 'error', message: 'Failed to check status' })
    } finally {
      setCheckingGmail(false)
    }
  }, [toast])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const currentUser = await getCurrentUser()
        if (cancelled) return
        if (currentUser.role === 'DEVELOPER') {
          setAuthReady(true)
          checkGmailHealth()
          return
        }
        if (currentUser.role === 'ADMIN') {
          router.replace('/settings')
          return
        }
        router.replace('/dashboard')
      } catch {
        router.push('/login')
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [router, checkGmailHealth])

  const handleUpdateGmailToken = async (tokenJson: string) => {
    try {
      await api.post('/admin/gmail/update-token', { token_json: tokenJson })
      toast.success('Gmail token updated successfully!')
      checkGmailHealth()
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } }
      logger.error('Failed to update Gmail token', error as Error)
      toast.error(err.response?.data?.detail || 'Failed to update Gmail token')
    }
  }

  const handleTestSend = async () => {
    const target = testEmail.trim()
    if (!target) {
      toast.error('Enter a test email address')
      return
    }
    setSendingTest(true)
    try {
      await api.post(`/admin/gmail/test-send?test_email=${encodeURIComponent(target)}`)
      toast.success(`Test email sent to ${target}`)
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } }
      logger.error('Failed to send test email', error as Error)
      toast.error(err.response?.data?.detail || 'Failed to send test email')
    } finally {
      setSendingTest(false)
    }
  }

  const es = emailServiceDetails?.email_service
  const cfg = emailServiceDetails?.configuration
  const healthy = gmailHealth?.status === 'healthy'

  if (!authReady) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    )
  }

  return (
    <>
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Email Service</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Gmail delivery, templates, and platform email configuration (developer only).
          </p>
        </div>

        <Tabs tabs={EMAIL_TABS} value={tab} onChange={(id) => setTab(id as EmailTab)} />

        <TabPanel id="overview" value={tab}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardBody className="space-y-2">
                <p className="text-xs font-medium uppercase text-foreground-muted">Service status</p>
                <Badge variant={healthy ? 'success' : 'danger'} dot>
                  {healthy ? 'Operational' : gmailHealth?.status === 'error' ? 'Error' : 'Degraded'}
                </Badge>
                <p className="text-xs text-foreground-subtle">{gmailHealth?.message || '—'}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-1">
                <p className="text-xs font-medium uppercase text-foreground-muted">Delivered (24h)</p>
                <p className="text-2xl font-semibold text-foreground">—</p>
                <p className="text-xs text-foreground-subtle">Stub metric</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-1">
                <p className="text-xs font-medium uppercase text-foreground-muted">Bounce rate</p>
                <p className="text-2xl font-semibold text-foreground">—</p>
                <p className="text-xs text-foreground-subtle">Stub metric</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-1">
                <p className="text-xs font-medium uppercase text-foreground-muted">Queue depth</p>
                <p className="text-2xl font-semibold text-foreground">0</p>
                <p className="text-xs text-foreground-subtle">Stub metric</p>
              </CardBody>
            </Card>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Gmail health</CardTitle>
                <CardDescription>Live check from GET /admin/gmail/health</CardDescription>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" loading={checkingGmail} onClick={checkGmailHealth}>
                    Refresh
                  </Button>
                  {gmailHealth?.needs_reauthorization && (
                    <Badge variant="warning">Re-authorization required</Badge>
                  )}
                </div>
                {es && (
                  <dl className="grid gap-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-foreground-muted">Sender</dt>
                      <dd className="font-medium">{String(es.sender_email || 'N/A')}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-foreground-muted">Operational</dt>
                      <dd>{es.operational ? 'Yes' : 'No'}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-foreground-muted">Token valid</dt>
                      <dd>{es.token_valid === undefined ? '—' : es.token_valid ? 'Yes' : 'No'}</dd>
                    </div>
                  </dl>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Send test email</CardTitle>
                <CardDescription>POST /admin/gmail/test-send</CardDescription>
              </CardHeader>
              <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="mb-1 block text-sm font-medium text-foreground-muted">Recipient</label>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                  />
                </div>
                <Button loading={sendingTest} onClick={handleTestSend}>
                  Send test
                </Button>
              </CardBody>
            </Card>
          </div>
        </TabPanel>

        <TabPanel id="templates" value={tab}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STUB_TEMPLATES.map((t) => (
              <Card key={t.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>{t.name}</CardTitle>
                    <Badge variant={t.status === 'active' ? 'success' : 'neutral'}>{t.status}</Badge>
                  </div>
                  <CardDescription>{t.subject}</CardDescription>
                </CardHeader>
                <CardBody className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setTemplateModal({ name: t.name, mode: 'edit' })}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setTemplateModal({ name: t.name, mode: 'preview' })}
                  >
                    Preview
                  </Button>
                </CardBody>
              </Card>
            ))}
          </div>
        </TabPanel>

        <TabPanel id="delivery" value={tab}>
          <Card>
            <CardHeader>
              <CardTitle>Delivery log</CardTitle>
              <CardDescription>Sample entries — full log API not wired yet</CardDescription>
            </CardHeader>
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-border-subtle/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-foreground-muted">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-foreground-muted">To</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-foreground-muted">Template</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-foreground-muted">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {STUB_DELIVERY.map((row) => (
                    <tr key={row.id} className="hover:bg-border-subtle/40">
                      <td className="px-4 py-3 text-foreground-muted">{new Date(row.at).toLocaleString()}</td>
                      <td className="px-4 py-3">{row.to}</td>
                      <td className="px-4 py-3">{row.template}</td>
                      <td className="px-4 py-3">
                        <Badge variant={row.status === 'delivered' ? 'success' : 'danger'}>{row.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </TabPanel>

        <TabPanel id="configuration" value={tab}>
          <div className="space-y-6">
            {gmailHealth?.needs_reauthorization && (
              <Card className="border-amber-500/30 bg-amber-500/5">
                <CardHeader>
                  <CardTitle>Re-authorization required</CardTitle>
                  <CardDescription>The Gmail refresh token has expired. Follow these steps:</CardDescription>
                </CardHeader>
                <CardBody>
                  <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground-muted">
                    <li>
                      Visit{' '}
                      <a
                        href="https://developers.google.com/oauthplayground/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline"
                      >
                        Google OAuth 2.0 Playground
                      </a>
                    </li>
                    <li>
                      <strong className="text-foreground">Critical:</strong> Enable &quot;Use your own OAuth credentials&quot; in Settings
                    </li>
                    <li>Enter Client ID and Client Secret from Google Cloud Console</li>
                    <li>Select Gmail API v1 → https://www.googleapis.com/auth/gmail.send</li>
                    <li>Authorize, exchange code for tokens, copy refresh token JSON</li>
                    <li>Paste below and update token</li>
                  </ol>
                  <p className="mt-3 text-xs text-foreground-subtle">
                    See server/GMAIL_SETUP_PLAYGROUND.md for detailed instructions.
                  </p>
                </CardBody>
              </Card>
            )}

            {(es || cfg) && (
              <div className="grid gap-4 md:grid-cols-2">
                {es && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Email service status</CardTitle>
                    </CardHeader>
                    <CardBody className="space-y-2 text-sm">
                      {(
                        [
                          ['Initialized', es.initialized],
                          ['Has credentials', es.has_credentials],
                          ['Operational', es.operational],
                          ['Sender email', es.sender_email || 'N/A'],
                          ['Token valid', es.token_valid],
                          ['Token expired', es.token_expired],
                          ['Has refresh token', es.has_refresh_token],
                        ] as [string, unknown][]
                      ).map(([label, val]) =>
                        val !== undefined ? (
                          <div key={label} className="flex justify-between gap-3">
                            <span className="text-foreground-muted">{label}</span>
                            <span className="font-medium">
                              {typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val)}
                            </span>
                          </div>
                        ) : null
                      )}
                    </CardBody>
                  </Card>
                )}
                {cfg && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Gmail configuration</CardTitle>
                    </CardHeader>
                    <CardBody className="space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <span className="text-foreground-muted">Credentials configured</span>
                        <span>{cfg.gmail_credentials_configured ? 'Yes' : 'No'}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-foreground-muted">Token configured</span>
                        <span>{cfg.gmail_token_configured ? 'Yes' : 'No'}</span>
                      </div>
                      {cfg.email_configured !== undefined && (
                        <div className="flex justify-between gap-3">
                          <span className="text-foreground-muted">Email configured</span>
                          <span>{cfg.email_configured ? 'Yes' : 'No'}</span>
                        </div>
                      )}
                    </CardBody>
                  </Card>
                )}
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Update Gmail token</CardTitle>
                <CardDescription>Paste token JSON from OAuth Playground</CardDescription>
              </CardHeader>
              <CardBody>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const fd = new FormData(e.currentTarget)
                    const tokenJson = String(fd.get('tokenJson') || '').trim()
                    if (tokenJson) handleUpdateGmailToken(tokenJson)
                  }}
                  className="space-y-4"
                >
                  <Textarea
                    name="tokenJson"
                    rows={6}
                    className="font-mono text-xs"
                    placeholder='{"refresh_token": "...", "client_id": "...", "client_secret": "..."}'
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit">Update token</Button>
                    <Button type="button" variant="secondary" loading={checkingGmail} onClick={checkGmailHealth}>
                      Test connection
                    </Button>
                  </div>
                </form>
              </CardBody>
            </Card>
          </div>
        </TabPanel>

        <TabPanel id="suppressions" value={tab}>
          <Card>
            <CardHeader>
              <CardTitle>Suppressions</CardTitle>
              <CardDescription>Addresses blocked from delivery (stub list)</CardDescription>
            </CardHeader>
            <CardBody className="space-y-3">
              {STUB_SUPPRESSIONS.map((s) => (
                <div
                  key={s.email}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-foreground">{s.email}</p>
                    <p className="text-xs text-foreground-muted">{s.reason} · since {s.since}</p>
                  </div>
                  <Badge variant="danger">Suppressed</Badge>
                </div>
              ))}
            </CardBody>
          </Card>
        </TabPanel>
      </div>

      <Modal
        open={!!templateModal}
        onClose={() => setTemplateModal(null)}
        title={templateModal ? `${templateModal.mode === 'edit' ? 'Edit' : 'Preview'}: ${templateModal.name}` : ''}
        description="Template editor is not connected to the backend yet."
        footer={
          <Button variant="secondary" onClick={() => setTemplateModal(null)}>
            Close
          </Button>
        }
      >
        <p className="text-sm text-foreground-muted">
          HTML body and variables will appear here when the templates API is available.
        </p>
      </Modal>
    </>
  )
}
