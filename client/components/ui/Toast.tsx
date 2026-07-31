'use client'

import React from 'react'
import { cn } from '@/lib/cn'

export type ToastVisualVariant = 'success' | 'error' | 'info' | 'warning'

const variantStyles: Record<ToastVisualVariant, string> = {
  success: 'border-l-success',
  error: 'border-l-danger',
  warning: 'border-l-warning',
  info: 'border-l-accent',
}

export interface ToastNotificationProps {
  message: string
  variant?: ToastVisualVariant
  onDismiss?: () => void
  className?: string
}

export function ToastNotification({
  message,
  variant = 'info',
  onDismiss,
  className,
}: ToastNotificationProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 rounded-card border border-border bg-surface p-3.5 shadow-lifted',
        'border-l-4',
        variantStyles[variant],
        className
      )}
    >
      <p className="flex-1 text-sm font-medium leading-snug text-foreground">{message}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-control p-0.5 text-foreground-subtle hover:text-foreground"
          aria-label="Dismiss notification"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
