import Link from 'next/link'

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
        <span className="text-2xl">🔒</span>
      </div>
      <h1 className="mb-2 text-xl font-semibold text-gray-900">Access restricted</h1>
      <p className="mb-6 max-w-xs text-sm text-gray-500">
        You don&apos;t have permission to view this page. Contact your manager if you think this is a mistake.
      </p>
      <Link href="/punch-in-out" className="text-sm font-medium text-gray-900 underline underline-offset-2">
        Go to clock in
      </Link>
    </div>
  )
}

