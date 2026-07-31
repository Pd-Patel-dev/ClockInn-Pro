'use client'

import React from 'react'
import { Avatar, type AvatarSize } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { avatarColorClass } from './profileUtils'
import { resolveAvatarSrc, useProfileAvatarBlob } from './useProfileAvatar'

export interface ProfileAvatarProps {
  userId: string
  name: string
  avatarUrl?: string | null
  size?: AvatarSize
  className?: string
}

export function ProfileAvatar({ userId, name, avatarUrl, size = 'md', className }: ProfileAvatarProps) {
  const blobUrl = useProfileAvatarBlob(avatarUrl)
  const src = resolveAvatarSrc(avatarUrl, blobUrl)

  return (
    <Avatar
      name={name}
      src={src}
      size={size}
      className={cn(!src && avatarColorClass(userId), className)}
    />
  )
}
