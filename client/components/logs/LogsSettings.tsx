'use client'

import { cn } from '@/lib/cn'

export type LogsDisplaySettings = {
  wrap: boolean
  showTimestamps: boolean
  showLogger: boolean
  timestampFormat: 'clock' | 'relative'
  fontSize: 'S' | 'M' | 'L'
  autoScroll: boolean
}

export const DEFAULT_LOG_SETTINGS: LogsDisplaySettings = {
  wrap: false,
  showTimestamps: true,
  showLogger: true,
  timestampFormat: 'clock',
  fontSize: 'M',
  autoScroll: true,
}

export function LogsSettings({
  open,
  onClose,
  settings,
  onChange,
}: {
  open: boolean
  onClose: () => void
  settings: LogsDisplaySettings
  onChange: (next: LogsDisplaySettings) => void
}) {
  if (!open) return null

  const toggle = (key: keyof LogsDisplaySettings, value?: LogsDisplaySettings[keyof LogsDisplaySettings]) => {
    if (typeof settings[key] === 'boolean' && value === undefined) {
      onChange({ ...settings, [key]: !settings[key] })
      return
    }
    if (value !== undefined) onChange({ ...settings, [key]: value })
  }

  return (
    <>
      <button type="button" className="fixed inset-0 z-40" aria-label="Close settings" onClick={onClose} />
      <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-border bg-surface p-3 shadow-lifted">
        <p className="mb-2 text-xs font-semibold text-foreground">Settings</p>
        <div className="space-y-2 text-sm">
          {(
            [
              ['wrap', 'Wrap long lines'],
              ['showTimestamps', 'Show timestamps'],
              ['showLogger', 'Show logger name'],
              ['autoScroll', 'Auto-scroll'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-2">
              <span className="text-foreground-muted">{label}</span>
              <input
                type="checkbox"
                checked={Boolean(settings[key])}
                onChange={() => toggle(key)}
                className="rounded border-border"
              />
            </label>
          ))}
          <div>
            <p className="mb-1 text-foreground-muted">Timestamp</p>
            <div className="flex gap-1">
              {(['clock', 'relative'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => toggle('timestampFormat', mode)}
                  className={cn(
                    'rounded-control px-2 py-1 text-xs',
                    settings.timestampFormat === mode
                      ? 'bg-accent text-white'
                      : 'bg-border-subtle text-foreground-muted'
                  )}
                >
                  {mode === 'clock' ? 'HH:mm:ss' : 'Relative'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-foreground-muted">Font size</p>
            <div className="flex gap-1">
              {(['S', 'M', 'L'] as const).map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => toggle('fontSize', size)}
                  className={cn(
                    'rounded-control px-2 py-1 text-xs',
                    settings.fontSize === size
                      ? 'bg-accent text-white'
                      : 'bg-border-subtle text-foreground-muted'
                  )}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
