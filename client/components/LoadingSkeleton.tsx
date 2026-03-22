'use client'

import React from 'react'

interface SkeletonProps {
  className?: string
  width?: string
  height?: string
}

export const Skeleton = React.memo(({ className = '', width, height }: SkeletonProps) => {
  const style: React.CSSProperties = {}
  if (width) style.width = width
  if (height) style.height = height

  return (
    <div
      className={`animate-pulse bg-slate-200 rounded-lg ${className}`}
      style={style}
    />
  )
})

Skeleton.displayName = 'Skeleton'

export const TableRowSkeleton = React.memo(({ columns = 5 }: { columns?: number }) => {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      {Array.from({ length: columns }).map((_, idx) => (
        <td key={idx} className="px-4 py-3 whitespace-nowrap">
          <Skeleton className="h-4 w-24" />
        </td>
      ))}
    </tr>
  )
})

TableRowSkeleton.displayName = 'TableRowSkeleton'

export const TableSkeleton = React.memo(({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {Array.from({ length: columns }).map((_, idx) => (
                <th key={idx} className="px-4 py-3 text-left">
                  <Skeleton className="h-4 w-20" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, idx) => (
              <TableRowSkeleton key={idx} columns={columns} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
})

TableSkeleton.displayName = 'TableSkeleton'

export const CardSkeleton = React.memo(() => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <Skeleton className="h-6 w-32 mb-4" />
      <Skeleton className="h-4 w-full mb-2" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  )
})

CardSkeleton.displayName = 'CardSkeleton'

export const ListSkeleton = React.memo(({ items = 3 }: { items?: number }) => {
  return (
    <div className="space-y-4">
      {Array.from({ length: items }).map((_, idx) => (
        <CardSkeleton key={idx} />
      ))}
    </div>
  )
})

ListSkeleton.displayName = 'ListSkeleton'

export const StatsCardSkeleton = React.memo(() => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <Skeleton className="h-4 w-24 mb-2" />
      <Skeleton className="h-8 w-16" />
    </div>
  )
})

StatsCardSkeleton.displayName = 'StatsCardSkeleton'
