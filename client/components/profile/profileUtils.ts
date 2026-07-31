import type { User } from '@/lib/auth'

export function apiErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string') return detail
  return fallback
}

const AVATAR_BG = [
  'bg-rose-500/20 text-rose-700 dark:text-rose-300',
  'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  'bg-amber-500/20 text-amber-800 dark:text-amber-300',
  'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  'bg-teal-500/20 text-teal-700 dark:text-teal-300',
  'bg-sky-500/20 text-sky-700 dark:text-sky-300',
  'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300',
  'bg-violet-500/20 text-violet-700 dark:text-violet-300',
] as const

export function avatarColorClass(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) {
    h = (Math.imul(31, h) + userId.charCodeAt(i)) >>> 0
  }
  return AVATAR_BG[h % AVATAR_BG.length]
}

export function isRawAvatarUrl(avatarUrl: string | null | undefined): boolean {
  if (!avatarUrl) return false
  return avatarUrl.includes('/me/avatar/raw') || avatarUrl.endsWith('/avatar/raw')
}

export function formatMemberSince(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(iso))
  } catch {
    return '—'
  }
}

export type { User }
