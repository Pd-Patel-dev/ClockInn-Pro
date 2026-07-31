'use client'

import { useEffect, useState } from 'react'
import { Button, Input, Modal, Tabs, Textarea } from '@/components/ui'
import type { SendTestRequest } from '@/lib/email-templates/types'

interface SendTestModalProps {
  open: boolean
  onClose: () => void
  onSend: (payload: SendTestRequest) => Promise<void>
  defaultEmail?: string
  hasDraft: boolean
  variables: Record<string, unknown>
  subjectPreview?: string
}

export function SendTestModal({
  open,
  onClose,
  onSend,
  defaultEmail = '',
  hasDraft,
  variables,
  subjectPreview,
}: SendTestModalProps) {
  const [toEmail, setToEmail] = useState(defaultEmail)
  const [version, setVersion] = useState<'draft' | 'published'>(hasDraft ? 'draft' : 'published')
  const [varsJson, setVarsJson] = useState(() => JSON.stringify(variables, null, 2))
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setToEmail(defaultEmail)
    setVersion(hasDraft ? 'draft' : 'published')
    setVarsJson(JSON.stringify(variables, null, 2))
    setError(null)
  }, [open, defaultEmail, hasDraft, variables])

  const handleSend = async () => {
    const email = toEmail.trim()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address')
      return
    }
    let parsed: Record<string, unknown> = {}
    try {
      parsed = varsJson.trim() ? (JSON.parse(varsJson) as Record<string, unknown>) : {}
    } catch {
      setError('Variables must be valid JSON')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await onSend({ to_email: email, version, variables: parsed })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send test email')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send test email"
      description="Sends one message to a single recipient. Subject will include a [TEST] prefix."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSend} loading={loading}>
            Send test email
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground-muted">Recipient</label>
          <Input
            type="email"
            value={toEmail}
            onChange={(e) => setToEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground-muted">Version</label>
          <Tabs
            variant="pills"
            tabs={[
              { id: 'draft', label: 'Draft', disabled: !hasDraft },
              { id: 'published', label: 'Published' },
            ]}
            value={version}
            onChange={(id) => setVersion(id as 'draft' | 'published')}
          />
        </div>

        {subjectPreview && (
          <p className="rounded-control border border-border bg-border-subtle/40 px-3 py-2 font-mono text-xs text-foreground-muted">
            Subject preview: {subjectPreview}
          </p>
        )}

        <p className="text-xs text-foreground-subtle">
          Test emails have a <code className="font-mono">[TEST]</code> prefix in the subject.
        </p>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground-muted">Variables (JSON)</label>
          <Textarea
            rows={6}
            className="font-mono text-xs"
            value={varsJson}
            onChange={(e) => setVarsJson(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  )
}
