'use client'

import { useEffect, useRef } from 'react'
import { Tabs } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { PreviewTab } from '@/lib/email-templates/types'

interface PreviewPaneProps {
  tab: PreviewTab
  onTabChange: (tab: PreviewTab) => void
  subject?: string
  fromName?: string | null
  fromEmail?: string | null
  bodyHtml?: string
  bodyText?: string
  toEmail?: string
  error?: string | null
  warnings?: string[]
  loading?: boolean
  onOpenVariables?: () => void
  className?: string
}

export function PreviewPane({
  tab,
  onTabChange,
  subject,
  fromName,
  fromEmail,
  bodyHtml,
  bodyText,
  toEmail = 'recipient@example.com',
  error,
  warnings,
  loading,
  onOpenVariables,
  className,
}: PreviewPaneProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const fromDisplay =
    fromName || fromEmail
      ? `${fromName || 'Sender'}${fromEmail ? ` <${fromEmail}>` : ''}`
      : 'ClockInn Pro <no-reply@clockinn.app>'

  useEffect(() => {
    if (tab === 'text') return
    const iframe = iframeRef.current
    if (!iframe) return
    const doc = iframe.contentDocument
    if (!doc) return
    doc.open()
    doc.write(bodyHtml || '<p style="color:#64748b;font-family:sans-serif">No HTML preview</p>')
    doc.close()
  }, [bodyHtml, tab])

  const mockHeader = (
    <div className="shrink-0 space-y-1 border-b border-border bg-border-subtle/40 px-4 py-3 text-xs">
      <div className="flex gap-2">
        <span className="w-14 shrink-0 text-foreground-subtle">From</span>
        <span className="truncate text-foreground">{fromDisplay}</span>
      </div>
      <div className="flex gap-2">
        <span className="w-14 shrink-0 text-foreground-subtle">To</span>
        <span className="truncate text-foreground">{toEmail}</span>
      </div>
      <div className="flex gap-2">
        <span className="w-14 shrink-0 text-foreground-subtle">Subject</span>
        <span className="whitespace-pre-wrap break-words font-medium text-foreground">
          {subject || '(no subject)'}
        </span>
      </div>
    </div>
  )

  const htmlFrame = (
    <iframe
      ref={iframeRef}
      title="Email HTML preview"
      sandbox="allow-same-origin"
      className={cn('h-full w-full bg-white', error && 'opacity-50')}
    />
  )

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <Tabs
          variant="pills"
          tabs={[
            { id: 'html', label: 'HTML' },
            { id: 'text', label: 'Plain text' },
            { id: 'mobile', label: 'Mobile' },
          ]}
          value={tab}
          onChange={(id) => onTabChange(id as PreviewTab)}
        />
        {loading && <span className="text-2xs text-foreground-subtle">Updating…</span>}
      </div>

      {error && (
        <div className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {warnings && warnings.length > 0 && (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/5 px-4 py-1.5 text-2xs text-amber-900 dark:text-amber-100">
          {warnings.slice(0, 3).join(' · ')}
          {warnings.length > 3 ? ` · +${warnings.length - 3} more` : ''}
        </div>
      )}

      {mockHeader}

      <div className="relative min-h-0 flex-1 overflow-auto bg-border-subtle/20">
        {tab === 'text' && (
          <pre className="h-full whitespace-pre-wrap p-4 font-mono text-xs text-foreground">
            {bodyText || 'No plain-text preview'}
          </pre>
        )}
        {tab === 'html' && htmlFrame}
        {tab === 'mobile' && (
          <div className="flex justify-center p-6">
            <div className="w-[375px] overflow-hidden rounded-[28px] border-[10px] border-foreground/80 bg-white shadow-lifted">
              <div className="h-6 bg-foreground/80" />
              <div className="h-[560px]">{htmlFrame}</div>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-4 py-2 text-2xs text-foreground-subtle">
        Powered by preview data
        {onOpenVariables && (
          <>
            {' · '}
            <button type="button" className="text-accent hover:underline" onClick={onOpenVariables}>
              Edit variables
            </button>
          </>
        )}
      </div>
    </div>
  )
}
