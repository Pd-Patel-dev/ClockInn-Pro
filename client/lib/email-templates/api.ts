import api from '@/lib/api'
import type {
  DraftPayload,
  EmailTemplateDetail,
  EmailTemplateListItem,
  EmailTemplateVersionContent,
  PaginatedVersions,
  PreviewRequest,
  PreviewResponse,
  SendTestRequest,
  SendTestResponse,
  TemplateMetadataPatch,
} from './types'

const BASE = '/developer/email-templates'

export async function listEmailTemplates(params?: {
  category?: string
  q?: string
}): Promise<EmailTemplateListItem[]> {
  const res = await api.get(BASE, { params })
  const data = res.data
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  if (Array.isArray(data?.templates)) return data.templates
  return []
}

export async function getEmailTemplate(id: string): Promise<EmailTemplateDetail> {
  const res = await api.get(`${BASE}/${id}`)
  return res.data
}

export async function listTemplateVersions(
  id: string,
  params?: { page?: number; page_size?: number }
): Promise<PaginatedVersions> {
  const res = await api.get(`${BASE}/${id}/versions`, { params })
  const data = res.data
  if (Array.isArray(data)) {
    return { items: data, total: data.length, page: params?.page ?? 1, page_size: params?.page_size ?? 20 }
  }
  return {
    items: data.items ?? data.versions ?? [],
    total: data.total,
    page: data.page ?? params?.page ?? 1,
    page_size: data.page_size ?? params?.page_size ?? 20,
  }
}

export async function getTemplateVersion(
  id: string,
  versionId: string
): Promise<EmailTemplateVersionContent> {
  const res = await api.get(`${BASE}/${id}/versions/${versionId}`)
  return res.data
}

export async function saveDraft(id: string, body: DraftPayload): Promise<EmailTemplateVersionContent> {
  const res = await api.put(`${BASE}/${id}/draft`, body)
  return res.data
}

export async function publishDraft(
  id: string,
  body?: { notes?: string }
): Promise<EmailTemplateVersionContent> {
  const res = await api.post(`${BASE}/${id}/publish`, body ?? {})
  return res.data
}

export async function revertToVersion(
  id: string,
  versionId: string
): Promise<EmailTemplateVersionContent> {
  const res = await api.post(`${BASE}/${id}/revert/${versionId}`)
  return res.data
}

export async function discardDraft(id: string): Promise<void> {
  await api.delete(`${BASE}/${id}/draft`)
}

export async function previewTemplate(id: string, body: PreviewRequest): Promise<PreviewResponse> {
  const res = await api.post(`${BASE}/${id}/preview`, body)
  return res.data
}

export async function sendTestEmail(id: string, body: SendTestRequest): Promise<SendTestResponse> {
  const res = await api.post(`${BASE}/${id}/send-test`, body)
  return res.data
}

export async function resetToFactory(id: string): Promise<EmailTemplateVersionContent | EmailTemplateDetail> {
  const res = await api.post(`${BASE}/${id}/reset-to-factory`)
  return res.data
}

export async function patchTemplateMetadata(
  id: string,
  body: TemplateMetadataPatch
): Promise<EmailTemplateDetail> {
  const res = await api.patch(`${BASE}/${id}`, body)
  return res.data
}

export function apiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  const err = error as { response?: { data?: { detail?: unknown } }; message?: string }
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (typeof d === 'object' && d && 'msg' in d ? String((d as { msg: unknown }).msg) : String(d)))
      .join(', ')
  }
  if (detail && typeof detail === 'object' && 'message' in detail) {
    return String((detail as { message: unknown }).message)
  }
  return err.message || fallback
}
