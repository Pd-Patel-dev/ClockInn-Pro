'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { History, RotateCcw } from 'lucide-react'
import { Avatar, Badge, Button, Drawer, Skeleton } from '@/components/ui'
import { listTemplateVersions } from '@/lib/email-templates/api'
import { formatDateTime } from '@/lib/email-templates/utils'
import type { EmailTemplateVersionSummary } from '@/lib/email-templates/types'
import logger from '@/lib/logger'

interface VersionHistoryDrawerProps {
  open: boolean
  onClose: () => void
  templateId: string
  onRestore: (versionId: string) => void
  onCompare?: () => void
}

export function VersionHistoryDrawer({
  open,
  onClose,
  templateId,
  onRestore,
  onCompare,
}: VersionHistoryDrawerProps) {
  const [items, setItems] = useState<EmailTemplateVersionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState<number | undefined>()
  const pageSize = 20

  const load = useCallback(
    async (p: number, append = false) => {
      setLoading(true)
      try {
        const res = await listTemplateVersions(templateId, { page: p, page_size: pageSize })
        setItems((prev) => (append ? [...prev, ...res.items] : res.items))
        setTotal(res.total)
        setPage(p)
      } catch (err) {
        logger.error('Failed to load template versions', err as Error)
      } finally {
        setLoading(false)
      }
    },
    [templateId]
  )

  useEffect(() => {
    if (!open) return
    load(1)
  }, [open, load])

  const hasMore = total != null ? items.length < total : items.length >= pageSize && items.length > 0

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Version history"
      description="Newest versions first"
      widthClass="w-full max-w-[480px]"
    >
      <div className="-mx-5 -my-4 flex h-[calc(100vh-4.5rem)] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {loading && items.length === 0 && (
            <>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </>
          )}
          {!loading && items.length === 0 && (
            <p className="text-sm text-foreground-muted">No versions yet.</p>
          )}
          {items.map((v) => (
            <div
              key={v.id}
              className="rounded-control border border-border bg-surface px-3 py-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">v{v.version_number}</span>
                    {v.is_published && (
                      <Badge variant="success" dot>
                        Live
                      </Badge>
                    )}
                    {v.is_draft && <Badge variant="warning">Draft</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {v.published_at
                      ? `Published ${formatDateTime(v.published_at)}`
                      : `Created ${formatDateTime(v.created_at)}`}
                  </p>
                  {(v.published_by_name || v.published_by) && (
                    <div className="mt-2 flex items-center gap-2">
                      <Avatar
                        name={v.published_by_name || 'User'}
                        src={v.published_by_avatar_url}
                        size="sm"
                      />
                      <span className="truncate text-xs text-foreground-muted">
                        {v.published_by_name || 'Unknown'}
                      </span>
                    </div>
                  )}
                  {v.notes && (
                    <p className="mt-2 line-clamp-2 text-xs text-foreground-subtle">{v.notes}</p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/settings/email/templates/${templateId}/versions/${v.id}`}>
                  <Button size="sm" variant="secondary" leftIcon={<History className="h-3.5 w-3.5" />}>
                    View
                  </Button>
                </Link>
                {!v.is_draft && (
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                    onClick={() => onRestore(v.id)}
                  >
                    Restore
                  </Button>
                )}
              </div>
            </div>
          ))}
          {hasMore && (
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              loading={loading}
              onClick={() => load(page + 1, true)}
            >
              Load more
            </Button>
          )}
        </div>
        {onCompare && (
          <div className="border-t border-border px-5 py-4">
            <Button variant="secondary" className="w-full" onClick={onCompare}>
              Compare versions
            </Button>
          </div>
        )}
      </div>
    </Drawer>
  )
}
