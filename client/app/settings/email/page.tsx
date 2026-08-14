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
  Select,
} from '@/components/ui'

type EmailTab = 'overview' | 'delivery' | 'configuration'

const EMAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'delivery', label: 'Delivery Log' },
  { id: 'configuration', label: 'Configuration' },
]

type DeliveryLogItem = {
  id: string
  to_email: string
  subject: string | null
  template_key: string | null
  email_type?: string
  kind: string
  status: string
  provider_message_id: string | null
  error_message: string | null
  created_at: string | null
}

type DeliveryLogDetail = DeliveryLogItem & {
  sender_email: string | null
  receiver_email: string
  receiver_name: string | null
  receiver_role: string | null
  company_id: string | null
  company_name: string | null
  company_slug: string | null
  admins: { name: string; email: string; role: string }[]
}

type DeliveryStats24h = {
  sent: number
  failed: number
  skipped: number
  total: number
}

function statusBadgeVariant(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'sent') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'skipped') return 'warning'
  return 'neutral'
}

function formatEmailType(row: Pick<DeliveryLogItem, 'email_type' | 'template_key'>): string {
  if (row.email_type) return row.email_type
  if (!row.template_key) return 'Other'
  return row.template_key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

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
  const [deliveryLogs, setDeliveryLogs] = useState<DeliveryLogItem[]>([])
  const [deliveryTotal, setDeliveryTotal] = useState(0)
  const [deliveryStats, setDeliveryStats] = useState<DeliveryStats24h | null>(null)
  const [deliveryLoading, setDeliveryLoading] = useState(false)
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState('')
  const [deliveryQuery, setDeliveryQuery] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<DeliveryLogDetail | null>(null)

  const openDeliveryDetail = useCallback(
    async (id: string) => {
      setDetailOpen(true)
      setDetailLoading(true)
      setDetail(null)
      try {
        const res = await api.get(`/developer/email-delivery-logs/${id}`)
        setDetail(res.data as DeliveryLogDetail)
      } catch (error) {
        logger.error('Failed to load delivery log detail', error as Error)
        toast.error('Failed to load email details')
        setDetailOpen(false)
      } finally {
        setDetailLoading(false)
      }
    },
    [toast]
  )

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
  }, [toast.error])

  const loadDeliveryLogs = useCallback(async () => {
    setDeliveryLoading(true)
    try {
      const res = await api.get('/developer/email-delivery-logs', {
        params: {
          limit: 200,
          status: deliveryStatusFilter || undefined,
          q: deliveryQuery.trim() || undefined,
        },
      })
      setDeliveryLogs(Array.isArray(res.data?.items) ? res.data.items : [])
      setDeliveryTotal(Number(res.data?.total || 0))
      setDeliveryStats(res.data?.stats_24h || null)
    } catch (error) {
      logger.error('Failed to load email delivery logs', error as Error)
      toast.error('Failed to load delivery logs')
    } finally {
      setDeliveryLoading(false)
    }
  }, [deliveryStatusFilter, deliveryQuery, toast.error])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const currentUser = await getCurrentUser()
        if (cancelled) return
        if (currentUser.role === 'DEVELOPER') {
          setAuthReady(true)
          void checkGmailHealth()
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

  useEffect(() => {
    if (!authReady) return
    if (tab !== 'delivery' && tab !== 'overview') return
    const debounceMs = tab === 'delivery' && deliveryQuery ? 250 : 0
    const t = setTimeout(() => {
      void loadDeliveryLogs()
    }, debounceMs)
    return () => clearTimeout(t)
  }, [authReady, tab, loadDeliveryLogs])

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
      void loadDeliveryLogs()
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
            Gmail delivery and platform email configuration (developer only).
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
                <p className="text-2xl font-semibold text-foreground">
                  {deliveryStats ? deliveryStats.sent : '—'}
                </p>
                <p className="text-xs text-foreground-subtle">
                  {deliveryStats ? `${deliveryStats.total} attempts` : 'Loading…'}
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-1">
                <p className="text-xs font-medium uppercase text-foreground-muted">Failed (24h)</p>
                <p className="text-2xl font-semibold text-foreground">
                  {deliveryStats ? deliveryStats.failed : '—'}
                </p>
                <p className="text-xs text-foreground-subtle">
                  {deliveryStats && deliveryStats.total > 0
                    ? `${Math.round((deliveryStats.failed / deliveryStats.total) * 100)}% of attempts`
                    : 'No attempts yet'}
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-1">
                <p className="text-xs font-medium uppercase text-foreground-muted">Skipped (24h)</p>
                <p className="text-2xl font-semibold text-foreground">
                  {deliveryStats ? deliveryStats.skipped : '—'}
                </p>
                <p className="text-xs text-foreground-subtle">Blocked / not sent</p>
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

        <TabPanel id="delivery" value={tab}>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Delivery log</CardTitle>
                  <CardDescription>
                    All outbound email attempts ({deliveryTotal} total)
                  </CardDescription>
                </div>
                <Button variant="secondary" size="sm" loading={deliveryLoading} onClick={loadDeliveryLogs}>
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-[200px] flex-1">
                  <Input
                    placeholder="Search recipient or subject…"
                    value={deliveryQuery}
                    onChange={(e) => setDeliveryQuery(e.target.value)}
                  />
                </div>
                <Select
                  className="w-40"
                  value={deliveryStatusFilter}
                  onChange={(e) => setDeliveryStatusFilter(e.target.value)}
                  aria-label="Status filter"
                >
                  <option value="">All statuses</option>
                  <option value="sent">Sent</option>
                  <option value="failed">Failed</option>
                  <option value="skipped">Skipped</option>
                </Select>
              </div>

              <div className="overflow-x-auto rounded-control border border-border">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-border-subtle/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-foreground-muted">Time</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-foreground-muted">To</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-foreground-muted">Subject</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-foreground-muted">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-foreground-muted">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {deliveryLoading && deliveryLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-foreground-muted">
                          Loading delivery logs…
                        </td>
                      </tr>
                    ) : deliveryLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-foreground-muted">
                          No delivery logs yet. Sends will appear here after the next email goes out.
                        </td>
                      </tr>
                    ) : (
                      deliveryLogs.map((row) => (
                        <tr key={row.id} className="hover:bg-border-subtle/40" title={row.error_message || undefined}>
                          <td className="whitespace-nowrap px-4 py-3 text-foreground-muted">
                            {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                          </td>
                          <td className="px-4 py-3 font-medium text-foreground">{row.to_email}</td>
                          <td className="max-w-[220px] truncate px-4 py-3 text-foreground-muted">
                            {row.subject || '—'}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => void openDeliveryDetail(row.id)}
                              className="text-left font-medium text-accent underline-offset-2 hover:underline"
                            >
                              {formatEmailType(row)}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={statusBadgeVariant(row.status)}>{row.status}</Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          <Modal
            open={detailOpen}
            onClose={() => {
              setDetailOpen(false)
              setDetail(null)
            }}
            title={detail ? formatEmailType(detail) : 'Email details'}
            description={detail?.subject || undefined}
            size="lg"
            footer={
              <Button
                variant="secondary"
                onClick={() => {
                  setDetailOpen(false)
                  setDetail(null)
                }}
              >
                Close
              </Button>
            }
          >
            {detailLoading ? (
              <p className="py-6 text-center text-sm text-foreground-muted">Loading details…</p>
            ) : detail ? (
              <div className="space-y-5 text-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium uppercase text-foreground-muted">Status</p>
                    <div className="mt-1">
                      <Badge variant={statusBadgeVariant(detail.status)}>{detail.status}</Badge>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-foreground-muted">Sent at</p>
                    <p className="mt-1 text-foreground">
                      {detail.created_at ? new Date(detail.created_at).toLocaleString() : '—'}
                    </p>
                  </div>
                </div>

                <div className="rounded-control border border-border p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Sender</p>
                  <p className="mt-1 font-medium text-foreground">{detail.sender_email || '—'}</p>
                </div>

                <div className="rounded-control border border-border p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Receiver</p>
                  <p className="mt-1 font-medium text-foreground">
                    {detail.receiver_name || 'Unknown user'}
                  </p>
                  <p className="text-foreground-muted">{detail.receiver_email}</p>
                  {detail.receiver_role && (
                    <p className="mt-1 text-xs text-foreground-subtle">Role: {detail.receiver_role}</p>
                  )}
                </div>

                <div className="rounded-control border border-border p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Company</p>
                  <p className="mt-1 font-medium text-foreground">{detail.company_name || '—'}</p>
                  {detail.company_slug && (
                    <p className="text-xs text-foreground-subtle">Slug: {detail.company_slug}</p>
                  )}
                </div>

                <div className="rounded-control border border-border p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                    Company admins
                  </p>
                  {detail.admins.length === 0 ? (
                    <p className="mt-1 text-foreground-muted">No admins found for this company.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {detail.admins.map((admin) => (
                        <li key={admin.email} className="flex flex-col">
                          <span className="font-medium text-foreground">{admin.name}</span>
                          <span className="text-foreground-muted">{admin.email}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {detail.error_message && (
                  <div className="rounded-control border border-red-200 bg-red-50 p-3 text-red-800">
                    <p className="text-xs font-semibold uppercase">Error</p>
                    <p className="mt-1 whitespace-pre-wrap">{detail.error_message}</p>
                  </div>
                )}
              </div>
            ) : null}
          </Modal>
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
      </div>
    </>
  )
}
