'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Inbox, LayoutGrid, List, Search } from 'lucide-react'
import { useDeveloperAuth, DeveloperAuthLoading } from '@/components/developer/useDeveloperAuth'
import { useToast } from '@/components/Toast'
import {
  Button,
  Input,
  Select,
  Modal,
} from '@/components/ui'
import {
  TemplateCard,
  TemplateCardSkeleton,
  ResetFactoryModal,
  SendTestModal,
  PreviewPane,
} from '@/components/email-templates'
import {
  apiErrorMessage,
  listEmailTemplates,
  patchTemplateMetadata,
  previewTemplate,
  resetToFactory,
  sendTestEmail,
} from '@/lib/email-templates/api'
import type { EmailTemplateListItem, PreviewTab } from '@/lib/email-templates/types'
import logger from '@/lib/logger'

const CATEGORIES = [
  { value: '', label: 'All categories' },
  { value: 'TRANSACTIONAL', label: 'Transactional' },
  { value: 'NOTIFICATION', label: 'Notification' },
  { value: 'SUMMARY', label: 'Summary' },
  { value: 'MARKETING', label: 'Marketing' },
]

export default function EmailTemplatesListPage() {
  const { user, loading: authLoading } = useDeveloperAuth()
  const toast = useToast()
  const [templates, setTemplates] = useState<EmailTemplateListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [view, setView] = useState<'cards' | 'list'>('cards')
  const [resetTarget, setResetTarget] = useState<EmailTemplateListItem | null>(null)
  const [resetting, setResetting] = useState(false)
  const [sendTestTarget, setSendTestTarget] = useState<EmailTemplateListItem | null>(null)
  const [previewTarget, setPreviewTarget] = useState<EmailTemplateListItem | null>(null)
  const [previewTab, setPreviewTab] = useState<PreviewTab>('html')
  const [previewData, setPreviewData] = useState<{
    subject?: string
    body_html?: string
    body_text?: string
    error?: string | null
  }>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const items = await listEmailTemplates({
        category: category || undefined,
        q: q.trim() || undefined,
      })
      setTemplates(items)
    } catch (err) {
      logger.error('Failed to load email templates', err as Error)
      toast.error(apiErrorMessage(err, 'Failed to load templates'))
    } finally {
      setLoading(false)
    }
  }, [category, q, toast])

  useEffect(() => {
    if (authLoading || !user) return
    const t = setTimeout(() => {
      void load()
    }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [authLoading, user, load, q])

  const handleToggleEnabled = async (t: EmailTemplateListItem) => {
    try {
      await patchTemplateMetadata(t.id, { is_enabled: !t.is_enabled })
      toast.success(t.is_enabled ? 'Template disabled' : 'Template enabled')
      load()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to update template'))
    }
  }

  const handleReset = async () => {
    if (!resetTarget) return
    setResetting(true)
    try {
      await resetToFactory(resetTarget.id)
      toast.success('Draft reset to factory defaults')
      setResetTarget(null)
      load()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to reset template'))
    } finally {
      setResetting(false)
    }
  }

  const openPreview = async (t: EmailTemplateListItem) => {
    setPreviewTarget(t)
    setPreviewData({})
    try {
      const res = await previewTemplate(t.id, {
        version: t.has_draft ? 'draft' : 'published',
        format: 'both',
        variables: {},
      })
      setPreviewData({
        subject: res.subject,
        body_html: res.body_html,
        body_text: res.body_text,
        error: null,
      })
    } catch (err) {
      setPreviewData({ error: apiErrorMessage(err, 'Preview failed') })
    }
  }

  const hasFilters = Boolean(q.trim() || category)
  const filteredEmpty = !loading && templates.length === 0

  const clearFilters = () => {
    setQ('')
    setCategory('')
  }

  const header = useMemo(
    () => (
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/settings/email"
            className="mb-2 inline-flex items-center gap-1 text-sm text-accent hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Email Service
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Email templates</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Edit Jinja templates, preview, send tests, and publish versions.
          </p>
        </div>
      </div>
    ),
    []
  )

  if (authLoading || !user) return <DeveloperAuthLoading />

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {header}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
          <Input
            className="pl-9"
            placeholder="Search templates…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select
          className="w-44"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category filter"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value || 'all'} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        <div className="inline-flex rounded-control border border-border p-0.5">
          <Button
            size="sm"
            variant={view === 'cards' ? 'secondary' : 'ghost'}
            aria-pressed={view === 'cards'}
            onClick={() => setView('cards')}
            leftIcon={<LayoutGrid className="h-3.5 w-3.5" />}
          >
            Cards
          </Button>
          <Button
            size="sm"
            variant={view === 'list' ? 'secondary' : 'ghost'}
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
            leftIcon={<List className="h-3.5 w-3.5" />}
          >
            List
          </Button>
        </div>
      </div>

      {loading && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <TemplateCardSkeleton key={i} />
          ))}
        </div>
      )}

      {filteredEmpty && (
        <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-border px-6 py-16 text-center">
          <Inbox className="h-10 w-10 text-foreground-subtle" strokeWidth={1.5} aria-hidden />
          <p className="mt-4 text-sm font-medium text-foreground">No templates match your filters.</p>
          <p className="mt-1 max-w-sm text-sm text-foreground-muted">
            Try a different search or category, or clear filters to see all templates.
          </p>
          {hasFilters && (
            <Button className="mt-5" variant="secondary" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      )}

      {!loading && templates.length > 0 && (
        <div
          className={
            view === 'cards'
              ? 'grid gap-5 sm:grid-cols-2 lg:grid-cols-3'
              : 'flex flex-col gap-2'
          }
        >
          {templates.map((t, i) => (
            <TemplateCard
              key={t.id}
              template={t}
              view={view}
              index={i}
              onPreview={openPreview}
              onSendTest={setSendTestTarget}
              onToggleEnabled={handleToggleEnabled}
              onResetFactory={setResetTarget}
            />
          ))}
        </div>
      )}

      <ResetFactoryModal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        onConfirm={handleReset}
        loading={resetting}
        templateName={resetTarget?.name}
      />

      <SendTestModal
        open={!!sendTestTarget}
        onClose={() => setSendTestTarget(null)}
        defaultEmail={user.email}
        hasDraft={!!sendTestTarget?.has_draft}
        variables={{}}
        subjectPreview={sendTestTarget?.subject || undefined}
        onSend={async (payload) => {
          if (!sendTestTarget) return
          try {
            const res = await sendTestEmail(sendTestTarget.id, payload)
            toast.success(
              `Test email sent to ${payload.to_email}.${res.subject ? ` Subject: ${res.subject}` : ''}`
            )
          } catch (err) {
            throw new Error(apiErrorMessage(err, 'Failed to send test email'))
          }
        }}
      />

      <Modal
        open={!!previewTarget}
        onClose={() => setPreviewTarget(null)}
        title={previewTarget ? `Preview: ${previewTarget.name}` : 'Preview'}
        size="2xl"
        footer={
          <Button variant="secondary" onClick={() => setPreviewTarget(null)}>
            Close
          </Button>
        }
      >
        <div className="h-[60vh] overflow-hidden rounded-control border border-border">
          <PreviewPane
            tab={previewTab}
            onTabChange={setPreviewTab}
            subject={previewData.subject}
            bodyHtml={previewData.body_html}
            bodyText={previewData.body_text}
            error={previewData.error}
          />
        </div>
      </Modal>
    </div>
  )
}
