'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'
import { Drawer } from '@/components/ui/Drawer'

type NavItem = {
  href: string
  label: string
  icon: React.ReactNode
  match?: 'exact' | 'prefix'
}

function NavIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-foreground-muted">
      {children}
    </span>
  )
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/developer',
    label: 'Overview',
    match: 'exact',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    href: '/developer/companies',
    label: 'Companies',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    href: '/developer/users',
    label: 'Users',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
  {
    href: '/developer/developers',
    label: 'Developers',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
  },
  {
    href: '/developer/logs',
    label: 'Activity Logs',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    href: '/settings/email',
    label: 'Email Service',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
]

function isActive(pathname: string, item: NavItem) {
  if (item.match === 'exact') {
    return pathname === item.href || pathname === `${item.href}/`
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 px-2 py-3" aria-label="Developer portal">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={item.label}
            className={cn(
              'flex items-center gap-3 rounded-control px-2 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-accent/10 text-accent'
                : 'text-foreground-muted hover:bg-border-subtle/80 hover:text-foreground',
            )}
          >
            <NavIcon>{item.icon}</NavIcon>
            <span className="truncate lg:inline md:sr-only lg:not-sr-only">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export default function DeveloperShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col md:flex-row">
      <aside
        className={cn(
          'hidden shrink-0 flex-col border-r border-border bg-surface md:flex',
          'w-16 lg:w-[240px]',
        )}
      >
        <div className="border-b border-border px-3 py-4 lg:px-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent md:sr-only lg:not-sr-only">
            Developer
          </p>
          <p className="mt-0.5 text-sm font-semibold text-foreground md:sr-only lg:not-sr-only">Portal</p>
        </div>
        <NavLinks pathname={pathname} />
      </aside>

      <Drawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        title="Developer Portal"
        description="Platform administration"
        side="left"
        widthClass="w-[min(100%,280px)]"
      >
        <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-control p-2 text-foreground hover:bg-border-subtle"
            aria-label="Open navigation menu"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-foreground">Developer Portal</span>
        </div>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  )
}
