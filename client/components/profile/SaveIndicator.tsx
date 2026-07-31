'use client'

import type { SaveState } from './useAutosaveField'

export function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null
  const text =
    state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Save failed' : ''
  return (
    <span
      className={state === 'error' ? 'text-xs text-danger' : 'text-xs text-foreground-subtle'}
      aria-live="polite"
    >
      {text}
    </span>
  )
}
