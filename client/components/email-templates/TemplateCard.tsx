'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Eye,
  History,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Send,
  Power,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  Menu,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from '@/components/ui'
import { CategoryBadge } from './CategoryBadge'
import { SubjectPreview } from './SubjectPreview'
import { relativeTime } from '@/lib/email-templates/utils'
import type { EmailTemplateListItem } from '@/lib/email-templates/types'
import { cn } from '@/lib/cn'

interface TemplateCardProps {
  template: EmailTemplateListItem
  view: 'cards' | 'list'
  onPreview: (t: EmailTemplateListItem) => void
  onSendTest: (t: EmailTemplateListItem) => void
  onToggleEnabled: (t: EmailTemplateListItem) => void
  onResetFactory: (t: EmailTemplateListItem) => void
}

export function TemplateCard({
  template,
  view,
  onPreview,
  onSendTest,
  onToggleEnabled,
  onResetFactory,
}: TemplateCardProps) {
  const router = useRouter()
  const updated = template.last_updated_at || template.updated_at
  const overflow = (
    <MenuRoot>
      <Menu>
        <MenuTrigger>
          <Button size="sm" variant="ghost" aria-label="More actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon={<Eye className="h-4 w-4" />} onClick={() => onPreview(template)}>
            Preview
          </MenuItem>
          <MenuItem icon={<Send className="h-4 w-4" />} onClick={() => onSendTest(template)}>
            Send test
          </MenuItem>
          <MenuItem
            icon={<History className="h-4 w-4" />}
            onClick={() => router.push(`/settings/email/templates/${template.id}/versions`)}
          >
            Version history
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
        </MenuContent>
      </Menu>
    </MenuRoot>
  )

  const pills = (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant={template.is_enabled ? 'success' : 'neutral'} dot>
        {template.is_enabled ? 'Enabled' : 'Disabled'}
      </Badge>
      {template.has_draft && <Badge variant="warning">Has Unpublished Draft</Badge>}
      {template.is_system && <Badge variant="info">System</Badge>}
    </div>
  )

  if (view === 'list') {
    return (
      <div className="flex flex-wrap items-center gap-4 rounded-control border border-border bg-surface px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/settings/email/templates/${template.id}`}
              className="font-semibold text-foreground hover:text-accent"
            >
              {template.name}
            </Link>
            <CategoryBadge category={template.category} />
          </div>
          <SubjectPreview
            subject={template.subject}
            className="mt-1 font-mono text-xs text-foreground-muted"
          />
          <p className="mt-1 text-xs text-foreground-subtle">
            Updated {relativeTime(updated)}
            {template.updated_by_name ? ` by ${template.updated_by_name}` : ''}
          </p>
        </div>
        {pills}
        <div className="flex items-center gap-1">
          <Link href={`/settings/email/templates/${template.id}`}>
            <Button size="sm" leftIcon={<Pencil className="h-3.5 w-3.5" />}>
              Edit
            </Button>
          </Link>
          {overflow}
        </div>
      </div>
    )
  }

  return (
    <Card className={cn(!template.is_enabled && 'opacity-80')}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="truncate">{template.name}</CardTitle>
            <CategoryBadge category={template.category} />
          </div>
          {overflow}
        </div>
        {template.description && (
          <CardDescription className="line-clamp-2">{template.description}</CardDescription>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        <SubjectPreview subject={template.subject} />
        {pills}
        <p className="text-xs text-foreground-subtle">
          Last updated {relativeTime(updated)}
          {template.updated_by_name ? ` by ${template.updated_by_name}` : ''}
        </p>
        <Link href={`/settings/email/templates/${template.id}`}>
          <Button size="sm" className="w-full" leftIcon={<Pencil className="h-3.5 w-3.5" />}>
            Edit
          </Button>
        </Link>
      </CardBody>
    </Card>
  )
}
