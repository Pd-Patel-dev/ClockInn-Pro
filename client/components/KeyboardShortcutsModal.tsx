'use client'

import React from 'react'
import { Modal } from '@/components/ui/Modal'

const SHORTCUTS = [
  { keys: '⌘ K / Ctrl K', description: 'Open command palette (developers)' },
  { keys: '?', description: 'Show keyboard shortcuts' },
  { keys: 'G then D', description: 'Go to dashboard' },
  { keys: 'G then C', description: 'Go to companies (developers)' },
  { keys: 'G then L', description: 'Go to activity logs (developers)' },
  { keys: '↑ / ↓', description: 'Navigate command palette results' },
  { keys: 'Enter', description: 'Select command palette item' },
  { keys: 'Esc', description: 'Close dialogs and menus' },
]

export interface KeyboardShortcutsModalProps {
  open: boolean
  onClose: () => void
}

export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="md">
      <ul className="divide-y divide-border rounded-control border border-border">
        {SHORTCUTS.map((item) => (
          <li key={item.keys} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="text-foreground-muted">{item.description}</span>
            <kbd className="shrink-0 rounded-control border border-border bg-border-subtle/60 px-2 py-0.5 text-xs font-medium text-foreground tabular-nums">
              {item.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
