'use client'

import React from 'react'
import { cn } from '@/lib/cn'
import { inputClasses } from './variants'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ error, className, ...props }, ref) => (
    <input ref={ref} className={inputClasses(error, className)} {...props} />
  )
)
Input.displayName = 'Input'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error, className, ...props }, ref) => (
    <textarea ref={ref} className={cn(inputClasses(error), 'min-h-[5rem]', className)} {...props} />
  )
)
Textarea.displayName = 'Textarea'

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ error, className, children, ...props }, ref) => (
    <select ref={ref} className={inputClasses(error, className)} {...props}>
      {children}
    </select>
  )
)
Select.displayName = 'Select'
