'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

interface BackButtonProps {
  /** Button label. Default: "Back" (rendered as "← Back"). */
  children?: ReactNode
  className?: string
  /** Optional fallback when there is no history (e.g. opened in new tab). If not set, router.back() is always used. */
  fallbackHref?: string
  /**
   * When true (default), string labels get a single leading "← " if they don’t already start with ←.
   * When false, children render exactly as provided (e.g. "Cancel" without an arrow).
   */
  showArrow?: boolean
}

const defaultClassName =
  'inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400/30 rounded-lg transition-colors'

/** Single typographic arrow — no separate chevron icon (avoids "<" + "← Back" stacking). */
function withLeadingArrow(label: ReactNode): ReactNode {
  if (typeof label !== 'string') return label
  const trimmed = label.trimStart()
  if (trimmed.startsWith('←') || trimmed.startsWith('\u2190')) return label
  return `← ${trimmed}`
}

/**
 * Back button that navigates to the previous page in history.
 * Use on detail/edit pages where the user expects to return to where they came from.
 */
export default function BackButton({
  children = 'Back',
  className = defaultClassName,
  fallbackHref,
  showArrow = true,
}: BackButtonProps) {
  const router = useRouter()

  const handleClick = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else if (fallbackHref) {
      router.push(fallbackHref)
    } else {
      router.back()
    }
  }

  const content = showArrow ? withLeadingArrow(children) : children
  const aria =
    typeof children === 'string' ? children : typeof content === 'string' ? content : 'Go back'

  return (
    <button type="button" onClick={handleClick} className={className} aria-label={aria}>
      {content}
    </button>
  )
}
