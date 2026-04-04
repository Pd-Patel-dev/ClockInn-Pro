/**
 * Shift Notepad / Common Log API
 */

const BASE = '/shift-notes'

export interface ShiftNoteCurrent {
  id: string
  company_id: string
  time_entry_id: string
  employee_id: string
  employee_name?: string
  content: string
  beverage_sold?: number | null
  status: string
  last_edited_at: string | null
  last_edited_by: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  clock_in_at?: string | null
  clock_out_at?: string | null
  is_shift_open?: boolean | null
  can_edit?: boolean | null
}

export interface ShiftNoteListItemType {
  id: string
  time_entry_id: string
  employee_id: string
  employee_name: string
  clock_in_at: string | null
  clock_out_at: string | null
  preview: string
  content?: string | null
  latest_manager_comment?: string | null
  beverage_sold?: number | null
  status: string
  updated_at: string
  last_edited_at: string | null
  reviewed_at: string | null
  updated_since_review: boolean
  cash_delta_cents: number | null
}

export async function getCurrentShiftNote(api: { get: (url: string) => Promise<{ data: unknown }> }): Promise<ShiftNoteCurrent | null> {
  const res = await api.get(`${BASE}/current`)
  return res.data as ShiftNoteCurrent
}

export async function updateCurrentShiftNote(
  api: { put: (url: string, data: { content: string; beverage_sold?: number | null }) => Promise<{ data: unknown }> },
  content: string,
  beverage_sold?: number | null
): Promise<ShiftNoteCurrent> {
  const res = await api.put(`${BASE}/current`, { content, beverage_sold })
  return res.data as ShiftNoteCurrent
}

export async function getMyShiftNotes(
  api: { get: (url: string) => Promise<{ data: { items: ShiftNoteListItemType[]; total: number } }> },
  params?: { from?: string; to?: string; skip?: number; limit?: number }
): Promise<{ items: ShiftNoteListItemType[]; total: number }> {
  const sp = new URLSearchParams()
  if (params?.from) sp.set('from', params.from)
  if (params?.to) sp.set('to', params.to)
  if (params?.skip != null) sp.set('skip', String(params.skip))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  const q = sp.toString()
  const res = await api.get(`${BASE}/my${q ? `?${q}` : ''}`)
  return res.data
}

// Admin
export async function adminListShiftNotes(
  api: { get: (url: string) => Promise<{ data: { items: ShiftNoteListItemType[]; total: number } }> },
  params?: { from?: string; to?: string; employeeId?: string; status?: string; search?: string; skip?: number; limit?: number }
): Promise<{ items: ShiftNoteListItemType[]; total: number }> {
  const sp = new URLSearchParams()
  if (params?.from) sp.set('from', params.from)
  if (params?.to) sp.set('to', params.to)
  if (params?.employeeId) sp.set('employee_id', params.employeeId)
  if (params?.status) sp.set('status', params.status)
  if (params?.search) sp.set('search', params.search)
  if (params?.skip != null) sp.set('skip', String(params.skip))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  const q = sp.toString()
  const res = await api.get(`/admin/shift-notes${q ? `?${q}` : ''}`)
  return res.data
}

export interface ShiftNoteDetail {
  id: string
  company_id: string
  time_entry_id: string
  employee_id: string
  employee_name: string
  content: string
  beverage_sold?: number | null
  status: string
  last_edited_at: string | null
  last_edited_by: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  clock_in_at: string | null
  clock_out_at: string | null
  is_shift_open: boolean
  cash_start_cents: number | null
  cash_end_cents: number | null
  cash_delta_cents: number | null
}

export async function adminGetShiftNote(
  api: { get: (url: string) => Promise<{ data: ShiftNoteDetail }> },
  noteId: string
): Promise<ShiftNoteDetail> {
  const res = await api.get(`/admin/shift-notes/${noteId}`)
  return res.data
}

export async function adminReviewShiftNote(
  api: { post: (url: string) => Promise<{ data: unknown }> },
  noteId: string
): Promise<void> {
  await api.post(`/admin/shift-notes/${noteId}/review`)
}

export async function adminAddShiftNoteComment(
  api: { post: (url: string, data: { comment: string }) => Promise<{ data: unknown }> },
  noteId: string,
  comment: string
): Promise<void> {
  await api.post(`/admin/shift-notes/${noteId}/comment`, { comment })
}
