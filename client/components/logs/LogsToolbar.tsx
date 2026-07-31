'use client'

import {
  Copy,
  Download,
  HelpCircle,
  Pause,
  Play,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ConnectionStatus, LogLevel } from './useLogStream'
import { LogsSettings, type LogsDisplaySettings } from './LogsSettings'

const LEVEL_BUTTONS: { id: LogLevel | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'DEBUG', label: 'Debug' },
  { id: 'INFO', label: 'Info' },
  { id: 'WARNING', label: 'Warn' },
  { id: 'ERROR', label: 'Error' },
]

export function LogsToolbar({
  status,
  error,
  levels,
  onToggleLevel,
  onSelectAllLevels,
  query,
  onQueryChange,
  paused,
  onTogglePause,
  pendingCount,
  onClear,
  onDownload,
  onCopyAll,
  onReconnect,
  settingsOpen,
  onToggleSettings,
  settings,
  onSettingsChange,
  onOpenShortcuts,
}: {
  status: ConnectionStatus
  error: string | null
  levels: Set<LogLevel>
  onToggleLevel: (level: LogLevel) => void
  onSelectAllLevels: () => void
  query: string
  onQueryChange: (q: string) => void
  paused: boolean
  onTogglePause: () => void
  pendingCount: number
  onClear: () => void
  onDownload: () => void
  onCopyAll: () => void
  onReconnect: () => void
  settingsOpen: boolean
  onToggleSettings: () => void
  settings: LogsDisplaySettings
  onSettingsChange: (s: LogsDisplaySettings) => void
  onOpenShortcuts: () => void
}) {
  const statusLabel =
    status === 'live'
      ? 'Live'
      : status === 'paused'
        ? 'Paused'
        : status === 'connecting'
          ? 'Connecting'
          : 'Disconnected'

  const statusColor =
    status === 'live'
      ? 'bg-emerald-500'
      : status === 'paused'
        ? 'bg-slate-400'
        : status === 'connecting'
          ? 'bg-amber-400'
          : 'bg-red-500'

  return (
    <div className="sticky top-0 z-20 flex h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-foreground">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              statusColor,
              status === 'live' && 'animate-pulse'
            )}
          />
          {statusLabel}
        </span>
        {status === 'disconnected' && (
          <button
            type="button"
            onClick={onReconnect}
            className="text-xs font-medium text-accent hover:underline"
          >
            Reconnect
          </button>
        )}
        {error && status === 'disconnected' && (
          <span className="hidden text-xs text-foreground-muted sm:inline">{error}</span>
        )}
      </div>

      <div className="flex items-center rounded-control border border-border p-0.5">
        {LEVEL_BUTTONS.map((btn) => {
          const active =
            btn.id === 'ALL'
              ? levels.size >= 5
              : levels.has(btn.id as LogLevel)
          return (
            <button
              key={btn.id}
              type="button"
              onClick={() => {
                if (btn.id === 'ALL') onSelectAllLevels()
                else onToggleLevel(btn.id as LogLevel)
              }}
              className={cn(
                'rounded-[4px] px-2 py-1 text-xs font-medium transition-colors',
                active
                  ? 'bg-accent text-white'
                  : 'text-foreground-muted hover:text-foreground'
              )}
            >
              {btn.label}
            </button>
          )
        })}
      </div>

      <div className="relative min-w-[12rem] flex-1 max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
        <input
          id="logs-search"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Filter lines (substring match)"
          className="h-8 w-full rounded-control border border-border bg-surface pl-8 pr-3 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="ml-auto flex items-center gap-1">
        {pendingCount > 0 && (
          <span className="mr-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
            {pendingCount} new
          </span>
        )}
        <IconBtn
          label={paused ? 'Resume' : 'Pause'}
          onClick={onTogglePause}
        >
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </IconBtn>
        <IconBtn label="Clear" onClick={onClear}>
          <Trash2 className="h-4 w-4" />
        </IconBtn>
        <IconBtn label="Download" onClick={onDownload}>
          <Download className="h-4 w-4" />
        </IconBtn>
        <IconBtn label="Copy all" onClick={onCopyAll}>
          <Copy className="h-4 w-4" />
        </IconBtn>
        <div className="relative">
          <IconBtn label="Settings" onClick={onToggleSettings}>
            <Settings2 className="h-4 w-4" />
          </IconBtn>
          <LogsSettings
            open={settingsOpen}
            onClose={onToggleSettings}
            settings={settings}
            onChange={onSettingsChange}
          />
        </div>
        <IconBtn label="Keyboard shortcuts" onClick={onOpenShortcuts}>
          <HelpCircle className="h-4 w-4" />
        </IconBtn>
      </div>
    </div>
  )
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-control text-foreground-muted hover:bg-border-subtle hover:text-foreground"
    >
      {children}
    </button>
  )
}
