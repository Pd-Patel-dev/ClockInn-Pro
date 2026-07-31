'use client'

import { useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { LogLine } from './useLogStream'
import type { LogsDisplaySettings } from './LogsSettings'

const LEVEL_CLASS: Record<string, string> = {
  DEBUG: 'text-slate-500',
  INFO: 'text-sky-400',
  WARNING: 'text-amber-400',
  ERROR: 'text-red-400',
  CRITICAL: 'text-red-300 bg-red-500/15 px-0.5 rounded',
}

function formatTs(iso: string, mode: LogsDisplaySettings['timestampFormat']): string {
  try {
    const d = new Date(iso)
    if (mode === 'relative') {
      const sec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000))
      if (sec < 60) return `${sec}s ago`
      if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
      return `${Math.floor(sec / 3600)}h ago`
    }
    const pad = (n: number, w = 2) => String(n).padStart(w, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  } catch {
    return iso
  }
}

function highlightMessage(message: string) {
  const parts = message.split(/(\b[\w.-]+=\S+)/g)
  return parts.map((part, i) => {
    const m = /^([\w.-]+)=(\S+)$/.exec(part)
    if (!m) return <span key={i}>{part}</span>
    return (
      <span key={i}>
        <span className="text-slate-500">{m[1]}=</span>
        <span className="text-slate-200">{m[2]}</span>
      </span>
    )
  })
}

function parseKv(message: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = []
  const re = /\b([\w.-]+)=(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(message))) {
    out.push({ key: m[1], value: m[2] })
  }
  return out
}

export function LogLineRow({
  line,
  settings,
  focused,
  onFocus,
  onFilterLogger,
  onHideLogger,
}: {
  line: LogLine
  settings: LogsDisplaySettings
  focused: boolean
  onFocus: () => void
  onFilterLogger: (logger: string) => void
  onHideLogger: (logger: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const kv = useMemo(() => parseKv(line.message), [line.message])
  const wrap = settings.wrap

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className={cn(
        'group relative border-b border-white/5 hover:bg-white/[0.04]',
        focused && 'bg-white/[0.06]',
        expanded && 'bg-white/[0.05]'
      )}
      onClick={() => {
        onFocus()
        setExpanded((v) => !v)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onFocus()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      role="row"
      tabIndex={-1}
    >
      <div
        className={cn(
          'flex items-center gap-3 px-3 font-mono text-[length:inherit] leading-5',
          wrap ? 'min-h-6 py-0.5 items-start' : 'h-6 overflow-hidden'
        )}
      >
        {settings.showTimestamps && (
          <span className="w-[96px] shrink-0 text-slate-500 tabular-nums">
            {formatTs(line.timestamp, settings.timestampFormat)}
          </span>
        )}
        <span
          className={cn(
            'w-14 shrink-0 font-semibold uppercase tracking-wide',
            LEVEL_CLASS[line.level] || 'text-slate-400'
          )}
        >
          {line.level.slice(0, 5)}
        </span>
        {settings.showLogger && (
          <span className="w-32 shrink-0 truncate text-slate-500" title={line.logger}>
            {line.logger}
          </span>
        )}
        <span
          className={cn(
            'min-w-0 flex-1 text-slate-200',
            wrap ? 'whitespace-pre-wrap break-words' : 'truncate whitespace-nowrap'
          )}
          title={wrap ? undefined : line.raw}
        >
          {highlightMessage(line.message)}
        </span>
        <button
          type="button"
          className="absolute right-2 top-0.5 hidden shrink-0 rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-200 group-hover:block"
          aria-label="Copy line"
          onClick={(e) => {
            e.stopPropagation()
            void copy(line.raw)
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>

      {expanded && (
        <div
          className="mb-1 mt-0 border-t border-white/5 px-3 py-2 text-xs text-slate-300"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="rounded border border-white/10 bg-black/30 px-3 py-2">
            <dl className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
              <dt className="text-slate-500">Timestamp</dt>
              <dd className="min-w-0 break-all font-mono">{line.timestamp}</dd>
              <dt className="text-slate-500">Level</dt>
              <dd>{line.level}</dd>
              <dt className="text-slate-500">Logger</dt>
              <dd className="min-w-0 break-all font-mono">{line.logger}</dd>
              <dt className="text-slate-500">Message</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words font-mono">{line.message}</dd>
              {kv.map((pair) => (
                <div key={pair.key} className="contents">
                  <dt className="text-slate-500">{pair.key}</dt>
                  <dd className="min-w-0 break-all font-mono">{pair.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {menu && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close menu"
            onClick={(e) => {
              e.stopPropagation()
              setMenu(null)
            }}
          />
          <div
            className="fixed z-50 min-w-[160px] rounded-md border border-slate-700 bg-slate-900 py-1 text-xs shadow-lifted"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
          >
            {[
              { label: 'Copy line', action: () => void copy(line.raw) },
              {
                label: 'Copy as JSON',
                action: () => void copy(JSON.stringify(line, null, 2)),
              },
              { label: 'Filter by this logger', action: () => onFilterLogger(line.logger) },
              { label: 'Hide this logger', action: () => onHideLogger(line.logger) },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="block w-full px-3 py-1.5 text-left text-slate-200 hover:bg-slate-800"
                onClick={(e) => {
                  e.stopPropagation()
                  item.action()
                  setMenu(null)
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
