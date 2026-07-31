'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Mail, Shield, User } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import { Card, CardBody } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { ProfileProvider, useProfile } from './ProfileContext'
import { ProfileAvatar } from './ProfileAvatar'
import { formatMemberSince } from './profileUtils'
import { roleBadgeLabel } from './RoleBadge'

const NAV = [
  { href: '/profile', label: 'Overview', icon: User, exact: true },
  { href: '/profile/contact', label: 'Contact', icon: Mail },
  { href: '/profile/security', label: 'Security', icon: Shield },
] as const

function navActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href || pathname === `${href}/`
  return pathname === href || pathname.startsWith(`${href}/`)
}

function ProfileHeader() {
  const { user, loading } = useProfile()
  if (loading || !user) {
    return (
      <Card className="mb-6">
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </CardBody>
      </Card>
    )
  }

  const isDeveloper = user.role === 'DEVELOPER'
  const displayName = user.preferred_name?.trim() || user.name

  return (
    <Card className="mb-6">
      <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <ProfileAvatar userId={user.id} name={user.name} avatarUrl={user.avatar_url} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{displayName}</h1>
          <p className="truncate text-sm text-foreground-muted">{user.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {user.email_verified ? (
              <Badge variant="success">Verified</Badge>
            ) : (
              <Badge variant="warning">Unverified</Badge>
            )}
            {roleBadgeLabel(user)}
          </div>
          <p className="mt-2 text-xs text-foreground-subtle">
            {isDeveloper ? 'Platform Developer' : user.company_name || '—'}
            {' · '}
            Member since {formatMemberSince(user.created_at)}
          </p>
        </div>
      </CardBody>
    </Card>
  )
}

function ProfileNav({ mobile }: { mobile?: boolean }) {
  const pathname = usePathname()

  const linkClass = (active: boolean) =>
    cn(
      'flex items-center gap-2 rounded-control px-3 py-2 text-sm font-medium transition-colors',
      mobile ? 'shrink-0 whitespace-nowrap' : 'w-full',
      active
        ? 'bg-accent/10 text-accent'
        : 'text-foreground-muted hover:bg-border-subtle/80 hover:text-foreground'
    )

  return (
    <nav
      className={cn(
        mobile
          ? 'flex gap-1 overflow-x-auto border-b border-border pb-0 -mx-1 px-1 scrollbar-thin'
          : 'flex flex-col gap-1'
      )}
      aria-label="Profile sections"
    >
      {NAV.map((item) => {
        const { href, label, icon: Icon } = item
        const exact = 'exact' in item ? item.exact : false
        const active = navActive(pathname, href, exact)
        return (
          <Link key={href} href={href} className={linkClass(active)} aria-current={active ? 'page' : undefined}>
            <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

function ProfileShellInner({ children }: { children: React.ReactNode }) {
  const { error } = useProfile()

  return (
    <div className="mx-auto max-w-5xl px-1">
      <ProfileHeader />
      {error && (
        <p className="mb-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="lg:hidden mb-4">
        <ProfileNav mobile />
      </div>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="hidden w-52 shrink-0 lg:block">
          <ProfileNav />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

export function ProfileShell({ children }: { children: React.ReactNode }) {
  return (
    <ProfileProvider>
      <ProfileShellInner>{children}</ProfileShellInner>
    </ProfileProvider>
  )
}
