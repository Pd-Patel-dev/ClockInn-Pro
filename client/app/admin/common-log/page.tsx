'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  IconSearch,
  IconX,
  IconChevronDown,
  IconChevronUp,
  IconMessageSquare,
  IconCheckCircle,
} from '@/components/ui-icons'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser, type User } from '@/lib/auth'
import { useToast } from '@/components/Toast'

interface NoteRow {
  id: string
  employee_id: string
  employee_name: string
  clock_in_at: string | null
  clock_out_at: string | null
  content: string
  preview: string
  status: string
  latest_manager_comment: string | null
  updated_at: string
}

interface CommentItem {
  id: string
  actor_name: string | null
  comment: string
  created_at: string
}

function statusNorm(s: string) {
  return s.toLowerCase()
}

export default function AdminCommonLogPage() {
  const router = useRouter()
  const toast = useToast()
  const [user, setUser] = useState<User | null>(null)
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterEmployee, setFilterEmployee] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailComments, setDetailComments] = useState<Record<string, CommentItem[]>>({})

  const loadNotes = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (filterDateFrom) params.set('from_date', filterDateFrom)
      if (filterDateTo) params.set('to_date', filterDateTo)
      if (filterEmployee !== 'all') params.set('employee_id', filterEmployee)
      if (filterStatus !== 'all') params.set('status', filterStatus.toUpperCase())
      const res = await api.get(`/admin/shift-notes?${params.toString()}`)
      const data = res.data as { items?: NoteRow[] }
      const items = data.items ?? []
      setNotes(
        items.map((n) => ({
          ...n,
          content: n.content ?? '',
          latest_manager_comment: n.latest_manager_comment ?? null,
        }))
      )
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load shift notes'
      toast.error(typeof msg === 'string' ? msg : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [filterDateFrom, filterDateTo, filterEmployee, filterStatus, toast])

  useEffect(() => {
    const init = async () => {
      try {
        const u = await getCurrentUser()
        if (u.role !== 'ADMIN') {
          router.replace('/dashboard')
          return
        }
        setUser(u)
      } catch {
        router.push('/login')
      }
    }
    init()
  }, [router])

  useEffect(() => {
    if (user) loadNotes()
  }, [user, loadNotes])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return notes.filter((n) => {
      if (!q) return true
      return (
        (n.content || '').toLowerCase().includes(q) ||
        (n.employee_name || '').toLowerCase().includes(q) ||
        (n.preview || '').toLowerCase().includes(q)
      )
    })
  }, [notes, search])

  const unreviewed = notes.filter((n) => n.status !== 'REVIEWED').length

  const employees = useMemo(() => {
    const map = new Map<string, string>()
    notes.forEach((n) => map.set(n.employee_id, n.employee_name))
    return Array.from(map.entries())
  }, [notes])

  const markReviewed = async (noteId: string) => {
    try {
      await api.post(`/admin/shift-notes/${noteId}/review`)
      setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, status: 'REVIEWED' } : n)))
      toast.success('Marked reviewed')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(typeof msg === 'string' ? msg : 'Failed to update')
    }
  }

  const saveComment = async (noteId: string, comment: string) => {
    const trimmed = comment.trim()
    if (!trimmed) return
    try {
      await api.post(`/admin/shift-notes/${noteId}/comment`, { comment: trimmed })
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, latest_manager_comment: trimmed } : n))
      )
      const dres = await api.get(`/admin/shift-notes/${noteId}`)
      const d = dres.data as { comments?: CommentItem[] }
      if (d.comments) setDetailComments((c) => ({ ...c, [noteId]: d.comments! }))
      toast.success('Comment added')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(typeof msg === 'string' ? msg : 'Failed to save comment')
      throw e
    }
  }

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (!detailComments[id]) {
      try {
        const res = await api.get(`/admin/shift-notes/${id}`)
        const d = res.data as { comments?: CommentItem[] }
        setDetailComments((c) => ({ ...c, [id]: d.comments ?? [] }))
      } catch {
        setDetailComments((c) => ({ ...c, [id]: [] }))
      }
    }
  }

  const hasFilters =
    filterEmployee !== 'all' ||
    filterStatus !== 'all' ||
    Boolean(filterDateFrom) ||
    Boolean(filterDateTo)

  const clearFilters = () => {
    setFilterEmployee('all')
    setFilterStatus('all')
    setFilterDateFrom('')
    setFilterDateTo('')
  }

  if (!user) return null

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6 bg-gray-50 min-h-[calc(100vh-4rem)]">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Shift log</h1>
            <p className="text-sm text-gray-500 mt-0.5">All employee shift notes for your company</p>
          </div>
          {unreviewed > 0 && (
            <span className="text-xs font-medium text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full border border-gray-100">
              {unreviewed} unreviewed
            </span>
          )}
        </div>

        <div className="space-y-3">
          <div className="relative">
            <IconSearch
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              aria-hidden
            />
            <input
              type="search"
              placeholder="Search notes or employee name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-10 py-2 text-sm border border-gray-100 rounded-md focus:outline-none focus:border-gray-300 bg-white placeholder:text-gray-400 transition-colors duration-150"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors duration-150"
                aria-label="Clear search"
              >
                <IconX size={13} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterEmployee}
              onChange={(e) => setFilterEmployee(e.target.value)}
              className="text-sm border border-gray-100 rounded-md px-3 py-1.5 bg-white focus:outline-none focus:border-gray-300 text-gray-700 transition-colors duration-150"
            >
              <option value="all">All employees</option>
              {employees.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="text-sm border border-gray-100 rounded-md px-3 py-1.5 bg-white focus:outline-none focus:border-gray-300 text-gray-700 transition-colors duration-150"
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="reviewed">Reviewed</option>
            </select>

            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="text-sm border border-gray-100 rounded-md px-3 py-1.5 bg-white focus:outline-none focus:border-gray-300 text-gray-500"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="text-sm border border-gray-100 rounded-md px-3 py-1.5 bg-white focus:outline-none focus:border-gray-300 text-gray-500"
            />

            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors duration-150"
              >
                <IconX size={12} aria-hidden />
                Clear filters
              </button>
            )}

            <span className="ml-auto text-xs text-gray-400">
              {filtered.length} {filtered.length === 1 ? 'note' : 'notes'}
            </span>
          </div>
        </div>

        {loading ? (
          <LogSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState hasSearch={Boolean(search) || hasFilters} />
        ) : (
          <div className="space-y-1">
            {filtered.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                expanded={expandedId === note.id}
                onToggle={() => void toggleExpand(note.id)}
                comments={detailComments[note.id]}
                onMarkReviewed={() => void markReviewed(note.id)}
                onSaveComment={(c) => saveComment(note.id, c)}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}

function NoteRow({
  note,
  expanded,
  onToggle,
  comments,
  onMarkReviewed,
  onSaveComment,
}: {
  note: NoteRow
  expanded: boolean
  onToggle: () => void
  comments?: CommentItem[]
  onMarkReviewed: () => void
  onSaveComment: (c: string) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!expanded) {
      setDraft('')
      setDirty(false)
      return
    }
    setDraft('')
    setDirty(false)
  }, [expanded, note.id])

  const isUnreviewed = note.status !== 'REVIEWED'
  const isSubmitted = note.status === 'SUBMITTED'
  const shiftDate = note.clock_in_at ? new Date(note.clock_in_at) : null

  const flushComment = async () => {
    if (!dirty || !draft.trim()) return
    try {
      await onSaveComment(draft)
      setDraft('')
      setDirty(false)
    } catch {
      /* toast from parent */
    }
  }

  const st = statusNorm(note.status)

  return (
    <div
      className={`rounded-lg border bg-white transition-colors duration-150 ${
        isUnreviewed && isSubmitted
          ? 'border-l-[3px] border-l-gray-400 border-t-gray-100 border-r-gray-100 border-b-gray-100'
          : 'border-gray-100'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-gray-50 rounded-lg transition-colors duration-150"
      >
        <div
          className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-600 shrink-0"
          aria-hidden
        >
          {(note.employee_name || '?').charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900 truncate">{note.employee_name}</span>
            {shiftDate && (
              <span className="text-xs text-gray-400">
                {shiftDate.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
                {' · '}
                {shiftDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                {note.clock_out_at &&
                  ` — ${new Date(note.clock_out_at).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}`}
              </span>
            )}
          </div>
          {!expanded && (
            <p className="text-sm text-gray-400 truncate mt-0.5">
              {note.content ? (
                note.content.slice(0, 80) + (note.content.length > 80 ? '…' : '')
              ) : (
                <span className="italic">No notes written</span>
              )}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <StatusPill status={st} />
          {expanded ? (
            <IconChevronUp size={14} className="text-gray-400" aria-hidden />
          ) : (
            <IconChevronDown size={14} className="text-gray-400" aria-hidden />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100">
          <div className="pt-3">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
              Shift notes
            </p>
            {note.content ? (
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{note.content}</p>
            ) : (
              <p className="text-sm text-gray-400 italic">No notes written for this shift.</p>
            )}
          </div>

          {comments && comments.length > 0 && (
            <div className="space-y-2 border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Manager comments</p>
              <ul className="space-y-2">
                {comments.map((c) => (
                  <li key={c.id} className="text-sm text-gray-600 border-l-2 border-gray-100 pl-3">
                    <span className="text-xs text-gray-400">{c.actor_name || 'Manager'} · </span>
                    {c.comment}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-start gap-4 pt-2 border-t border-gray-100 flex-wrap">
            <div className="flex-1 space-y-1.5 min-w-[200px]">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1">
                <IconMessageSquare size={11} aria-hidden />
                Add manager comment
              </label>
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setDirty(true)
                }}
                onBlur={() => void flushComment()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void flushComment()
                  }
                }}
                placeholder="Add a comment (visible in history)…"
                rows={2}
                className="w-full text-sm border border-gray-100 rounded-md px-3 py-2 resize-none focus:outline-none focus:border-gray-300 placeholder:text-gray-400 text-gray-700 transition-colors duration-150"
              />
              <p className="text-xs text-gray-400">Enter to save · Shift+Enter for new line</p>
            </div>

            {note.status !== 'REVIEWED' ? (
              <button
                type="button"
                onClick={onMarkReviewed}
                className="flex items-center gap-1.5 text-sm bg-gray-900 text-white rounded-md px-3 py-2 transition-colors duration-150 hover:bg-gray-800 shrink-0 mt-5"
              >
                <IconCheckCircle size={14} aria-hidden />
                Mark reviewed
              </button>
            ) : (
              <div className="flex items-center gap-1.5 text-sm text-gray-600 mt-5 shrink-0">
                <IconCheckCircle size={14} aria-hidden />
                <span className="text-xs">Reviewed</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    submitted: 'bg-gray-100 text-gray-700',
    reviewed: 'bg-gray-100 text-gray-600',
  }
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
        styles[status] ?? 'bg-gray-100 text-gray-600'
      }`}
    >
      {status}
    </span>
  )
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="border border-gray-100 rounded-lg px-6 py-16 text-center bg-white">
      <p className="text-sm font-medium text-gray-700">
        {hasSearch ? 'No notes match your filters' : 'No shift notes yet'}
      </p>
      <p className="text-sm text-gray-400 mt-1">
        {hasSearch
          ? 'Try adjusting search or filters.'
          : 'Notes will appear as employees use the shift log.'}
      </p>
    </div>
  )
}

function LogSkeleton() {
  return (
    <div className="space-y-1 animate-pulse">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-14 bg-white rounded-lg border border-gray-100" />
      ))}
    </div>
  )
}
