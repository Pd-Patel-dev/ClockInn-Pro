'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { useDeveloperAuth, DeveloperAuthLoading } from '@/components/developer/useDeveloperAuth'
import { useToast } from '@/components/Toast'
import { Avatar, Badge, Button, ConfirmModal, Skeleton } from '@/components/ui'
import {
  apiErrorMessage,
  listTemplateVersions,
  revertToVersion,
} from '@/lib/email-templates/api'
import { formatDateTime } from '@/lib/email-templates/utils'
import type { EmailTemplateVersionSummary } from '@/lib/email-templates/types'
import logger from '@/lib/logger'

export default function EmailTemplateVersionsPage() {
  const params = useParams()
  const id = String(params.id)
  const router = useRouter()
  const toast = useToast()
  const { user, loading: authLoading } = useDeveloperAuth()
  const [items, setItems] = useState<EmailTemplateVersionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [restoreId, setRestoreId] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await listTemplateVersions(id, { page: 1, page_size: 50 })
        if (!cancelled) setItems(res.items)
      } catch (err) {
        logger.error('Failed to load versions', err as Error)
        toast.error(apiErrorMessage(err, 'Failed to load versions'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authLoading, user, id, toast])

  const handleRestore = async () => {
    if (!restoreId) return
    setRestoring(true)
    try {
      await revertToVersion(id, restoreId)
      toast.success('Draft created from selected version')
      setRestoreId(null)
      router.push(`/settings/email/templates/${id}`)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to restore'))
    } finally {
      setRestoring(false)
    }
  }

  if (authLoading || !user) return <DeveloperAuthLoading />

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <Link
          href={`/settings/email/templates/${id}`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-accent hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to editor
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Version history</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          View or restore a previous version as a new draft.
        </p>
      </div>

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="text-sm text-foreground-muted">No versions yet.</p>
      )}

      <div className="space-y-3">
        {items.map((v) => (
          <div key={v.id} className="rounded-control border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">v{v.version_number}</span>
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
                    <Avatar name={v.published_by_name || 'User'} src={v.published_by_avatar_url} size="sm" />
                    <span className="text-xs text-foreground-muted">
                      {v.published_by_name || 'Unknown'}
                    </span>
                  </div>
                )}
                {v.notes && <p className="mt-2 text-sm text-foreground-subtle">{v.notes}</p>}
              </div>
              <div className="flex gap-2">
                <Link href={`/settings/email/templates/${id}/versions/${v.id}`}>
                  <Button size="sm" variant="secondary">
                    View
                  </Button>
                </Link>
                {!v.is_draft && (
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                    onClick={() => setRestoreId(v.id)}
                  >
                    Restore
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <ConfirmModal
        open={!!restoreId}
        onClose={() => setRestoreId(null)}
        onConfirm={handleRestore}
        loading={restoring}
        title="Restore this version?"
        message="This creates a new draft from the selected version. The published version stays live until you publish."
        confirmLabel="Restore as draft"
      />
    </div>
  )
}
