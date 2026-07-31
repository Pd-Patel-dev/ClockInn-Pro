import { cn } from '@/lib/cn'

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page'

export const disabledStyles = 'disabled:opacity-60 disabled:pointer-events-none disabled:cursor-not-allowed'

export const transitionUi = 'transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-ui ease-out motion-reduce:transition-none'

export function inputClasses(error?: boolean, className?: string) {
  return cn(
    'block w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-foreground',
    'placeholder:text-foreground-subtle',
    focusRing,
    transitionUi,
    error && 'border-red-400 focus-visible:ring-red-500 dark:border-red-500/60',
    disabledStyles,
    className
  )
}
