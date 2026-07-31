'use client'

import { useMemo, useState } from 'react'
import { Button, Modal, Tabs, Textarea } from '@/components/ui'
import { DiffViewer, SubjectDiff } from './DiffViewer'
import { findUndefinedVariables } from '@/lib/email-templates/utils'
import type { EmailTemplateVersionContent, VariablesSchema } from '@/lib/email-templates/types'

interface PublishDiffModalProps {
  open: boolean
  onClose: () => void
  onPublish: (notes: string) => void
  loading?: boolean
  published?: EmailTemplateVersionContent | null
  draft?: EmailTemplateVersionContent | null
  variablesSchema?: VariablesSchema
  compareOnly?: boolean
}

export function PublishDiffModal({
  open,
  onClose,
  onPublish,
  loading,
  published,
  draft,
  variablesSchema,
  compareOnly,
}: PublishDiffModalProps) {
  const [notes, setNotes] = useState('')
  const [bodyTab, setBodyTab] = useState<'html' | 'text'>('html')

  const undefinedVars = useMemo(
    () =>
      findUndefinedVariables(
        variablesSchema,
        draft?.subject,
        draft?.body_html,
        draft?.body_text
      ),
    [variablesSchema, draft]
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={compareOnly ? 'Compare versions' : 'Publish new version?'}
      description={
        compareOnly
          ? 'Differences between the live published version and the selected version.'
          : 'Review changes between the live published version and your draft.'
      }
      size="2xl"
      footer={
        compareOnly ? (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={() => onPublish(notes.trim())}
              loading={loading}
              disabled={!draft}
            >
              Publish now
            </Button>
          </>
        )
      }
    >
      <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Subject</h3>
          <SubjectDiff published={published?.subject} draft={draft?.subject} />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Body</h3>
            <Tabs
              variant="pills"
              tabs={[
                { id: 'html', label: 'HTML' },
                { id: 'text', label: 'Plain text' },
              ]}
              value={bodyTab}
              onChange={(id) => setBodyTab(id as 'html' | 'text')}
            />
          </div>
          {bodyTab === 'html' ? (
            <DiffViewer oldText={published?.body_html || ''} newText={draft?.body_html || ''} />
          ) : (
            <DiffViewer oldText={published?.body_text || ''} newText={draft?.body_text || ''} />
          )}
        </div>

        {undefinedVars.length > 0 && !compareOnly && (
          <div className="rounded-control border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
            Draft references undefined variables:{' '}
            {undefinedVars.map((v) => (
              <code key={v} className="mx-0.5 font-mono text-xs">
                {`{{${v}}}`}
              </code>
            ))}
          </div>
        )}

        {!compareOnly && (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground-muted">Version notes</label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional changelog message"
            />
          </div>
        )}
      </div>
    </Modal>
  )
}
