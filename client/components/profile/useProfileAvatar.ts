'use client'

import { useEffect, useState } from 'react'
import api, { getAccessToken } from '@/lib/api'
import { isRawAvatarUrl } from './profileUtils'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export function useProfileAvatarBlob(avatarUrl: string | null | undefined): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!avatarUrl || !isRawAvatarUrl(avatarUrl)) {
      setBlobUrl(null)
      return
    }

    let revoked: string | null = null
    let cancelled = false

    const load = async () => {
      const token = getAccessToken()
      if (!token) return
      const path = avatarUrl.startsWith('http') ? avatarUrl : `${API_URL}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`
      try {
        const res = await fetch(path, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        })
        if (!res.ok) throw new Error('avatar fetch failed')
        const blob = await res.blob()
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        revoked = url
        setBlobUrl(url)
      } catch {
        if (!cancelled) setBlobUrl(null)
      }
    }

    void load()

    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [avatarUrl])

  return blobUrl
}

/** Data URLs or public URLs can be used directly; raw endpoint uses blob hook. */
export function resolveAvatarSrc(
  avatarUrl: string | null | undefined,
  blobUrl: string | null
): string | null {
  if (!avatarUrl) return null
  if (avatarUrl.startsWith('data:')) return avatarUrl
  if (isRawAvatarUrl(avatarUrl)) return blobUrl
  if (avatarUrl.startsWith('http')) return avatarUrl
  return `${API_URL}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`
}

export async function uploadAvatar(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{ avatar_url: string }>('/me/avatar', form)
  return res.data.avatar_url
}

export async function removeAvatar(): Promise<void> {
  await api.delete('/me/avatar')
}
