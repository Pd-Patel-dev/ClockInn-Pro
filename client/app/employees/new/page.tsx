'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy /employees/new → /employees/create (avoids clash with /employees/[id]) */
export default function NewEmployeeRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/employees/create')
  }, [router])
  return null
}
