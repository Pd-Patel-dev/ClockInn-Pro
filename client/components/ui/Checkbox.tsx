'use client'

import React, { useId } from 'react'
import { cn } from '@/lib/cn'
import { focusRing, transitionUi } from './variants'

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode
  description?: string
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, description, id: idProp, disabled, ...props }, ref) => {
    const autoId = useId()
    const id = idProp ?? autoId

    return (
      <div className={cn('flex items-start gap-3', className)}>
        <input
          ref={ref}
          id={id}
          type="checkbox"
          disabled={disabled}
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0 rounded border-border text-accent',
            focusRing,
            transitionUi,
            disabled && 'opacity-60 cursor-not-allowed'
          )}
          {...props}
        />
        {(label || description) && (
          <div className="min-w-0">
            {label && (
              <label
                htmlFor={id}
                className={cn(
                  'text-sm font-medium text-foreground',
                  disabled && 'opacity-60'
                )}
              >
                {label}
              </label>
            )}
            {description && (
              <p className="text-xs text-foreground-muted mt-0.5">{description}</p>
            )}
          </div>
        )}
      </div>
    )
  }
)
Checkbox.displayName = 'Checkbox'

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, id: idProp, disabled, checked, defaultChecked, ...props }, ref) => {
    const autoId = useId()
    const id = idProp ?? autoId

    return (
      <label
        htmlFor={id}
        className={cn(
          'inline-flex cursor-pointer items-center gap-3',
          disabled && 'cursor-not-allowed opacity-60',
          className
        )}
      >
        <span className="relative inline-flex h-5 w-9 shrink-0">
          <input
            ref={ref}
            id={id}
            type="checkbox"
            role="switch"
            disabled={disabled}
            checked={checked}
            defaultChecked={defaultChecked}
            className="peer sr-only"
            {...props}
          />
          <span
            className={cn(
              'absolute inset-0 rounded-full bg-border transition-colors duration-ui',
              'peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-page'
            )}
            aria-hidden
          />
          <span
            className={cn(
              'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-ui',
              'peer-checked:translate-x-4'
            )}
            aria-hidden
          />
        </span>
        {label && <span className="text-sm text-foreground">{label}</span>}
      </label>
    )
  }
)
Switch.displayName = 'Switch'
