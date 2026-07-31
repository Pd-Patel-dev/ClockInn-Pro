'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { cn } from '@/lib/cn'
import { Input } from '@/components/ui/Input'

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

type PaletteRow =
  | { kind: 'action'; id: string; label: string; hint?: string; run: () => void }
  | { kind: 'user'; id: string; label: string; sub: string; href: string }
  | { kind: 'company'; id: string; label: string; sub: string; href: string }

const RECENT_KEY = 'clockinn.commandPalette.recent'

function loadRecent(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string').slice(0, 5) : []
  } catch {
    return []
  }
}

function pushRecent(href: string) {
  const prev = loadRecent().filter((h) => h !== href)
  const next = [href, ...prev].slice(0, 8)
  localStorage.setItem(RECENT_KEY, JSON.stringify(next))
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string }>>([])
  const [companies, setCompanies] = useState<Array<{ id: string; name: string; slug: string }>>([])
  const [activeIndex, setActiveIndex] = useState(0)

  const quickActions: PaletteRow[] = useMemo(
    () => [
      {
        kind: 'action',
        id: 'create-company',
        label: 'Create company',
        hint: 'Developer',
        run: () => router.push('/developer/companies'),
      },
      {
        kind: 'action',
        id: 'add-developer',
        label: 'Add developer',
        run: () => router.push('/developer/developers'),
      },
      {
        kind: 'action',
        id: 'view-logs',
        label: 'View activity logs',
        run: () => router.push('/developer/logs'),
      },
    ],
    [router]
  )

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    setUsers([])
    setCompanies([])
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) {
      setUsers([])
      setCompanies([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const [usersRes, companiesRes] = await Promise.all([
          api.get('/developer/users', { params: { q, limit: 8 } }),
          api.get('/developer/companies', { params: { q, limit: 8 } }),
        ])
        if (cancelled) return
        setUsers(
          (usersRes.data ?? []).map((u: { id: string; name: string; email: string }) => ({
            id: u.id,
            name: u.name,
            email: u.email,
          }))
        )
        setCompanies(
          (companiesRes.data ?? []).map((c: { id: string; name: string; slug: string }) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
          }))
        )
      } catch {
        if (!cancelled) {
          setUsers([])
          setCompanies([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query])

  const rows: PaletteRow[] = useMemo(() => {
    const q = query.trim()
    const result: PaletteRow[] = []
    if (q.length < 2) {
      result.push(...quickActions)
      const recent = loadRecent()
      recent.forEach((href, i) => {
        result.push({
          kind: 'action',
          id: `recent-${i}`,
          label: `Open recent`,
          hint: href,
          run: () => router.push(href),
        })
      })
      return result
    }
    companies.forEach((c) => {
      result.push({
        kind: 'company',
        id: c.id,
        label: c.name,
        sub: c.slug,
        href: `/developer/companies/${c.id}`,
      })
    })
    users.forEach((u) => {
      result.push({
        kind: 'user',
        id: u.id,
        label: u.name,
        sub: u.email,
        href: `/developer/users/${u.id}`,
      })
    })
    if (result.length === 0) {
      result.push(...quickActions)
    }
    return result
  }, [query, quickActions, companies, users, router])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, rows.length])

  const go = useCallback(
    (row: PaletteRow) => {
      if (row.kind === 'action') {
        row.run()
      } else {
        pushRecent(row.href)
        router.push(row.href)
      }
      onClose()
    },
    [onClose, router]
  )

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (rows.length ? (i + 1) % rows.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0))
    } else if (e.key === 'Enter' && rows[activeIndex]) {
      e.preventDefault()
      go(rows[activeIndex])
    }
  }

  if (!open) return null

  let section: 'quick' | 'users' | 'companies' | 'recent' | null = null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh] sm:p-6" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        aria-label="Close command palette"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-xl surface-elevated shadow-lifted overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-hotkey-ignore="true"
      >
        <div className="border-b border-border p-3">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search users, companies, logs…"
            aria-label="Search"
            autoComplete="off"
          />
        </div>
        <ul className="max-h-[min(420px,50vh)] overflow-y-auto py-2" role="listbox">
          {loading && (
            <li className="px-4 py-2 text-sm text-foreground-muted">Searching…</li>
          )}
          {!loading && rows.length === 0 && (
            <li className="px-4 py-2 text-sm text-foreground-muted">No results</li>
          )}
          {rows.map((row, index) => {
            let heading: string | null = null
            if (row.kind === 'action' && query.trim().length < 2) {
              if (row.id.startsWith('recent-')) {
                if (section !== 'recent') {
                  section = 'recent'
                  heading = 'Recent'
                }
              } else if (section !== 'quick') {
                section = 'quick'
                heading = 'Quick actions'
              }
            } else if (row.kind === 'company' && section !== 'companies') {
              section = 'companies'
              heading = 'Companies'
            } else if (row.kind === 'user' && section !== 'users') {
              section = 'users'
              heading = 'Users'
            }

            return (
              <React.Fragment key={`${row.kind}-${row.id}`}>
                {heading && (
                  <li className="px-4 pt-2 pb-1 text-2xs font-semibold uppercase tracking-wide text-foreground-subtle">
                    {heading}
                  </li>
                )}
                <li role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left text-sm',
                      index === activeIndex ? 'bg-accent/10 text-foreground' : 'text-foreground hover:bg-border-subtle/70'
                    )}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => go(row)}
                  >
                    <span className="font-medium">{row.label}</span>
                    {(row.kind === 'user' || row.kind === 'company') && (
                      <span className="text-xs text-foreground-muted">{row.sub}</span>
                    )}
                    {row.kind === 'action' && row.hint && (
                      <span className="text-xs text-foreground-muted">{row.hint}</span>
                    )}
                  </button>
                </li>
              </React.Fragment>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
