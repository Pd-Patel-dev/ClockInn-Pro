'use client'

import React, { useId, useState } from 'react'
import { cn } from '@/lib/cn'

export interface TooltipProps {
  content: React.ReactNode
  children: React.ReactElement
  side?: 'top' | 'bottom'
  className?: string
}

export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const tipId = useId()

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {React.cloneElement(children, {
        'aria-describedby': visible ? tipId : undefined,
      })}
      {visible && (
        <span
          id={tipId}
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-50 max-w-xs rounded-control bg-slate-900 px-2 py-1 text-xs text-white shadow-lifted',
            'dark:bg-slate-100 dark:text-slate-900',
            side === 'top' ? 'bottom-full left-1/2 mb-2 -translate-x-1/2' : 'top-full left-1/2 mt-2 -translate-x-1/2',
            className
          )}
        >
          {content}
        </span>
      )}
    </span>
  )
}
