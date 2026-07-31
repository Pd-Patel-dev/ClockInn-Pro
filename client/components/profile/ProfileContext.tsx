'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import type { User } from '@/lib/auth'
import { apiErrorMessage } from './profileUtils'

interface ProfileContextValue {
  user: User | null
  loading: boolean
  error: string | null
  refresh: () => Promise<User | null>
  patchUser: (partial: Partial<User>) => void
}

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined)

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<User | null> => {
    try {
      const res = await api.get<User>('/me')
      setUser(res.data)
      setError(null)
      return res.data
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load profile'))
      return null
    }
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      await refresh()
      if (mounted) setLoading(false)
    })()
    return () => {
      mounted = false
    }
  }, [refresh])

  const patchUser = useCallback((partial: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...partial } : prev))
  }, [])

  const value = useMemo(
    () => ({ user, loading, error, refresh, patchUser }),
    [user, loading, error, refresh, patchUser]
  )

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) {
    throw new Error('useProfile must be used within ProfileProvider')
  }
  return ctx
}
