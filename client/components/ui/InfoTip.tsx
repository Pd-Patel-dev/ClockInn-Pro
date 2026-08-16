'use client'

import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'

export interface InfoTipProps {
  /** Extra info shown on hover / focus */
  content: React.ReactNode
  /** Accessible name for the info button */
  label?: string
  side?: 'top' | 'bottom'
  className?: string
  buttonClassName?: string
}

/** Compact “i” control — prefer this over always-visible explanation text. */
export function InfoTip({
  content,
  label = 'More info',
  side = 'top',
  className,
  buttonClassName,
}: InfoTipProps) {
  return (
    <Tooltip content={content} side={side} variant="surface" className={className}>
      <button
        type="button"
        className={cn(
          'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-[9px] font-semibold leading-none text-slate-500 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
          buttonClassName
        )}
        aria-label={label}
      >
        i
      </button>
    </Tooltip>
  )
}
