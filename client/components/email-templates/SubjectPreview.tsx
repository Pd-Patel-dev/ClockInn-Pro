'use client'

import { renderSubjectWithVars } from '@/lib/email-templates/utils'

export function SubjectPreview({ subject, className }: { subject?: string | null; className?: string }) {
  const { parts } = renderSubjectWithVars(subject)
  return (
    <p className={className ?? 'truncate font-mono text-xs text-foreground-muted'}>
      {parts.map((p, i) =>
        p.isVar ? (
          <span key={i} className="text-foreground-subtle">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </p>
  )
}
