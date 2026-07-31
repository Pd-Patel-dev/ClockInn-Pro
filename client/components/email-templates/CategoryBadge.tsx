'use client'

import { Badge } from '@/components/ui'
import { CATEGORY_LABELS } from '@/lib/email-templates/utils'
import type { EmailTemplateCategory } from '@/lib/email-templates/types'

const variantByCategory: Record<EmailTemplateCategory, 'neutral' | 'info' | 'success' | 'warning'> = {
  TRANSACTIONAL: 'info',
  NOTIFICATION: 'warning',
  SUMMARY: 'neutral',
  MARKETING: 'success',
}

export function CategoryBadge({ category }: { category: EmailTemplateCategory | string }) {
  const key = category as EmailTemplateCategory
  return (
    <Badge variant={variantByCategory[key] ?? 'neutral'}>
      {CATEGORY_LABELS[category] ?? category}
    </Badge>
  )
}
