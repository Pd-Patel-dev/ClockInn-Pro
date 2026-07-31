'use client'

import React from 'react'
import { cn } from '@/lib/cn'

export interface FormFieldProps {
  label: string
  htmlFor?: string
  error?: string
  required?: boolean
  hint?: string
  className?: string
  children: React.ReactNode
}

export function FormField({
  label,
  htmlFor,
  error,
  required,
  hint,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-1 text-danger" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-foreground-subtle">{hint}</p>}
      {error && (
        <p className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
