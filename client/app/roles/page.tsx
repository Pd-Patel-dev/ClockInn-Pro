'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy /roles → Company Settings tab */
export default function RolesRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/settings?tab=roles')
  }, [router])
  return null
}
