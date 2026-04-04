'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Old path — shift log lives at `/shift-notes`. */
export default function ShiftNotepadRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/shift-notes')
  }, [router])
  return (
    <div className="min-h-[40vh] flex items-center justify-center text-sm text-gray-500">
      Redirecting…
    </div>
  )
}
