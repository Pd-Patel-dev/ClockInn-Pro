'use client'

import React from 'react'
import { cn } from '@/lib/cn'
import { useTheme } from '@/lib/theme/ThemeProvider'
import type { ThemeMode } from '@/lib/theme/tokens'
import { focusRing, transitionUi } from './variants'

export interface ThemeToggleProps {
  className?: string
}

const options: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme()

  return (
    <div
      role="group"
      aria-label="Theme"
      className={cn(
        'inline-flex rounded-control border border-border bg-border-subtle/50 p-0.5',
        className
      )}
    >
      {options.map((opt) => {
        const selected = theme === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            onClick={() => setTheme(opt.value)}
            className={cn(
              'rounded-[0.3rem] px-2.5 py-1 text-xs font-medium',
              focusRing,
              transitionUi,
              selected
                ? 'bg-surface text-foreground shadow-subtle'
                : 'text-foreground-muted hover:text-foreground'
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
