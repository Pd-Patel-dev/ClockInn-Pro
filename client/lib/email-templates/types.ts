export type EmailTemplateCategory =
  | 'TRANSACTIONAL'
  | 'NOTIFICATION'
  | 'SUMMARY'
  | 'MARKETING'

export interface VariableMeta {
  type?: string
  example?: unknown
  required?: boolean
  description?: string
}

export type VariablesSchema = Record<string, VariableMeta>

export interface EmailTemplateVersionContent {
  id: string
  template_id?: string
  version_number: number
  subject: string
  body_html: string
  body_text: string
  from_name?: string | null
  from_email?: string | null
  reply_to?: string | null
  is_published: boolean
  is_draft: boolean
  published_at?: string | null
  published_by?: string | null
  published_by_name?: string | null
  published_by_avatar_url?: string | null
  created_at?: string
  notes?: string | null
}

export interface EmailTemplateListItem {
  id: string
  key: string
  name: string
  description?: string | null
  category: EmailTemplateCategory
  is_enabled: boolean
  is_system: boolean
  has_draft: boolean
  subject?: string | null
  last_updated_at?: string | null
  updated_at?: string | null
  updated_by_name?: string | null
}

export interface EmailTemplateDetail {
  id: string
  key: string
  name: string
  description?: string | null
  category: EmailTemplateCategory
  is_enabled: boolean
  is_system: boolean
  variables_schema: VariablesSchema
  published_version?: EmailTemplateVersionContent | null
  draft_version?: EmailTemplateVersionContent | null
  has_draft?: boolean
  last_updated_at?: string | null
  updated_by_name?: string | null
}

export interface EmailTemplateVersionSummary {
  id: string
  version_number: number
  is_published: boolean
  is_draft: boolean
  published_at?: string | null
  published_by?: string | null
  published_by_name?: string | null
  published_by_avatar_url?: string | null
  created_at?: string
  notes?: string | null
  subject?: string | null
}

export interface PaginatedVersions {
  items: EmailTemplateVersionSummary[]
  total?: number
  page?: number
  page_size?: number
}

export interface DraftPayload {
  subject: string
  body_html: string
  body_text: string
  from_name?: string | null
  from_email?: string | null
  reply_to?: string | null
  notes?: string | null
}

export interface PreviewRequest {
  version: 'draft' | 'published' | string
  variables?: Record<string, unknown>
  format?: 'html' | 'text' | 'both'
}

export interface PreviewResponse {
  subject: string
  body_html?: string
  body_text?: string
  warnings?: string[]
}

export interface SendTestRequest {
  to_email: string
  version: 'draft' | 'published'
  variables?: Record<string, unknown>
}

export interface SendTestResponse {
  status?: string
  subject?: string
  message?: string
}

export interface TemplateMetadataPatch {
  name?: string
  description?: string | null
  category?: EmailTemplateCategory
  is_enabled?: boolean
}

export type SaveStatus = 'idle' | 'editing' | 'saving' | 'saved' | 'failed'

export type EditorBodyTab = 'html' | 'text'
export type PreviewTab = 'html' | 'text' | 'mobile'
