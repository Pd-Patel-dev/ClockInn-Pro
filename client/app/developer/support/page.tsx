'use client'

import { useCallback, useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import api from '@/lib/api'
import logger from '@/lib/logger'
import { DeveloperAuthLoading, useDeveloperAuth } from '@/components/developer/useDeveloperAuth'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

type SupportTicket = {
  id: string
  type: string
  status: string
  message: string
  user_id: string | null
  user_name: string
  user_email: string
  user_role: string | null
  company_id: string | null
  company_name: string | null
  page_path: string | null
  user_agent: string | null
  ip_address: string | null
  created_at: string | null
  resolved_at: string | null
  resolved_by_id: string | null
}

function typeLabel(type: string) {
  if (type === 'bug') return 'Bug'
  if (type === 'feedback') return 'Feedback'
  return 'Support'
}

function typeBadge(type: string) {
  if (type === 'bug') return 'bg-red-500/15 text-red-300 ring-red-500/25'
  if (type === 'feedback') return 'bg-sky-500/15 text-sky-300 ring-sky-500/25'
  return 'bg-amber-500/15 text-amber-200 ring-amber-500/25'
}

function formatWhen(value: string | null) {
  if (!value) return '—'
  try {
    return format(parseISO(value), 'MMM d, yyyy · h:mm a')
  } catch {
    return value
  }
}

export default function DeveloperSupportPage() {
  const { user, loading: authLoading } = useDeveloperAuth()
  const [items, setItems] = useState<SupportTicket[]>([])
  const [openCount, setOpenCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('open')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<SupportTicket | null>(null)
  const [updating, setUpdating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (statusFilter) params.status = statusFilter
      if (typeFilter) params.type = typeFilter
      if (search.trim()) params.q = search.trim()
      const res = await api.get('/developer/support-tickets', { params })
      setItems(Array.isArray(res.data?.items) ? res.data.items : [])
      setOpenCount(typeof res.data?.open_count === 'number' ? res.data.open_count : 0)
    } catch (e) {
      setItems([])
      logger.error('Failed to load support tickets', e as Error)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, typeFilter, search])

  useEffect(() => {
    if (authLoading || !user) return
    const t = setTimeout(load, search ? 250 : 0)
    return () => clearTimeout(t)
  }, [authLoading, user, load, search])

  const setStatus = async (ticket: SupportTicket, status: 'open' | 'resolved') => {
    setUpdating(true)
    try {
      const res = await api.patch(`/developer/support-tickets/${ticket.id}`, { status })
      const updated = res.data as SupportTicket
      setItems((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
      setSelected(updated)
      if (status === 'resolved' && statusFilter === 'open') {
        setItems((prev) => prev.filter((t) => t.id !== updated.id))
      }
      await load()
    } catch (e) {
      logger.error('Failed to update ticket', e as Error)
    } finally {
      setUpdating(false)
    }
  }

  if (authLoading) return <DeveloperAuthLoading />

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Support inbox</CardTitle>
              <CardDescription>
                Contact support, feedback, and bug reports from tenants.
                {openCount > 0 ? ` ${openCount} open.` : ''}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Input
                type="search"
                placeholder="Search name, email, company, message…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search tickets"
              />
            </div>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Status filter"
              className="sm:w-36"
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </Select>
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Type filter"
              className="sm:w-36"
            >
              <option value="">All types</option>
              <option value="support">Support</option>
              <option value="feedback">Feedback</option>
              <option value="bug">Bug</option>
            </Select>
          </div>

          {loading ? (
            <p className="py-10 text-center text-sm text-foreground-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-foreground-muted">No tickets match these filters.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {items.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(ticket)}
                    className="flex w-full flex-col gap-2 px-4 py-3 text-left transition hover:bg-border-subtle/60 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${typeBadge(ticket.type)}`}
                        >
                          {typeLabel(ticket.type)}
                        </span>
                        <span
                          className={`text-[11px] font-medium uppercase tracking-wide ${
                            ticket.status === 'open' ? 'text-amber-300' : 'text-foreground-subtle'
                          }`}
                        >
                          {ticket.status}
                        </span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-sm text-foreground">{ticket.message}</p>
                      <p className="mt-1 text-xs text-foreground-muted">
                        {ticket.user_name} · {ticket.user_email}
                        {ticket.company_name ? ` · ${ticket.company_name}` : ''}
                      </p>
                    </div>
                    <p className="shrink-0 text-xs text-foreground-subtle">{formatWhen(ticket.created_at)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="presentation"
          onClick={() => setSelected(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-ticket-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-lifted"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p id="support-ticket-title" className="text-sm font-semibold text-foreground">
                  {typeLabel(selected.type)} · {selected.status}
                </p>
                <p className="mt-0.5 text-xs text-foreground-subtle">{formatWhen(selected.created_at)}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg px-2 py-1 text-sm text-foreground-muted hover:bg-border-subtle"
              >
                Close
              </button>
            </div>

            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                  From
                </dt>
                <dd className="mt-1 text-foreground">
                  {selected.user_name}
                  <span className="block text-foreground-muted">{selected.user_email}</span>
                  {selected.user_role && (
                    <span className="mt-0.5 block text-xs text-foreground-subtle">{selected.user_role}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                  Company
                </dt>
                <dd className="mt-1 text-foreground">{selected.company_name || '—'}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                  Message
                </dt>
                <dd className="mt-1 whitespace-pre-wrap text-foreground">{selected.message}</dd>
              </div>
              {selected.page_path && (
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                    Page
                  </dt>
                  <dd className="mt-1 font-mono text-xs text-foreground-muted">{selected.page_path}</dd>
                </div>
              )}
              {(selected.ip_address || selected.user_agent) && (
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                    Client
                  </dt>
                  <dd className="mt-1 space-y-1 text-xs text-foreground-muted">
                    {selected.ip_address && <p>IP: {selected.ip_address}</p>}
                    {selected.user_agent && <p className="break-all">{selected.user_agent}</p>}
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-5 flex flex-wrap gap-2">
              {selected.status === 'open' ? (
                <Button
                  variant="primary"
                  loading={updating}
                  onClick={() => void setStatus(selected, 'resolved')}
                >
                  Mark resolved
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  loading={updating}
                  onClick={() => void setStatus(selected, 'open')}
                >
                  Reopen
                </Button>
              )}
              <Button variant="secondary" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
