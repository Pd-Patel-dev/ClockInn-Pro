'use client'

import React from 'react'
import { cn } from '@/lib/cn'

export interface TableColumn<T> {
  key: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  sortable?: boolean
  className?: string
  headerClassName?: string
}

export interface TableProps<T> {
  columns: TableColumn<T>[]
  data: T[]
  getRowKey: (row: T) => string
  sortKey?: string
  sortDirection?: 'asc' | 'desc'
  onSort?: (key: string) => void
  stickyHeader?: boolean
  emptyState?: React.ReactNode
  onRowClick?: (row: T) => void
  className?: string
}

export function Table<T>({
  columns,
  data,
  getRowKey,
  sortKey,
  sortDirection,
  onSort,
  stickyHeader = true,
  emptyState,
  onRowClick,
  className,
}: TableProps<T>) {
  return (
    <div className={cn('surface-card overflow-hidden', className)}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-full text-sm">
          <thead
            className={cn(
              'border-b border-border bg-border-subtle/50',
              stickyHeader && 'sticky top-0 z-10'
            )}
          >
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted',
                    col.headerClassName
                  )}
                >
                  {col.sortable && onSort ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => onSort(col.key)}
                    >
                      {col.header}
                      {sortKey === col.key && (
                        <span aria-hidden>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  {emptyState ?? (
                    <p className="text-sm text-foreground-muted">No data to display</p>
                  )}
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr
                  key={getRowKey(row)}
                  className={cn(
                    'bg-surface transition-colors duration-ui hover:bg-border-subtle/40',
                    onRowClick && 'cursor-pointer'
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn('px-4 py-3 align-middle text-foreground', col.className)}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
