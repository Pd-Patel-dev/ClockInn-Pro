'use client'

import React from 'react'
import { Drawer } from '@/components/ui/Drawer'
import { Badge } from '@/components/ui/Badge'

const ENTRIES = [
  {
    version: '2026.07',
    title: 'Developer header refresh',
    body: 'New app header with command palette, profile menu, and keyboard shortcuts for platform developers.',
  },
  {
    version: '2026.06',
    title: 'Developer portal sidebar',
    body: 'Dedicated developer shell with companies, users, logs, and system health in one place.',
  },
  {
    version: '2026.05',
    title: 'Theme support',
    body: 'Light, dark, and system appearance across the app.',
  },
]

export interface ChangelogDrawerProps {
  open: boolean
  onClose: () => void
}

export function ChangelogDrawer({ open, onClose }: ChangelogDrawerProps) {
  return (
    <Drawer open={open} onClose={onClose} title="What's new" description="Recent ClockInn Pro updates">
      <ul className="flex flex-col gap-4 p-4">
        {ENTRIES.map((entry) => (
          <li key={entry.version} className="rounded-card border border-border bg-border-subtle/30 p-4">
            <div className="flex items-center gap-2">
              <Badge variant="info">{entry.version}</Badge>
              <h3 className="text-sm font-semibold text-foreground">{entry.title}</h3>
            </div>
            <p className="mt-2 text-sm text-foreground-muted">{entry.body}</p>
          </li>
        ))}
      </ul>
    </Drawer>
  )
}
