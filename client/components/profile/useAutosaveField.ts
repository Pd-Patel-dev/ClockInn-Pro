'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import api from '@/lib/api'
import type { User } from '@/lib/auth'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function useAutosaveField<K extends keyof User>(
  field: K,
  initial: User[K] | undefined,
  onSaved: (user: User) => void
) {
  const [value, setValue] = useState<string>(() => (initial ?? '') as string)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const initialRef = useRef(initial)

  useEffect(() => {
    initialRef.current = initial
    setValue((initial ?? '') as string)
  }, [initial])

  const save = useCallback(async () => {
    const trimmed = value.trim()
    const baseline = ((initialRef.current ?? '') as string).trim()
    if (trimmed === baseline) {
      setSaveState('idle')
      return
    }
    setSaveState('saving')
    try {
      const payload = { [field]: trimmed || null } as Partial<User>
      const res = await api.patch<User>('/me', payload)
      initialRef.current = res.data[field]
      onSaved(res.data)
      setSaveState('saved')
      window.setTimeout(() => setSaveState('idle'), 2000)
    } catch (e) {
      setSaveState('error')
      throw e
    }
  }, [field, value, onSaved])

  return { value, setValue, save, saveState, setSaveState }
}
