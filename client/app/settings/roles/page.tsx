'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy /settings/roles → Company Settings tab */
export default function SettingsRolesRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/settings?tab=roles')
  }, [router])
  return null
}
