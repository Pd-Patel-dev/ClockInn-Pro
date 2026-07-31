'use client'

import React from 'react'
import { cn } from '@/lib/cn'

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: string | number
  height?: string | number
}

export function Skeleton({ className, width, height, style, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-control bg-border motion-reduce:animate-none',
        className
      )}
      style={{
        width,
        height,
        ...style,
      }}
      aria-hidden
      {...props}
    />
  )
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-3', i === lines - 1 ? 'w-4/5' : 'w-full')}
        />
      ))}
    </div>
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('surface-card p-6 space-y-4', className)}>
      <Skeleton className="h-5 w-1/3" />
      <SkeletonText lines={2} />
    </div>
  )
}
