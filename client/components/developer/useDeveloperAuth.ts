'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentUser, User } from '@/lib/auth'
import logger from '@/lib/logger'

export function useDeveloperAuth() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const currentUser = await getCurrentUser()
        if (cancelled) return
        setUser(currentUser)
        if (currentUser.role !== 'DEVELOPER') {
          router.push('/dashboard')
          return
        }
      } catch (err) {
        logger.error('Authentication error', err as Error, { action: 'developer_portal' })
        if (!cancelled) router.push('/login')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  return { user, loading }
}

export { DeveloperAuthLoading } from './DeveloperAuthLoading'
