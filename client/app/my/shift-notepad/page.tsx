'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser, User } from '@/lib/auth'
import { format } from 'date-fns'
import type { ShiftNoteCurrent } from '@/lib/shiftNotes'
import { formatDateTimeForDisplay } from '@/lib/time'

const DEBOUNCE_MS = 800
const DEFAULT_TEMPLATE = `— Shift notes —
• 
• 
• 
`

export default function ShiftNotepadPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [note, setNote] = useState<ShiftNoteCurrent | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedContentRef = useRef('')

  const loadCurrent = useCallback(async () => {
    try {
      const res = await api.get('/shift-notes/current')
      const data = res.data as ShiftNoteCurrent
      setNote(data)
      setContent(data.content ?? '')
      lastSavedContentRef.current = data.content ?? ''
    } catch (err: unknown) {
      const status = (err as { response?: { status: number; data?: { detail?: string } } })?.response?.status
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      if (status === 404) {
        setError('No open shift. Clock in first to use the shift notepad.')
        setNote(null)
        setContent('')
      } else if (status === 403) {
        setError(typeof detail === 'string' ? detail : 'Shift notepad is not available.')
        setNote(null)
      } else {
        setError('Failed to load shift notepad.')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      try {
        const currentUser = await getCurrentUser()
        setUser(currentUser)
        if (currentUser.role === 'ADMIN' || currentUser.role === 'DEVELOPER') {
          setError('Only employees can use the shift notepad.')
          setLoading(false)
          return
        }
        await loadCurrent()
      } catch {
        router.push('/login')
      }
    }
    init()
  }, [router, loadCurrent])

  const saveContent = useCallback(async (value: string) => {
    if (value === lastSavedContentRef.current) return
    setSaveStatus('saving')
    try {
      await api.put('/shift-notes/current', { content: value })
      lastSavedContentRef.current = value
      setSavedAt(new Date())
      setSaveStatus('saved')
    } catch {
      setSaveStatus('idle')
    }
  }, [])

  useEffect(() => {
    if (!note?.can_edit || saveStatus === 'saving') return
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      saveContent(content)
      saveTimeoutRef.current = null
    }, DEBOUNCE_MS)
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [content, note?.can_edit, saveContent])

  const insertTimestamp = () => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const ts = format(new Date(), 'h:mm a')
    const insertion = `${ts} — `
    const newContent = content.slice(0, start) + insertion + content.slice(end)
    setContent(newContent)
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(start + insertion.length, start + insertion.length)
    }, 0)
  }

  const insertTemplate = () => {
    if (content.trim().length > 0) return
    setContent(DEFAULT_TEMPLATE)
  }

  if (!user) return null

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Shift Notepad</h1>
        <p className="text-sm text-gray-600 mb-6">
          One note per shift. Autosaves as you type.
        </p>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
          </div>
        )}

        {error && !note && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-amber-800 text-sm">
            {error}
            <div className="mt-3">
              <a href="/punch-in-out" className="text-blue-600 hover:underline font-medium">
                Go to Punch In/Out →
              </a>
            </div>
          </div>
        )}

        {note && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="border-b border-gray-200 px-4 py-2 flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs text-gray-500">
                  {note.clock_in_at
                    ? `Shift started ${formatDateTimeForDisplay(note.clock_in_at)}`
                    : 'Current shift'}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={insertTimestamp}
                    disabled={!note.can_edit}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Insert timestamp
                  </button>
                  <button
                    type="button"
                    onClick={insertTemplate}
                    disabled={!note.can_edit || content.trim().length > 0}
                    className="text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Insert template
                  </button>
                </div>
              </div>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={!note.can_edit}
                placeholder="Write your shift notes here..."
                className="w-full min-h-[320px] p-4 text-gray-900 placeholder-gray-400 border-0 focus:ring-0 focus:outline-none resize-y font-mono text-sm leading-relaxed disabled:bg-gray-50 disabled:cursor-not-allowed"
                style={{ minHeight: '320px' }}
              />
              <div className="border-t border-gray-200 px-4 py-2 flex items-center justify-between text-xs text-gray-500">
                <span>
                  {saveStatus === 'saving' && 'Saving...'}
                  {saveStatus === 'saved' && savedAt && `Saved at ${format(savedAt, 'h:mm a')}`}
                  {saveStatus === 'idle' && !savedAt && '\u00a0'}
                </span>
                {!note.can_edit && (
                  <span className="text-amber-600">Read-only (shift closed)</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
