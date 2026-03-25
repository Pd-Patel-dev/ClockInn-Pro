'use client'

import { ReactNode } from 'react'
import { User } from '@/lib/auth'
import { usePermissions } from '@/hooks/usePermissions'

interface PermissionGateProps {
  feature: string
  user?: User | null
  children: ReactNode
  fallback?: ReactNode
}

export function PermissionGate({ feature, user, children, fallback = null }: PermissionGateProps) {
  const { can } = usePermissions(user)
  return can(feature) ? <>{children}</> : <>{fallback}</>
}

