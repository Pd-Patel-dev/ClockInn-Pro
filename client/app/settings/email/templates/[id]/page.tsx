'use client'

import { useParams } from 'next/navigation'
import { useDeveloperAuth, DeveloperAuthLoading } from '@/components/developer/useDeveloperAuth'
import { TemplateEditorWorkspace } from '@/components/email-templates/TemplateEditorWorkspace'

export default function EmailTemplateEditorPage() {
  const params = useParams()
  const id = String(params.id)
  const { user, loading } = useDeveloperAuth()

  if (loading || !user) return <DeveloperAuthLoading />

  return <TemplateEditorWorkspace templateId={id} user={user} mode="edit" />
}
