'use client'

export function DeveloperAuthLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div
        className="h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent"
        aria-label="Loading"
      />
    </div>
  )
}
