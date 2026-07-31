'use client'

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useHotkey } from '@/hooks/useHotkey'
import { CommandPalette } from '@/components/CommandPalette'
import { KeyboardShortcutsModal } from '@/components/KeyboardShortcutsModal'
import { FeedbackModal } from '@/components/FeedbackModal'
import { ChangelogDrawer } from '@/components/ChangelogDrawer'

export type FeedbackKind = 'feedback' | 'bug'

export interface DeveloperChromeContextValue {
  openCommandPalette: () => void
  closeCommandPalette: () => void
  commandPaletteOpen: boolean
  openShortcuts: () => void
  openFeedback: (opts?: { kind?: FeedbackKind; prefill?: string }) => void
  openChangelog: () => void
}

const DeveloperChromeContext = createContext<DeveloperChromeContextValue | null>(null)

export function useDeveloperChrome(): DeveloperChromeContextValue {
  const ctx = useContext(DeveloperChromeContext)
  if (!ctx) {
    throw new Error('useDeveloperChrome must be used within DeveloperChromeProvider')
  }
  return ctx
}

export function DeveloperChromeProvider({
  children,
  isDeveloper,
}: {
  children: React.ReactNode
  isDeveloper: boolean
}) {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>('feedback')
  const [feedbackPrefill, setFeedbackPrefill] = useState<string | undefined>()
  const [changelogOpen, setChangelogOpen] = useState(false)

  const openCommandPalette = useCallback(() => setCommandPaletteOpen(true), [])
  const closeCommandPalette = useCallback(() => setCommandPaletteOpen(false), [])
  const openShortcuts = useCallback(() => setShortcutsOpen(true), [])
  const openChangelog = useCallback(() => setChangelogOpen(true), [])
  const openFeedback = useCallback((opts?: { kind?: FeedbackKind; prefill?: string }) => {
    setFeedbackKind(opts?.kind ?? 'feedback')
    setFeedbackPrefill(opts?.prefill)
    setFeedbackOpen(true)
  }, [])

  useHotkey(
    [
      {
        type: 'combo',
        combo: { key: 'k', metaOrCtrl: true },
        handler: () => {
          if (isDeveloper) openCommandPalette()
        },
      },
      {
        type: 'combo',
        combo: { key: '?' },
        handler: () => openShortcuts(),
      },
      {
        type: 'sequence',
        keys: ['g', 'd'],
        handler: () => {
          window.location.href = '/dashboard'
        },
      },
      ...(isDeveloper
        ? [
            {
              type: 'sequence' as const,
              keys: ['g', 'c'],
              handler: () => {
                window.location.href = '/developer/companies'
              },
            },
            {
              type: 'sequence' as const,
              keys: ['g', 'l'],
              handler: () => {
                window.location.href = '/developer/logs'
              },
            },
          ]
        : []),
    ],
    true
  )

  const value = useMemo<DeveloperChromeContextValue>(
    () => ({
      openCommandPalette,
      closeCommandPalette,
      commandPaletteOpen,
      openShortcuts,
      openFeedback,
      openChangelog,
    }),
    [openCommandPalette, closeCommandPalette, commandPaletteOpen, openShortcuts, openFeedback, openChangelog]
  )

  return (
    <DeveloperChromeContext.Provider value={value}>
      {children}
      {isDeveloper && (
        <CommandPalette open={commandPaletteOpen} onClose={closeCommandPalette} />
      )}
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        kind={feedbackKind}
        initialMessage={feedbackPrefill}
      />
      <ChangelogDrawer open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </DeveloperChromeContext.Provider>
  )
}
