'use client'

import React from 'react'
import { cn } from '@/lib/cn'
import { focusRing, transitionUi } from './variants'

export interface TabItem {
  id: string
  label: React.ReactNode
  disabled?: boolean
}

export interface TabsProps {
  tabs: TabItem[]
  value: string
  onChange: (id: string) => void
  className?: string
  /** Visual style: underline (default) or pills */
  variant?: 'underline' | 'pills'
}

export function Tabs({ tabs, value, onChange, className, variant = 'underline' }: TabsProps) {
  if (variant === 'pills') {
    return (
      <div
        role="tablist"
        className={cn('inline-flex gap-1 rounded-control bg-border-subtle/60 p-1', className)}
      >
        {tabs.map((tab) => {
          const selected = tab.id === value
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              disabled={tab.disabled}
              onClick={() => onChange(tab.id)}
              className={cn(
                'rounded-control px-3 py-1.5 text-sm font-medium',
                focusRing,
                transitionUi,
                selected
                  ? 'bg-surface text-foreground shadow-subtle'
                  : 'text-foreground-muted hover:text-foreground',
                tab.disabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div role="tablist" className={cn('flex gap-6 border-b border-border', className)}>
      {tabs.map((tab) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px border-b-2 px-1 pb-3 text-sm font-medium',
              focusRing,
              transitionUi,
              selected
                ? 'border-accent text-accent'
                : 'border-transparent text-foreground-muted hover:border-border hover:text-foreground',
              tab.disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

export interface TabPanelsProps {
  value: string
  children: React.ReactNode
}

export function TabPanel({
  id,
  value,
  children,
  className,
}: {
  id: string
  value: string
  children: React.ReactNode
  className?: string
}) {
  if (id !== value) return null
  return (
    <div role="tabpanel" className={cn('pt-6', className)}>
      {children}
    </div>
  )
}

export function TabPanels({ value, children }: TabPanelsProps) {
  return <div>{children}</div>
}
