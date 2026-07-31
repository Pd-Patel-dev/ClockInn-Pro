'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { Modal } from '@/components/ui/Modal'
import { LogLineRow } from './LogLine'
import { LogsToolbar } from './LogsToolbar'
import { DEFAULT_LOG_SETTINGS, type LogsDisplaySettings } from './LogsSettings'
import { useLogStream, type LogLevel } from './useLogStream'

const DEFAULT_LEVELS = new Set<LogLevel>(['INFO', 'WARNING', 'ERROR', 'CRITICAL'])
const ALL_LEVELS: LogLevel[] = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']

const FONT: Record<LogsDisplaySettings['fontSize'], string> = {
  S: 'text-[11px]',
  M: 'text-[12px]',
  L: 'text-[14px]',
}

export function LogsConsole() {
  const [levels, setLevels] = useState<Set<LogLevel>>(new Set(DEFAULT_LEVELS))
  const [query, setQuery] = useState('')
  const [paused, setPaused] = useState(false)
  const [settings, setSettings] = useState<LogsDisplaySettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_LOG_SETTINGS
    try {
      const wrap = localStorage.getItem('logs.wrapLines')
      if (wrap === '1' || wrap === 'true') {
        return { ...DEFAULT_LOG_SETTINGS, wrap: true }
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_LOG_SETTINGS
  })

  const updateSettings = (next: LogsDisplaySettings) => {
    setSettings(next)
    try {
      localStorage.setItem('logs.wrapLines', next.wrap ? '1' : '0')
    } catch {
      /* ignore */
    }
  }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)
  const [hiddenLoggers, setHiddenLoggers] = useState<Set<string>>(new Set())
  const [stickToBottom, setStickToBottom] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)
  const gPendingRef = useRef(false)

  const { lines, status, error, pendingCount, clear, download, reconnect } = useLogStream({
    levels,
    query,
    paused,
  })

  const visible = lines.filter((l) => !hiddenLoggers.has(l.logger))

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setStickToBottom(true)
    setSettings((s) => ({ ...s, autoScroll: true }))
  }, [])

  useEffect(() => {
    if (!settings.autoScroll || !stickToBottom || paused) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [visible.length, settings.autoScroll, stickToBottom, paused])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    setStickToBottom(atBottom)
  }

  const toggleLevel = (level: LogLevel) => {
    setLevels((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      if (next.size === 0) next.add('INFO')
      return next
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable

      if (e.key === '/' && !typing) {
        e.preventDefault()
        document.getElementById('logs-search')?.focus()
        return
      }
      if (e.key === '?' && !typing) {
        e.preventDefault()
        setShortcutsOpen(true)
        return
      }
      if (typing) return

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        setPaused((p) => !p)
        return
      }
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        clear()
        return
      }
      if (e.key === 'Escape') {
        setFocusedIdx(null)
        setSettingsOpen(false)
        return
      }
      if ((e.key === 'g' || e.key === 'G') && !e.metaKey && !e.ctrlKey) {
        if (gPendingRef.current) {
          gPendingRef.current = false
          scrollToBottom()
        } else {
          gPendingRef.current = true
          setTimeout(() => {
            gPendingRef.current = false
          }, 500)
        }
        return
      }
      if (e.key === 'ArrowDown' && focusedIdx != null) {
        e.preventDefault()
        setFocusedIdx((i) => Math.min((i ?? 0) + 1, visible.length - 1))
      }
      if (e.key === 'ArrowUp' && focusedIdx != null) {
        e.preventDefault()
        setFocusedIdx((i) => Math.max((i ?? 0) - 1, 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clear, focusedIdx, scrollToBottom, visible.length])

  const copyAll = async () => {
    const text = visible.map((l) => l.raw).join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="-mx-4 -mb-8 flex h-[calc(100vh-8.5rem)] min-h-[28rem] flex-col overflow-hidden rounded-card border border-border bg-surface sm:-mx-0">
      <LogsToolbar
        status={status}
        error={error}
        levels={levels}
        onToggleLevel={toggleLevel}
        onSelectAllLevels={() => setLevels(new Set(ALL_LEVELS))}
        query={query}
        onQueryChange={setQuery}
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        pendingCount={pendingCount}
        onClear={clear}
        onDownload={() => void download()}
        onCopyAll={() => void copyAll()}
        onReconnect={reconnect}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((o) => !o)}
        settings={settings}
        onSettingsChange={updateSettings}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className={cn(
            'h-full overflow-y-auto overflow-x-hidden font-mono',
            FONT[settings.fontSize]
          )}
          style={{ background: '#0b0d10', colorScheme: 'dark' }}
          role="log"
          aria-live="off"
        >
          {visible.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
              <span className="inline-flex items-center gap-2 text-sm">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500/80" />
                Waiting for logs…
              </span>
              <p className="text-xs text-slate-600">Actions in your app will appear here as they happen.</p>
            </div>
          ) : (
            visible.map((line, idx) => (
              <LogLineRow
                key={`${line.seq ?? idx}-${line.timestamp}-${idx}`}
                line={line}
                settings={settings}
                focused={focusedIdx === idx}
                onFocus={() => setFocusedIdx(idx)}
                onFilterLogger={(logger) => setQuery(logger)}
                onHideLogger={(logger) =>
                  setHiddenLoggers((prev) => new Set(prev).add(logger))
                }
              />
            ))
          )}
        </div>

        {!stickToBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 rounded-full border border-white/10 bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-slate-200 shadow-lifted hover:bg-slate-800"
          >
            Jump to latest
          </button>
        )}
      </div>

      <Modal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Keyboard shortcuts"
      >
        <ul className="space-y-2 text-sm text-foreground-muted">
          <li>
            <kbd className="rounded border border-border px-1.5 py-0.5 text-xs">/</kbd> Focus search
          </li>
          <li>
            <kbd className="rounded border border-border px-1.5 py-0.5 text-xs">Space</kbd> Pause /
            resume
          </li>
          <li>
            <kbd className="rounded border border-border px-1.5 py-0.5 text-xs">K</kbd> Clear console
          </li>
          <li>
            <kbd className="rounded border border-border px-1.5 py-0.5 text-xs">G</kbd>{' '}
            <kbd className="rounded border border-border px-1.5 py-0.5 text-xs">G</kbd> Jump to
            bottom
          </li>
          <li>
            <kbd className="rounded border border-border px-1.5 py-0.5 text-xs">Esc</kbd> Clear focus
          </li>
          <li>
            <kbd className="rounded border border-border px-1.5 py-0.5 text-xs">?</kbd> This help
          </li>
        </ul>
      </Modal>
    </div>
  )
}
