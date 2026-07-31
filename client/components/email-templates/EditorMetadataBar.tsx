'use client'

import { Input } from '@/components/ui'
import { cn } from '@/lib/cn'

interface EditorMetadataBarProps {
  subject: string
  fromName: string
  fromEmail: string
  replyTo: string
  onSubjectChange: (v: string) => void
  onFromNameChange: (v: string) => void
  onFromEmailChange: (v: string) => void
  onReplyToChange: (v: string) => void
  onBlurSave?: () => void
  readOnly?: boolean
  className?: string
}

export function EditorMetadataBar({
  subject,
  fromName,
  fromEmail,
  replyTo,
  onSubjectChange,
  onFromNameChange,
  onFromEmailChange,
  onReplyToChange,
  onBlurSave,
  readOnly,
  className,
}: EditorMetadataBarProps) {
  return (
    <div
      className={cn(
        'grid shrink-0 gap-3 border-b border-border bg-surface px-4 py-3 sm:grid-cols-2 lg:grid-cols-4',
        className
      )}
    >
      <div className="sm:col-span-2 lg:col-span-1">
        <label className="mb-1 block text-2xs font-semibold uppercase text-foreground-subtle">
          Subject
        </label>
        <Input
          className="font-mono text-xs"
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          onBlur={onBlurSave}
          disabled={readOnly}
          placeholder="Email subject (Jinja supported)"
        />
      </div>
      <div>
        <label className="mb-1 block text-2xs font-semibold uppercase text-foreground-subtle">
          From name
        </label>
        <Input
          value={fromName}
          onChange={(e) => onFromNameChange(e.target.value)}
          onBlur={onBlurSave}
          disabled={readOnly}
          placeholder="Uses default: ClockInn Pro"
        />
      </div>
      <div>
        <label className="mb-1 block text-2xs font-semibold uppercase text-foreground-subtle">
          From email
        </label>
        <Input
          type="email"
          value={fromEmail}
          onChange={(e) => onFromEmailChange(e.target.value)}
          onBlur={onBlurSave}
          disabled={readOnly}
          placeholder="Uses global default"
        />
      </div>
      <div>
        <label className="mb-1 block text-2xs font-semibold uppercase text-foreground-subtle">
          Reply-to
        </label>
        <Input
          type="email"
          value={replyTo}
          onChange={(e) => onReplyToChange(e.target.value)}
          onBlur={onBlurSave}
          disabled={readOnly}
          placeholder="Optional"
        />
      </div>
    </div>
  )
}
