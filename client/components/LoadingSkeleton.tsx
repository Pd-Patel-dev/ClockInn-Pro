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
      className={`animate-pulse bg-gray-200 rounded ${className}`}
      style={style}
    />
  )
})

Skeleton.displayName = 'Skeleton'

export const TableRowSkeleton = React.memo(({ columns = 5 }: { columns?: number }) => {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, idx) => (
        <td key={idx} className="px-6 py-4 whitespace-nowrap">
          <Skeleton height="h-4" width="w-24" />
        </td>
      ))}
    </tr>
  )
})

TableRowSkeleton.displayName = 'TableRowSkeleton'

export const TableSkeleton = React.memo(({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) => {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {Array.from({ length: columns }).map((_, idx) => (
                <th key={idx} className="px-6 py-3 text-left">
                  <Skeleton height="h-4" width="w-20" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
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
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <Skeleton height="h-6" width="w-32" className="mb-4" />
      <Skeleton height="h-4" width="w-full" className="mb-2" />
      <Skeleton height="h-4" width="w-3/4" />
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
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <Skeleton height="h-4" width="w-24" className="mb-2" />
      <Skeleton height="h-8" width="w-16" />
    </div>
  )
})

StatsCardSkeleton.displayName = 'StatsCardSkeleton'

