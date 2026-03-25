import { User } from '@/lib/auth'

export function usePermissions(user?: User | null) {
  const permissions: string[] = user?.permissions ?? []

  return {
    can: (feature: string) => permissions.includes(feature),
    role: user?.role ?? null,
    permissions,
  }
}

