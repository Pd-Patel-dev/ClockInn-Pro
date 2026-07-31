'use client'

import { Modal, Button } from '@/components/ui'

const SHORTCUTS = [
  { keys: '⌘/Ctrl + S', desc: 'Save draft' },
  { keys: '⌘/Ctrl + Shift + P', desc: 'Publish (with confirmation)' },
  { keys: '?', desc: 'Show this cheatsheet' },
  { keys: '⌘/Ctrl + F', desc: 'Find in editor' },
  { keys: '⌘/Ctrl + Space', desc: 'Variable autocomplete' },
]

interface ShortcutCheatsheetModalProps {
  open: boolean
  onClose: () => void
}

export function ShortcutCheatsheetModal({ open, onClose }: ShortcutCheatsheetModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      size="sm"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <ul className="space-y-2">
        {SHORTCUTS.map((s) => (
          <li key={s.keys} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-foreground-muted">{s.desc}</span>
            <kbd className="rounded-control border border-border bg-border-subtle px-2 py-0.5 font-mono text-xs text-foreground">
              {s.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
