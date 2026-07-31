'use client'

import React from 'react'
import { cn } from '@/lib/cn'
import { disabledStyles, focusRing, transitionUi } from './variants'

const variantStyles = {
  primary:
    'bg-accent text-white hover:bg-accent-hover active:scale-[0.98] shadow-sm',
  secondary:
    'border border-border bg-surface text-foreground hover:bg-border-subtle/80 active:scale-[0.98]',
  ghost: 'text-foreground-muted hover:bg-border-subtle/60 hover:text-foreground',
  danger: 'bg-danger text-white hover:bg-red-600 active:scale-[0.98] shadow-sm',
} as const

const sizeStyles = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-control',
  md: 'h-9 px-4 text-sm gap-2 rounded-control',
  lg: 'h-11 px-5 text-sm gap-2 rounded-control',
} as const

export type ButtonVariant = keyof typeof variantStyles
export type ButtonSize = keyof typeof sizeStyles

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled,
      leftIcon,
      rightIcon,
      children,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        className={cn(
          'inline-flex items-center justify-center font-medium',
          focusRing,
          transitionUi,
          disabledStyles,
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {loading ? (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
        ) : (
          leftIcon
        )}
        {children}
        {!loading && rightIcon}
      </button>
    )
  }
)
Button.displayName = 'Button'
