'use client'

import React from 'react'
import { cn } from '@/lib/cn'

const sizeMap = {
  xs: 'h-6 w-6 text-2xs',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
} as const

export type AvatarSize = keyof typeof sizeMap

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name?: string
  src?: string | null
  size?: AvatarSize
  square?: boolean
}

export function Avatar({ name = '', src, size = 'md', square, className, ...props }: AvatarProps) {
  const initials = initialsFromName(name)

  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden bg-accent/15 font-semibold text-accent',
        square ? 'rounded-control' : 'rounded-full',
        sizeMap[size],
        className
      )}
      title={name || undefined}
      {...props}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name ? `${name} avatar` : 'Avatar'} className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden>{initials}</span>
      )}
    </div>
  )
}
