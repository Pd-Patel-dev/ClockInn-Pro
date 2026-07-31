import React from 'react'
import type { User } from '@/lib/auth'
import { Badge } from '@/components/ui/Badge'

export function roleBadgeLabel(user: User): React.ReactNode {
  if (user.role === 'DEVELOPER') {
    return (
      <Badge variant="info" className="bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/25">
        Developer
      </Badge>
    )
  }
  if (user.role === 'ADMIN' || user.role === 'MANAGER') {
    return <Badge variant="info">{user.role === 'MANAGER' ? 'Manager' : 'Admin'}</Badge>
  }
  return <Badge variant="neutral">{user.role.replace(/_/g, ' ')}</Badge>
}
