'use client'

import { useRouter } from 'next/navigation'

interface BackButtonProps {
  /** Button label. Default: "Back" */
  children?: React.ReactNode
  className?: string
  /** Optional fallback when there is no history (e.g. opened in new tab). If not set, router.back() is always used. */
  fallbackHref?: string
  /** If true, show a left-arrow icon before the label. Default: true */
  showArrow?: boolean
}

const defaultClassName = 'inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400/30 rounded-lg transition-colors'

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

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className}
      aria-label={typeof children === 'string' ? children : 'Go back'}
    >
      {showArrow && (
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      )}
      {children}
    </button>
  )
}
