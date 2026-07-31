'use client'

import React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/cn'

export interface BreadcrumbItem {
  label: string
  href?: string
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[]
  className?: string
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  if (items.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1.5 text-sm', className)}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <React.Fragment key={`${item.label}-${index}`}>
            {index > 0 && (
              <span className="text-foreground-subtle select-none" aria-hidden>
                ›
              </span>
            )}
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="text-foreground-muted hover:text-foreground transition-colors duration-ui truncate max-w-[12rem]"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={cn(
                  'truncate max-w-[14rem]',
                  isLast ? 'font-medium text-foreground' : 'text-foreground-muted'
                )}
                aria-current={isLast ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
          </React.Fragment>
        )
      })}
    </nav>
  )
}
