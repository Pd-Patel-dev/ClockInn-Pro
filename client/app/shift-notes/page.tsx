'use client'

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
} from 'react'
import { useRouter } from 'next/navigation'
import {
  IconClock,
  IconCheckCircle,
  IconLock,
  IconChevronDown,
  IconChevronUp,
} from '@/components/ui-icons'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser, type User } from '@/lib/auth'
import type { ShiftNoteCurrent } from '@/lib/shiftNotes'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface PastNoteRow {
  id: string
  time_entry_id: string
  content: string
  status: string
  clock_in_at: string | null
  clock_out_at: string | null
  latest_manager_comment: string | null
  reviewed_at: string | null
  reviewer_name?: string | null
}

const AUTOSAVE_MS = 10_000
const MIN_NOTE_LEN = 10

function statusLabel(s: string) {
  return s.toLowerCase()
}

export default function ShiftNotesPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [activeNote, setActiveNote] = useState<ShiftNoteCurrent | null>(null)
  const [pastNotes, setPastNotes] = useState<PastNoteRow[]>([])
  const [content, setContent] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [noteRequiredOnClockOut, setNoteRequiredOnClockOut] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSent = useRef('')

  const clearSaveTimer = () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
  }

  const save = useCallback(async () => {
    if (!activeNote?.can_edit) return
    if (content === lastSent.current) return
    setSaveState('saving')
    try {
      await api.put('/shift-notes/current', { content })
      lastSent.current = content
      setLastSaved(new Date())
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2500)
    } catch {
      setSaveState('error')
    }
  }, [activeNote?.can_edit, content])

  const scheduleSave = useCallback(() => {
    clearSaveTimer()
    saveTimer.current = setTimeout(() => {
      save()
      saveTimer.current = null
    }, AUTOSAVE_MS)
  }, [save])

  const loadNotes = useCallback(async () => {
    setLoading(true)
    setPageError(null)
    try {
      const [currentRes, pastRes, infoRes] = await Promise.allSettled([
        api.get('/shift-notes/current'),
        api.get('/shift-notes/past?limit=10'),
        api.get('/company/info'),
      ])
      if (infoRes.status === 'fulfilled') {
        const s = infoRes.value.data?.settings
        setNoteRequiredOnClockOut(s?.shift_notes_required_on_clock_out === true)
      }
      if (currentRes.status === 'fulfilled') {
        const note = currentRes.value.data as ShiftNoteCurrent
        setActiveNote(note)
        setContent(note.content ?? '')
        lastSent.current = note.content ?? ''
      } else {
        const err = currentRes.reason as { response?: { status?: number; data?: { detail?: string } } }
        const st = err?.response?.status
        const detail = err?.response?.data?.detail
        setActiveNote(null)
        setContent('')
        if (st === 404) {
          setPageError(null)
        } else if (st === 403) {
          setPageError(typeof detail === 'string' ? detail : 'Shift log is not available.')
        } else {
          setPageError('Could not load your current shift note.')
        }
      }
      if (pastRes.status === 'fulfilled') {
        const items = (pastRes.value.data as { items?: PastNoteRow[] })?.items ?? []
        setPastNotes(items)
      } else {
        setPastNotes([])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      try {
        const u = await getCurrentUser()
        setUser(u)
        if (u.role === 'ADMIN' || u.role === 'DEVELOPER') {
          router.replace('/dashboard')
          return
        }
        await loadNotes()
      } catch {
        router.push('/login')
      }
    }
    init()
  }, [router, loadNotes])

  const handleChange = (value: string) => {
    setContent(value)
    if (saveState !== 'saving') setSaveState('idle')
    scheduleSave()
  }

  useEffect(() => {
    return () => clearSaveTimer()
  }, [])

  if (!user) return null

  const isLocked = activeNote != null && activeNote.can_edit === false
  const showClockOutReminder =
    noteRequiredOnClockOut &&
    activeNote?.can_edit &&
    content.trim().length < MIN_NOTE_LEN

  if (loading) {
    return (
      <Layout>
        <PageSkeleton />
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8 bg-gray-50 min-h-[calc(100vh-4rem)]">
        <div>
          <h1 className="text-base font-semibold text-gray-900">Shift log</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Notes during your shift. Your manager can read them in the team shift log.
          </p>
        </div>

        {pageError && (
          <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 text-sm text-gray-700">
            {pageError}
          </div>
        )}

        {showClockOutReminder && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
            A short note is required before you clock out. Add a few words about your shift.
          </p>
        )}

        {activeNote ? (
          <div className="space-y-3">
            <ShiftHeader
              clockInAt={activeNote.clock_in_at}
              clockOutAt={activeNote.clock_out_at}
              isActive={activeNote.is_shift_open === true}
            />
            {activeNote.reviewed_at && (
              <ReviewedBanner
                reviewedAt={activeNote.reviewed_at}
                reviewerName={activeNote.reviewer_name ?? null}
              />
            )}
            <NoteEditor
              content={content}
              onChange={handleChange}
              onBlur={() => void save()}
              locked={isLocked}
              saveState={saveState}
              lastSaved={lastSaved}
            />
          </div>
        ) : (
          !pageError && <EmptyActiveShift />
        )}

        {pastNotes.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Previous shifts
            </h2>
            <div className="space-y-2">
              {pastNotes.map((note) => (
                <PastNoteCard key={note.id} note={note} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

function ShiftHeader({
  clockInAt,
  clockOutAt,
  isActive,
}: {
  clockInAt?: string | null
  clockOutAt?: string | null
  isActive: boolean
}) {
  if (!clockInAt) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <IconClock size={14} className="text-gray-400" />
        <span>Current shift</span>
      </div>
    )
  }
  const start = new Date(clockInAt)
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <IconClock size={14} className="text-gray-400" />
        <span>
          {start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </span>
        <span className="text-gray-300">·</span>
        <span>
          {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          {clockOutAt && (
            <>
              {' — '}
              {new Date(clockOutAt).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </>
          )}
        </span>
      </div>
      {isActive && (
        <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full font-medium">
          Active shift
        </span>
      )}
    </div>
  )
}

const NoteEditor = forwardRef<
  HTMLTextAreaElement,
  {
    content: string
    onChange: (v: string) => void
    onBlur: () => void
    locked: boolean
    saveState: SaveState
    lastSaved: Date | null
  }
>(({ content, onChange, onBlur, locked, saveState, lastSaved }, ref) => {
  return (
    <div className="space-y-2">
      <div
        className={`relative rounded-lg border bg-white transition-colors duration-150 ${
          locked ? 'border-gray-100 bg-gray-50' : 'border-gray-100 focus-within:border-gray-300'
        }`}
      >
        {locked && (
          <div className="absolute top-3 right-3 flex items-center gap-1 text-xs text-gray-400">
            <IconLock size={12} aria-hidden />
            <span>Locked</span>
          </div>
        )}
        <textarea
          ref={ref}
          value={content}
          onChange={(e) => !locked && onChange(e.target.value)}
          onBlur={onBlur}
          readOnly={locked}
          placeholder={
            locked
              ? ''
              : 'Write your shift notes — what happened, handover items, issues…'
          }
          rows={8}
          className={`w-full resize-none rounded-lg px-4 py-4 text-sm placeholder:text-gray-400 focus:outline-none bg-transparent transition-colors duration-150 ${
            locked ? 'text-gray-500 cursor-default' : 'text-gray-900'
          }`}
        />
      </div>
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-gray-400">
          {locked
            ? 'This shift has ended — notes are read-only.'
            : 'Notes save automatically every few seconds and when you leave this field.'}
        </p>
        <SaveIndicator state={saveState} lastSaved={lastSaved} />
      </div>
    </div>
  )
})
NoteEditor.displayName = 'NoteEditor'

function SaveIndicator({ state, lastSaved }: { state: SaveState; lastSaved: Date | null }) {
  if (state === 'saving') {
    return <span className="text-xs text-gray-400">Saving…</span>
  }
  if (state === 'saved') {
    return (
      <span className="text-xs text-gray-600 flex items-center gap-1">
        <IconCheckCircle size={11} aria-hidden />
        Saved
      </span>
    )
  }
  if (state === 'error') {
    return <span className="text-xs text-red-600">Could not save</span>
  }
  if (lastSaved) {
    return (
      <span className="text-xs text-gray-400">
        Saved {lastSaved.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </span>
    )
  }
  return null
}

function PastNoteCard({ note }: { note: PastNoteRow }) {
  const [expanded, setExpanded] = useState(false)
  const start = note.clock_in_at ? new Date(note.clock_in_at) : null
  const st = statusLabel(note.status)

  return (
    <div className="border border-gray-100 rounded-lg bg-white transition-colors duration-150">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors duration-150 rounded-lg"
      >
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          {start && (
            <>
              <span className="text-sm text-gray-700">
                {start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              <span className="text-xs text-gray-400">
                {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                {note.clock_out_at &&
                  ` — ${new Date(note.clock_out_at).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}`}
              </span>
            </>
          )}
          <StatusPill status={st} />
        </div>
        {expanded ? (
          <IconChevronUp size={14} className="text-gray-400 shrink-0" aria-hidden />
        ) : (
          <IconChevronDown size={14} className="text-gray-400 shrink-0" aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 space-y-3">
          <p className="text-sm text-gray-700 whitespace-pre-wrap pt-3">
            {note.content ? (
              note.content
            ) : (
              <span className="text-gray-400 italic">No notes for this shift.</span>
            )}
          </p>
          {note.reviewed_at && (
            <ReviewedBanner
              reviewedAt={note.reviewed_at}
              reviewerName={note.reviewer_name ?? null}
              compact
            />
          )}
          {note.latest_manager_comment && (
            <div className="border border-gray-100 rounded-md px-3 py-2 bg-gray-50">
              <p className="text-xs font-medium text-gray-500 mb-1">Manager note</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.latest_manager_comment}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ReviewedBanner({
  reviewedAt,
  reviewerName,
  compact,
}: {
  reviewedAt: string
  reviewerName: string | null
  compact?: boolean
}) {
  const dt = new Date(reviewedAt)
  const dateStr = dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const timeStr = dt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
  const who =
    reviewerName?.trim() ||
    'A manager'
  const text = `${who} reviewed this note on ${dateStr} at ${timeStr}.`
  return (
    <div
      className={`rounded-md border border-emerald-100 bg-emerald-50/80 ${
        compact ? 'px-3 py-2' : 'px-4 py-3'
      }`}
    >
      <p
        className={`text-emerald-900 ${compact ? 'text-xs' : 'text-sm'} flex items-start gap-2`}
      >
        <IconCheckCircle
          size={compact ? 14 : 16}
          className="text-emerald-600 shrink-0 mt-0.5"
          aria-hidden
        />
        <span>{text}</span>
      </p>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    submitted: 'bg-gray-100 text-gray-700',
    reviewed: 'bg-gray-100 text-gray-600',
  }
  const cls = styles[status] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${cls}`}>{status}</span>
  )
}

function EmptyActiveShift() {
  return (
    <div className="border border-gray-100 rounded-lg px-6 py-12 text-center bg-white">
      <p className="text-sm font-medium text-gray-700">No active shift</p>
      <p className="text-sm text-gray-400 mt-1">
        Your shift log will show here after you clock in.
      </p>
      <a
        href="/punch-in-out"
        className="inline-block mt-4 text-sm font-medium text-gray-900 border border-gray-200 rounded-md px-4 py-2 transition-colors duration-150 hover:bg-gray-50"
      >
        Go to Punch In/Out
      </a>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6 animate-pulse bg-gray-50 min-h-[calc(100vh-4rem)]">
      <div className="h-4 w-32 bg-gray-100 rounded-md" />
      <div className="h-48 bg-white rounded-lg border border-gray-100" />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-white rounded-lg border border-gray-100" />
        ))}
      </div>
    </div>
  )
}
