'use client'

import { diffLines, type Change } from 'diff'
import { cn } from '@/lib/cn'

export function DiffViewer({
  oldText,
  newText,
  className,
}: {
  oldText: string
  newText: string
  className?: string
}) {
  const changes: Change[] = diffLines(oldText || '', newText || '')

  return (
    <pre
      className={cn(
        'max-h-64 overflow-auto rounded-control border border-border bg-border-subtle/30 p-3 font-mono text-xs leading-relaxed',
        className
      )}
    >
      {changes.map((part, i) => (
        <span
          key={i}
          className={cn(
            part.added && 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
            part.removed && 'bg-red-500/15 text-red-800 dark:text-red-200 line-through decoration-red-500/40',
            !part.added && !part.removed && 'text-foreground-muted'
          )}
        >
          {part.value}
        </span>
      ))}
    </pre>
  )
}

export function SubjectDiff({
  published,
  draft,
}: {
  published?: string | null
  draft?: string | null
}) {
  return (
    <div className="space-y-2 text-sm">
      <div className="rounded-control border border-border bg-red-500/5 px-3 py-2">
        <p className="text-2xs font-semibold uppercase text-foreground-subtle">Published</p>
        <p className="mt-0.5 font-mono text-xs text-red-800 dark:text-red-200 line-through">
          {published || '(empty)'}
        </p>
      </div>
      <div className="rounded-control border border-border bg-emerald-500/5 px-3 py-2">
        <p className="text-2xs font-semibold uppercase text-foreground-subtle">Draft</p>
        <p className="mt-0.5 font-mono text-xs text-emerald-800 dark:text-emerald-200">
          {draft || '(empty)'}
        </p>
      </div>
    </div>
  )
}
