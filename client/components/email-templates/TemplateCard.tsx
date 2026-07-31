'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { CSSProperties } from 'react'
import {
  Eye,
  History,
  MoreHorizontal,
  Pencil,
  Power,
  RotateCcw,
  Send,
} from 'lucide-react'
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from '@/components/ui'
import { getTemplateIcon } from '@/lib/email-templates/templateIcons'
import { CATEGORY_LABELS, relativeTime, renderSubjectWithVars } from '@/lib/email-templates/utils'
import type { EmailTemplateCategory, EmailTemplateListItem } from '@/lib/email-templates/types'
import { cn } from '@/lib/cn'

const CATEGORY_ACCENT: Record<EmailTemplateCategory, string> = {
  TRANSACTIONAL: 'border-l-accent',
  NOTIFICATION: 'border-l-amber-500 dark:border-l-amber-400',
  SUMMARY: 'border-l-emerald-500 dark:border-l-emerald-400',
  MARKETING: 'border-l-violet-500 dark:border-l-violet-400',
}

interface TemplateCardProps {
  template: EmailTemplateListItem
  view: 'cards' | 'list'
  index?: number
  onPreview: (t: EmailTemplateListItem) => void
  onSendTest: (t: EmailTemplateListItem) => void
  onToggleEnabled: (t: EmailTemplateListItem) => void
  onResetFactory: (t: EmailTemplateListItem) => void
}

function SubjectLine({ subject }: { subject?: string | null }) {
  const { parts } = renderSubjectWithVars(subject)
  return (
    <p className="truncate text-sm text-foreground-muted">
      {parts.map((p, i) =>
        p.isVar ? (
          <span
            key={i}
            className="mx-0.5 rounded-[3px] bg-border-subtle px-0.5 text-foreground-muted"
          >
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </p>
  )
}

function StatusIndicators({ template }: { template: EmailTemplateListItem }) {
  const items: { label: string; aria: string; dotClass: string }[] = []
  if (template.has_draft) {
    items.push({
      label: 'draft',
      aria: 'Has unpublished draft',
      dotClass: 'bg-amber-500',
    })
  }
  if (!template.is_enabled) {
    items.push({
      label: 'disabled',
      aria: 'Template disabled',
      dotClass: 'bg-foreground-subtle',
    })
  }
  if (!items.length) return null
  return (
    <div className="flex flex-col items-end gap-1">
      {items.map((item) => (
        <span
          key={item.label}
          className="inline-flex items-center gap-1.5 text-[11px] leading-none text-foreground-muted"
          aria-label={item.aria}
        >
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', item.dotClass)} aria-hidden />
          {item.label}
        </span>
      ))}
    </div>
  )
}

function staggerStyle(index: number): CSSProperties {
  return {
    animationDelay: `${Math.min(index * 30, 180)}ms`,
    animationFillMode: 'both',
  }
}

export function TemplateCard({
  template,
  view,
  index = 0,
  onPreview,
  onSendTest,
  onToggleEnabled,
  onResetFactory,
}: TemplateCardProps) {
  const router = useRouter()
  const href = `/settings/email/templates/${template.id}`
  const updated = template.last_updated_at || template.updated_at
  const category = template.category as EmailTemplateCategory
  const accent = CATEGORY_ACCENT[category] ?? CATEGORY_ACCENT.TRANSACTIONAL
  const Icon = getTemplateIcon(template.key)
  const categoryLabel = CATEGORY_LABELS[template.category] ?? template.category

  const overflow = (
    <div
      className={cn(
        'relative z-10',
        view === 'cards' &&
          'opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100'
      )}
    >
      <MenuRoot>
        <Menu>
          <MenuTrigger>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Template actions"
              className="h-8 w-8 shrink-0 p-0"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem
              icon={<Send className="h-4 w-4" />}
              onClick={() => onSendTest(template)}
            >
              Send test email
            </MenuItem>
            <MenuItem
              icon={<History className="h-4 w-4" />}
              onClick={() => router.push(`/settings/email/templates/${template.id}/versions`)}
            >
              View version history
            </MenuItem>
            <MenuItem
              icon={<Power className="h-4 w-4" />}
              onClick={() => onToggleEnabled(template)}
            >
              {template.is_enabled ? 'Disable' : 'Enable'}
            </MenuItem>
            {template.is_system && (
              <MenuItem
                icon={<RotateCcw className="h-4 w-4" />}
                destructive
                onClick={() => onResetFactory(template)}
              >
                Reset to factory
              </MenuItem>
            )}
            <MenuItem
              icon={<Pencil className="h-4 w-4" />}
              onClick={() => router.push(href)}
            >
              View in editor
            </MenuItem>
            <MenuItem icon={<Eye className="h-4 w-4" />} onClick={() => onPreview(template)}>
              Preview
            </MenuItem>
          </MenuContent>
        </Menu>
      </MenuRoot>
    </div>
  )

  const shellClass = cn(
    'group relative cursor-pointer border border-border border-l-[2px] bg-surface',
    'transition-all duration-150 ease-out',
    'hover:border-foreground-subtle/40 hover:bg-border-subtle/30 hover:shadow-subtle',
    'animate-in-ui',
    accent,
    !template.is_enabled && 'opacity-75',
    view === 'cards'
      ? 'flex h-full flex-col rounded-[10px] p-5'
      : 'flex items-center gap-4 rounded-[10px] px-5 py-4'
  )

  if (view === 'list') {
    return (
      <div className={shellClass} style={staggerStyle(index)}>
        <Link
          href={href}
          className="absolute inset-0 z-0 rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page"
          aria-label={`Edit ${template.name}`}
        />
        <Icon
          className="pointer-events-none relative z-[1] h-4 w-4 shrink-0 text-foreground-muted"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="pointer-events-none relative z-[1] min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-3">
            <h3 className="truncate text-sm font-medium text-foreground">{template.name}</h3>
            <StatusIndicators template={template} />
          </div>
          <SubjectLine subject={template.subject} />
          <p className="text-xs text-foreground-subtle">
            {categoryLabel} · Updated {relativeTime(updated)}
          </p>
        </div>
        {overflow}
      </div>
    )
  }

  return (
    <div className={shellClass} style={staggerStyle(index)}>
      <Link
        href={href}
        className="absolute inset-0 z-0 rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page"
        aria-label={`Edit ${template.name}`}
      />
      <div className="pointer-events-none relative z-[1] flex items-start gap-2.5">
        <Icon
          className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-medium text-foreground">{template.name}</h3>
            <div className="pointer-events-auto flex shrink-0 flex-col items-end gap-1.5">
              {overflow}
              <StatusIndicators template={template} />
            </div>
          </div>
        </div>
      </div>

      {template.description ? (
        <p className="pointer-events-none relative z-[1] mt-3 line-clamp-2 text-sm text-foreground-muted">
          {template.description}
        </p>
      ) : (
        <div className="mt-3 h-10" aria-hidden />
      )}

      <div className="pointer-events-none relative z-[1] mt-3">
        <SubjectLine subject={template.subject} />
      </div>

      <p className="pointer-events-none relative z-[1] mt-auto pt-4 text-xs text-foreground-subtle">
        {categoryLabel} · Updated {relativeTime(updated)}
      </p>
    </div>
  )
}

export function TemplateCardSkeleton() {
  return (
    <div className="rounded-[10px] border border-border border-l-[2px] border-l-border bg-surface p-5">
      <div className="flex items-center gap-2.5">
        <div className="h-4 w-4 animate-pulse rounded bg-border motion-reduce:animate-none" />
        <div className="h-4 w-[40%] animate-pulse rounded bg-border motion-reduce:animate-none" />
      </div>
      <div className="mt-3 space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-border motion-reduce:animate-none" />
        <div className="h-3 w-[80%] animate-pulse rounded bg-border motion-reduce:animate-none" />
      </div>
      <div className="mt-3 h-3 w-[60%] animate-pulse rounded bg-border motion-reduce:animate-none" />
      <div className="mt-4 h-2.5 w-[40%] animate-pulse rounded bg-border motion-reduce:animate-none" />
    </div>
  )
}
