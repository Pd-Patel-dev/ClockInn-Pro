'use client'

import React, { useEffect, useId, useRef } from 'react'
import { cn } from '@/lib/cn'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  side?: 'right' | 'left'
  widthClass?: string
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  side = 'right',
  widthClass = 'w-full max-w-md',
}: DrawerProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        aria-label="Close drawer"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'relative ml-auto flex h-full flex-col border-border bg-surface shadow-lifted outline-none',
          'motion-safe:transition-transform motion-safe:duration-panel motion-safe:ease-out',
          widthClass,
          side === 'right' ? 'border-l' : 'mr-auto border-r'
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-sm text-foreground-muted">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-control p-1 text-foreground-subtle hover:bg-border-subtle"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
