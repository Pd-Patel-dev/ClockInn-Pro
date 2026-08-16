'use client'

import React from 'react'
import { cn } from '@/lib/cn'
import { InfoTip } from '@/components/ui/InfoTip'

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
      <div className="mb-1.5 flex items-center gap-1">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
          {label}
          {required && (
            <span className="ml-1 text-danger" aria-hidden>
              *
            </span>
          )}
        </label>
        {hint && !error && <InfoTip content={hint} label={`About ${label}`} />}
      </div>
      {children}
      {error && (
        <p className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
