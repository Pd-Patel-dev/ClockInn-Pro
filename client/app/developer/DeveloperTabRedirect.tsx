'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

const TAB_ROUTES: Record<string, string> = {
  overview: '/developer',
  companies: '/developer/companies',
  developers: '/developer/developers',
  users: '/developer/users',
  system: '/developer/system',
  stats: '/developer/system',
}

export default function DeveloperTabRedirect() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    if (pathname !== '/developer' && pathname !== '/developer/') return
    const tab = searchParams.get('tab')
    if (!tab) return
    const target = TAB_ROUTES[tab.toLowerCase()]
    if (target && target !== '/developer') {
      router.replace(target)
    }
  }, [pathname, searchParams, router])

  return null
}
