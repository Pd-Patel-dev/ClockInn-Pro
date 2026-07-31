'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  History,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import {
  Badge,
  Button,
  ConfirmModal,
  Input,
  Modal,
  Select,
  Switch,
  Textarea,
  Skeleton,
} from '@/components/ui'
import {
  EditorMetadataBar,
  MonacoTemplateEditor,
  PreviewPane,
  VariablesPanel,
  PublishDiffModal,
  SendTestModal,
  VersionHistoryDrawer,
  ShortcutCheatsheetModal,
  ResetFactoryModal,
} from '@/components/email-templates'
import {
  apiErrorMessage,
  discardDraft,
  getEmailTemplate,
  getTemplateVersion,
  patchTemplateMetadata,
  previewTemplate,
  publishDraft,
  resetToFactory,
  revertToVersion,
  saveDraft,
  sendTestEmail,
} from '@/lib/email-templates/api'
import {
  findUndefinedVariables,
  formatDateTime,
  relativeTime,
  sampleVariablesFromSchema,
} from '@/lib/email-templates/utils'
import type {
  EditorBodyTab,
  EmailTemplateDetail,
  EmailTemplateVersionContent,
  PreviewTab,
  SaveStatus,
} from '@/lib/email-templates/types'
import logger from '@/lib/logger'
import type { User } from '@/lib/auth'
import { cn } from '@/lib/cn'

type Mode = 'edit' | 'readonly'

interface TemplateEditorWorkspaceProps {
  templateId: string
  user: User
  mode?: Mode
  versionId?: string
}

function draftStatusLabel(
  saveStatus: SaveStatus,
  hasDraft: boolean,
  savedAt: number | null,
  dirty: boolean
): { text: string; variant: 'warning' | 'success' | 'danger' | 'neutral' } {
  if (saveStatus === 'failed') return { text: 'Failed to save · Retry', variant: 'danger' }
  if (saveStatus === 'saving') return { text: 'Saving…', variant: 'warning' }
  if (saveStatus === 'editing' || dirty) return { text: 'Editing…', variant: 'warning' }
  if (hasDraft && saveStatus === 'saved') {
    const ago = savedAt ? relativeTime(new Date(savedAt).toISOString()) : 'just now'
    return { text: `Draft · saved ${ago}`, variant: 'warning' }
  }
  if (hasDraft) return { text: 'Draft · saved', variant: 'warning' }
  return { text: 'Published', variant: 'success' }
}

export function TemplateEditorWorkspace({
  templateId,
  user,
  mode = 'edit',
  versionId,
}: TemplateEditorWorkspaceProps) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = mode === 'readonly'

  const [template, setTemplate] = useState<EmailTemplateDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [versionMeta, setVersionMeta] = useState<EmailTemplateVersionContent | null>(null)

  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [fromName, setFromName] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [replyTo, setReplyTo] = useState('')

  const [baseline, setBaseline] = useState({
    subject: '',
    body_html: '',
    body_text: '',
    from_name: '',
    from_email: '',
    reply_to: '',
  })

  const [bodyTab, setBodyTab] = useState<EditorBodyTab>('html')
  const [previewTab, setPreviewTab] = useState<PreviewTab>('html')
  const [wordWrap, setWordWrap] = useState(true)
  const [varsOpen, setVarsOpen] = useState(false)
  const [previewData, setPreviewData] = useState<Record<string, unknown>>({})
  const [previewResult, setPreviewResult] = useState<{
    subject?: string
    body_html?: string
    body_text?: string
    warnings?: string[]
    error?: string | null
  }>({})
  const [previewLoading, setPreviewLoading] = useState(false)

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [hasServerDraft, setHasServerDraft] = useState(false)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [sendTestOpen, setSendTestOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [metaOpen, setMetaOpen] = useState(false)
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreTargetId, setRestoreTargetId] = useState<string | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)

  const [metaForm, setMetaForm] = useState({
    name: '',
    description: '',
    category: 'TRANSACTIONAL' as string,
    is_enabled: true,
  })

  const dirty = useMemo(() => {
    if (readOnly) return false
    return (
      subject !== baseline.subject ||
      bodyHtml !== baseline.body_html ||
      bodyText !== baseline.body_text ||
      fromName !== baseline.from_name ||
      fromEmail !== baseline.from_email ||
      replyTo !== baseline.reply_to
    )
  }, [subject, bodyHtml, bodyText, fromName, fromEmail, replyTo, baseline, readOnly])

  const applyContent = useCallback((content: EmailTemplateVersionContent | null | undefined, asBaseline: boolean) => {
    const next = {
      subject: content?.subject ?? '',
      body_html: content?.body_html ?? '',
      body_text: content?.body_text ?? '',
      from_name: content?.from_name ?? '',
      from_email: content?.from_email ?? '',
      reply_to: content?.reply_to ?? '',
    }
    setSubject(next.subject)
    setBodyHtml(next.body_html)
    setBodyText(next.body_text)
    setFromName(next.from_name)
    setFromEmail(next.from_email)
    setReplyTo(next.reply_to)
    if (asBaseline) setBaseline(next)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const detail = await getEmailTemplate(templateId)
      setTemplate(detail)
      setHasServerDraft(!!detail.draft_version)
      setMetaForm({
        name: detail.name,
        description: detail.description || '',
        category: detail.category,
        is_enabled: detail.is_enabled,
      })
      setPreviewData(sampleVariablesFromSchema(detail.variables_schema))

      if (readOnly && versionId) {
        const ver = await getTemplateVersion(templateId, versionId)
        setVersionMeta(ver)
        applyContent(ver, true)
      } else {
        const active = detail.draft_version || detail.published_version
        applyContent(active, true)
      }
      setSaveStatus('idle')
    } catch (err) {
      logger.error('Failed to load email template', err as Error)
      toast.error(apiErrorMessage(err, 'Failed to load template'))
    } finally {
      setLoading(false)
    }
  }, [templateId, versionId, readOnly, applyContent, toast])

  useEffect(() => {
    void load()
  }, [load])

  const performSave = useCallback(async () => {
    if (readOnly || !template) return
    setSaveStatus('saving')
    try {
      const draft = await saveDraft(templateId, {
        subject,
        body_html: bodyHtml,
        body_text: bodyText,
        from_name: fromName || null,
        from_email: fromEmail || null,
        reply_to: replyTo || null,
      })
      setHasServerDraft(true)
      setBaseline({
        subject,
        body_html: bodyHtml,
        body_text: bodyText,
        from_name: fromName,
        from_email: fromEmail,
        reply_to: replyTo,
      })
      setSavedAt(Date.now())
      setSaveStatus('saved')
      setTemplate((prev) => (prev ? { ...prev, draft_version: draft } : prev))
    } catch (err) {
      setSaveStatus('failed')
      toast.error(apiErrorMessage(err, 'Failed to save draft'))
    }
  }, [
    readOnly,
    template,
    templateId,
    subject,
    bodyHtml,
    bodyText,
    fromName,
    fromEmail,
    replyTo,
    toast,
  ])

  // Autosave debounce 5s
  useEffect(() => {
    if (readOnly || !dirty) return
    setSaveStatus('editing')
    const t = setTimeout(() => {
      void performSave()
    }, 5000)
    return () => clearTimeout(t)
  }, [dirty, subject, bodyHtml, bodyText, fromName, fromEmail, replyTo, performSave, readOnly])

  // beforeunload
  useEffect(() => {
    if (readOnly) return
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, readOnly])

  // Relative saved time refresh
  useEffect(() => {
    if (saveStatus !== 'saved') return
    const t = setInterval(() => setSavedAt((v) => (v ? v : Date.now())), 15000)
    return () => clearInterval(t)
  }, [saveStatus])

  // Preview debounce 300ms
  useEffect(() => {
    if (!template) return
    const controller = new AbortController()
    const t = setTimeout(async () => {
      setPreviewLoading(true)
      try {
        // Local draft content preview: save first isn't required — API expects version key.
        // For edit mode we preview draft if exists or after save; otherwise publish published.
        // When dirty without draft, we still call preview with draft after ensuring... 
        // Spec: POST preview with version draft|published|uuid.
        // If dirty and no draft yet, temporarily we preview published and show note, OR save first.
        // Better: if has draft or dirty, use 'draft' only if server has draft; else use published
        // and for dirty content without draft, call save first silently is heavy.
        // Approach: if dirty, save draft first then preview — too slow.
        // Alternative: pass version published and accept stale — bad UX.
        // Best: when dirty, PUT draft then preview. Autosave is 5s — for preview we can
        // use a client-side note. Looking at API — it only renders stored versions.
        // So for live preview of unsaved edits we MUST save draft first OR backend needs
        // inline content (not in API). Spec says preview via POST preview debounced 300ms.
        // So we'll save draft when dirty before preview if needed — but that fights autosave.
        // Practical approach: if dirty, include saving then preview; if clean, just preview.
        let version: string = 'published'
        if (readOnly && versionId) version = versionId
        else if (hasServerDraft || dirty) {
          if (dirty) {
            try {
              await saveDraft(templateId, {
                subject,
                body_html: bodyHtml,
                body_text: bodyText,
                from_name: fromName || null,
                from_email: fromEmail || null,
                reply_to: replyTo || null,
              })
              setHasServerDraft(true)
              setBaseline({
                subject,
                body_html: bodyHtml,
                body_text: bodyText,
                from_name: fromName,
                from_email: fromEmail,
                reply_to: replyTo,
              })
              setSavedAt(Date.now())
              setSaveStatus('saved')
            } catch {
              /* preview may still fail */
            }
          }
          version = 'draft'
        }

        const res = await previewTemplate(templateId, {
          version,
          variables: previewData,
          format: 'both',
        })
        if (controller.signal.aborted) return
        setPreviewResult({
          subject: res.subject,
          body_html: res.body_html,
          body_text: res.body_text,
          warnings: res.warnings,
          error: null,
        })
      } catch (err) {
        if (controller.signal.aborted) return
        setPreviewResult((prev) => ({
          ...prev,
          error: apiErrorMessage(err, 'Preview failed'),
        }))
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false)
      }
    }, 300)
    return () => {
      controller.abort()
      clearTimeout(t)
    }
  }, [
    template,
    templateId,
    subject,
    bodyHtml,
    bodyText,
    fromName,
    fromEmail,
    replyTo,
    previewData,
    hasServerDraft,
    dirty,
    readOnly,
    versionId,
  ])

  // Keyboard shortcuts
  useEffect(() => {
    if (readOnly) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      if (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setCheatsheetOpen(true)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void performSave()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        if (hasServerDraft || dirty) setPublishOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [readOnly, performSave, hasServerDraft, dirty])

  const undefinedVars = useMemo(
    () => findUndefinedVariables(template?.variables_schema, subject, bodyHtml, bodyText),
    [template?.variables_schema, subject, bodyHtml, bodyText]
  )

  const statusPill = draftStatusLabel(saveStatus, hasServerDraft, savedAt, dirty)

  const markDirtyField = () => {
    if (!readOnly) setSaveStatus('editing')
  }

  const handlePublish = async (notes: string) => {
    setPublishing(true)
    try {
      if (dirty) await performSave()
      const published = await publishDraft(templateId, notes ? { notes } : undefined)
      toast.success(
        `Version v${published.version_number} published. Emails will use this version starting now.`
      )
      setPublishOpen(false)
      setHasServerDraft(false)
      await load()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to publish'))
    } finally {
      setPublishing(false)
    }
  }

  const handleDiscard = async () => {
    setDiscarding(true)
    try {
      await discardDraft(templateId)
      toast.success('Draft discarded')
      setDiscardOpen(false)
      await load()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to discard draft'))
    } finally {
      setDiscarding(false)
    }
  }

  const handleRestore = async (vid?: string) => {
    const target = vid || restoreTargetId || versionId
    if (!target) return
    setRestoring(true)
    try {
      await revertToVersion(templateId, target)
      toast.success('Draft created from selected version')
      setRestoreOpen(false)
      setRestoreTargetId(null)
      setHistoryOpen(false)
      router.push(`/settings/email/templates/${templateId}`)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to restore version'))
    } finally {
      setRestoring(false)
    }
  }

  const handleResetFactory = async () => {
    setResetting(true)
    try {
      await resetToFactory(templateId)
      toast.success('Draft reset to factory defaults')
      setResetOpen(false)
      await load()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to reset'))
    } finally {
      setResetting(false)
    }
  }

  const handleSaveMeta = async () => {
    try {
      const updated = await patchTemplateMetadata(templateId, {
        name: metaForm.name,
        description: metaForm.description,
        category: metaForm.category as EmailTemplateDetail['category'],
        is_enabled: metaForm.is_enabled,
      })
      setTemplate((prev) => (prev ? { ...prev, ...updated } : updated))
      setMetaOpen(false)
      toast.success('Template metadata updated')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to update metadata'))
    }
  }

  if (loading || !template) {
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col gap-3 p-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="min-h-0 flex-1 w-full" />
      </div>
    )
  }

  const workingDraft = template.draft_version
  const published = template.published_version

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-surface">
      {readOnly && versionMeta && (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-950 dark:text-amber-100">
          Viewing version v{versionMeta.version_number}
          {versionMeta.published_at
            ? ` · Published ${formatDateTime(versionMeta.published_at)}`
            : ''}
          {versionMeta.published_by_name ? ` by ${versionMeta.published_by_name}` : ''}. This is
          not the editable working copy.
        </div>
      )}

      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/settings/email/templates"
            className="rounded-control p-2 text-foreground-muted hover:bg-border-subtle hover:text-foreground"
            aria-label="Back to templates"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold text-foreground">{template.name}</h1>
              {!readOnly && (
                <button
                  type="button"
                  className="rounded-control p-1 text-foreground-subtle hover:bg-border-subtle"
                  aria-label="Edit metadata"
                  onClick={() => setMetaOpen(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => (saveStatus === 'failed' ? void performSave() : undefined)}
                >
                  <Badge variant={statusPill.variant} className={cn(saveStatus === 'failed' && 'cursor-pointer')}>
                    {statusPill.text}
                  </Badge>
                </button>
              )}
            </div>
            <p className="truncate font-mono text-2xs text-foreground-subtle">{template.key}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {readOnly ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={() => {
                  setRestoreTargetId(versionId || null)
                  setRestoreOpen(true)
                }}
              >
                Restore this version
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCompareOpen(true)}>
                Compare with current
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Send className="h-3.5 w-3.5" />}
                onClick={() => setSendTestOpen(true)}
              >
                Send test
              </Button>
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<History className="h-3.5 w-3.5" />}
                onClick={() => setHistoryOpen(true)}
              >
                History
              </Button>
              {(hasServerDraft || dirty) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setDiscardOpen(true)}
                >
                  Discard draft
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void performSave()}
                loading={saveStatus === 'saving'}
              >
                Save draft
              </Button>
              <Button
                size="sm"
                disabled={!hasServerDraft && !dirty}
                onClick={() => setPublishOpen(true)}
              >
                Publish
              </Button>
            </>
          )}
        </div>
      </header>

      <EditorMetadataBar
        subject={subject}
        fromName={fromName}
        fromEmail={fromEmail}
        replyTo={replyTo}
        readOnly={readOnly}
        onBlurSave={() => {
          if (dirty) void performSave()
        }}
        onSubjectChange={(v) => {
          setSubject(v)
          markDirtyField()
        }}
        onFromNameChange={(v) => {
          setFromName(v)
          markDirtyField()
        }}
        onFromEmailChange={(v) => {
          setFromEmail(v)
          markDirtyField()
        }}
        onReplyToChange={(v) => {
          setReplyTo(v)
          markDirtyField()
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <MonacoTemplateEditor
          bodyTab={bodyTab}
          onBodyTabChange={setBodyTab}
          html={bodyHtml}
          text={bodyText}
          onHtmlChange={(v) => {
            setBodyHtml(v)
            markDirtyField()
          }}
          onTextChange={(v) => {
            setBodyText(v)
            markDirtyField()
          }}
          wordWrap={wordWrap}
          onWordWrapChange={setWordWrap}
          readOnly={readOnly}
          variablesSchema={template.variables_schema}
          dirtyHtml={dirty && bodyHtml !== baseline.body_html}
          dirtyText={dirty && bodyText !== baseline.body_text}
          onBlurSave={() => {
            if (dirty) void performSave()
          }}
          className="min-h-[240px] lg:min-h-0 lg:w-1/2"
        />
        <PreviewPane
          tab={previewTab}
          onTabChange={setPreviewTab}
          subject={previewResult.subject}
          fromName={fromName || null}
          fromEmail={fromEmail || null}
          bodyHtml={previewResult.body_html}
          bodyText={previewResult.body_text}
          error={previewResult.error}
          warnings={previewResult.warnings}
          loading={previewLoading}
          onOpenVariables={() => setVarsOpen(true)}
          className="min-h-[240px] lg:min-h-0 lg:w-1/2"
        />
      </div>

      {!readOnly && (
        <VariablesPanel
          open={varsOpen}
          onToggle={() => setVarsOpen((o) => !o)}
          schema={template.variables_schema || {}}
          previewData={previewData}
          onPreviewDataChange={setPreviewData}
          onResetDefaults={() => setPreviewData(sampleVariablesFromSchema(template.variables_schema))}
          undefinedVars={undefinedVars}
        />
      )}

      <VersionHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        templateId={templateId}
        onRestore={(vid) => {
          setRestoreTargetId(vid)
          setRestoreOpen(true)
        }}
        onCompare={() => {
          setHistoryOpen(false)
          setPublishOpen(true)
        }}
      />

      <PublishDiffModal
        open={publishOpen || compareOpen}
        onClose={() => {
          setPublishOpen(false)
          setCompareOpen(false)
        }}
        onPublish={handlePublish}
        loading={publishing}
        compareOnly={compareOpen && !publishOpen}
        published={published}
        draft={
          compareOpen && readOnly && versionMeta
            ? versionMeta
            : workingDraft || {
                id: 'local',
                version_number: (published?.version_number || 0) + 1,
                subject,
                body_html: bodyHtml,
                body_text: bodyText,
                from_name: fromName,
                from_email: fromEmail,
                reply_to: replyTo,
                is_published: false,
                is_draft: true,
              }
        }
        variablesSchema={template.variables_schema}
      />

      <SendTestModal
        open={sendTestOpen}
        onClose={() => setSendTestOpen(false)}
        defaultEmail={user.email}
        hasDraft={hasServerDraft || dirty}
        variables={previewData}
        subjectPreview={previewResult.subject || subject}
        onSend={async (payload) => {
          if (dirty) await performSave()
          try {
            const res = await sendTestEmail(templateId, payload)
            toast.success(
              `Test email sent to ${payload.to_email}.${res.subject ? ` Subject: ${res.subject}` : ''}`
            )
          } catch (err) {
            throw new Error(apiErrorMessage(err, 'Failed to send test email'))
          }
        }}
      />

      <ConfirmModal
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        onConfirm={handleDiscard}
        loading={discarding}
        title="Discard draft?"
        message="Unpublished draft changes will be permanently discarded. The published version is unchanged."
        confirmLabel="Discard draft"
        variant="danger"
      />

      <ConfirmModal
        open={restoreOpen}
        onClose={() => {
          setRestoreOpen(false)
          setRestoreTargetId(null)
        }}
        onConfirm={() => void handleRestore()}
        loading={restoring}
        title="Restore this version?"
        message="This creates a new draft from the selected version. Review and publish when ready."
        confirmLabel="Restore as draft"
      />

      <ResetFactoryModal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={handleResetFactory}
        loading={resetting}
        templateName={template.name}
      />

      <ShortcutCheatsheetModal open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />

      <Modal
        open={metaOpen}
        onClose={() => setMetaOpen(false)}
        title="Edit template metadata"
        description={`Key: ${template.key} (cannot be changed)`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMetaOpen(false)}>
              Cancel
            </Button>
            {template.is_system && (
              <Button variant="ghost" className="text-danger mr-auto" onClick={() => {
                setMetaOpen(false)
                setResetOpen(true)
              }}>
                Reset to factory
              </Button>
            )}
            <Button onClick={() => void handleSaveMeta()}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground-muted">Name</label>
            <Input
              value={metaForm.name}
              onChange={(e) => setMetaForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground-muted">Description</label>
            <Textarea
              rows={3}
              value={metaForm.description}
              onChange={(e) => setMetaForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground-muted">Category</label>
            <Select
              value={metaForm.category}
              onChange={(e) => setMetaForm((f) => ({ ...f, category: e.target.value }))}
            >
              <option value="TRANSACTIONAL">Transactional</option>
              <option value="NOTIFICATION">Notification</option>
              <option value="SUMMARY">Summary</option>
              <option value="MARKETING">Marketing</option>
            </Select>
          </div>
          <div>
            <Switch
              checked={metaForm.is_enabled}
              onChange={(e) => setMetaForm((f) => ({ ...f, is_enabled: e.target.checked }))}
              label="Enabled"
            />
            <p className="mt-1 text-xs text-foreground-muted">
              Disabled templates are skipped by the email service
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
