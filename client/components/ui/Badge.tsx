'use client'

import React from 'react'
import { cn } from '@/lib/cn'

const badgeVariants = {
  neutral: 'bg-border-subtle text-foreground-muted ring-border/80',
  success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-800 dark:text-amber-200 ring-amber-500/25',
  danger: 'bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/20',
  info: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-blue-500/20',
} as const

export type BadgeVariant = keyof typeof badgeVariants

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  dot?: boolean
}

export function Badge({
  variant = 'neutral',
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        badgeVariants[variant],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            variant === 'success' && 'bg-emerald-500',
            variant === 'warning' && 'bg-amber-500',
            variant === 'danger' && 'bg-red-500',
            variant === 'info' && 'bg-blue-500',
            variant === 'neutral' && 'bg-foreground-subtle'
          )}
          aria-hidden
        />
      )}
      {children}
    </span>
  )
}
