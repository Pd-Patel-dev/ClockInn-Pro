'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { User } from '@/lib/auth'
import api from '@/lib/api'
import { cn } from '@/lib/cn'
import { Breadcrumbs, type BreadcrumbItem } from '@/components/ui/Breadcrumbs'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSection,
  MenuTrigger,
} from '@/components/ui/Dropdown'
import { ProfileMenu } from '@/components/ProfileMenu'
import { useDeveloperChrome } from '@/components/DeveloperChromeContext'

type NavLink = { href: string; label: string }
type AdminNavGroup =
  | { type: 'single'; items: NavLink[] }
  | { type: 'dropdown'; label: string; items: NavLink[] }

function developerBreadcrumbs(pathname: string): BreadcrumbItem[] {
  if (!pathname.startsWith('/developer')) return []
  const segments = pathname.split('/').filter(Boolean)
  const items: BreadcrumbItem[] = [{ label: 'Developer', href: '/developer' }]
  if (segments.length <= 1) return items

  const labelMap: Record<string, string> = {
    companies: 'Companies',
    users: 'Users',
    developers: 'Developers',
    logs: 'Activity Logs',
    system: 'System Health',
  }

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]
    const href = `/${segments.slice(0, i + 1).join('/')}`
    const isLast = i === segments.length - 1
    const looksLikeId = seg.length > 20 || /^[0-9a-f-]{36}$/i.test(seg)
    items.push({
      label: looksLikeId ? 'Details' : labelMap[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1),
      href: isLast ? undefined : href,
    })
  }
  return items
}

export interface AppHeaderProps {
  user: User
  onLogout: () => void
  isDeveloper: boolean
  isAdmin: boolean
  adminNavGroups: AdminNavGroup[]
  tenantLinks: NavLink[]
  onMobileMenuToggle?: () => void
  showMobileNavButton?: boolean
  breadcrumbs?: BreadcrumbItem[]
}

export function AppHeader({
  user,
  onLogout,
  isDeveloper,
  isAdmin,
  adminNavGroups,
  tenantLinks,
  onMobileMenuToggle,
  showMobileNavButton,
  breadcrumbs: breadcrumbsProp,
}: AppHeaderProps) {
  const pathname = usePathname()
  const headerRef = useRef<HTMLElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const [unread, setUnread] = useState(0)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const dropdownRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const chrome = useDeveloperChrome()

  const breadcrumbs = useMemo(() => {
    if (breadcrumbsProp?.length) return breadcrumbsProp
    if (isDeveloper && pathname.startsWith('/developer')) return developerBreadcrumbs(pathname)
    return []
  }, [breadcrumbsProp, isDeveloper, pathname])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .get('/notifications/unread-count')
      .then((res) => {
        if (!cancelled) setUnread(res.data?.count ?? 0)
      })
      .catch(() => {
        if (!cancelled) setUnread(0)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!openDropdown) return
    const handleClickOutside = (event: MouseEvent) => {
      const ref = dropdownRefs.current[openDropdown]
      if (ref && !ref.contains(event.target as Node)) setOpenDropdown(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openDropdown])

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === href
    if (href === '/developer') return pathname === '/developer' || pathname === '/developer/'
    return pathname.startsWith(href)
  }

  const isDropdownActive = (items: NavLink[]) => items.some((item) => isActive(item.href))

  const navLinkClass = (active: boolean) =>
    cn(
      'inline-flex items-center rounded-control px-3 py-1.5 text-sm font-medium transition-colors',
      active
        ? 'bg-border-subtle text-foreground'
        : 'text-foreground-muted hover:bg-border-subtle/80 hover:text-foreground'
    )

  const modKey = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl'

  return (
    <header
      ref={headerRef}
      className={cn(
        'sticky top-0 z-40 h-14 border-b border-border bg-surface transition-shadow',
        scrolled && 'shadow-subtle'
      )}
    >
      <div className="mx-auto flex h-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {showMobileNavButton && (
            <button
              type="button"
              onClick={onMobileMenuToggle}
              className="min-[950px]:hidden inline-flex rounded-control p-2 text-foreground-muted hover:bg-border-subtle hover:text-foreground"
              aria-label="Open navigation menu"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}

          <Link href="/dashboard" className="inline-flex shrink-0 items-center gap-2 text-base font-semibold text-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" aria-hidden />
            ClockInn Pro
          </Link>

          {breadcrumbs.length > 0 && (
            <div className="hidden min-w-0 sm:block border-l border-border pl-3">
              <Breadcrumbs items={breadcrumbs} />
            </div>
          )}

          {!isDeveloper && (
            <div className="hidden min-[950px]:ml-2 min-[950px]:flex min-[950px]:items-center min-[950px]:gap-1">
              {isAdmin
                ? adminNavGroups.map((group, idx) => {
                    if (group.type === 'single') {
                      return group.items.map((item) => (
                        <Link key={item.href} href={item.href} className={navLinkClass(isActive(item.href))}>
                          {item.label}
                        </Link>
                      ))
                    }
                    const dropdownId = `header-dropdown-${idx}`
                    const activeGroup = isDropdownActive(group.items)
                    return (
                      <div
                        key={dropdownId}
                        ref={(el) => {
                          if (el) dropdownRefs.current[dropdownId] = el
                          else delete dropdownRefs.current[dropdownId]
                        }}
                        className="relative"
                      >
                        <button
                          type="button"
                          onClick={() => setOpenDropdown(openDropdown === dropdownId ? null : dropdownId)}
                          className={navLinkClass(activeGroup)}
                        >
                          {group.label}
                          <svg
                            className={cn('ml-1 h-4 w-4 transition-transform', openDropdown === dropdownId && 'rotate-180')}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {openDropdown === dropdownId && (
                          <div className="absolute left-0 top-full z-50 mt-1 w-52 surface-elevated py-1">
                            {group.items.map((item) => (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setOpenDropdown(null)}
                                className={cn(
                                  'block px-3 py-2 text-sm',
                                  isActive(item.href)
                                    ? 'bg-border-subtle font-medium text-foreground'
                                    : 'text-foreground-muted hover:bg-border-subtle/70 hover:text-foreground'
                                )}
                              >
                                {item.label}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })
                : tenantLinks.map((link) => (
                    <Link key={link.href} href={link.href} className={navLinkClass(isActive(link.href))}>
                      {link.label}
                    </Link>
                  ))}
            </div>
          )}
        </div>

        {isDeveloper && (
          <div className="hidden flex-1 justify-center md:flex">
            <button
              type="button"
              onClick={() => chrome.openCommandPalette()}
              className="flex h-9 w-full max-w-md items-center gap-2 rounded-control border border-border bg-border-subtle/40 px-3 text-sm text-foreground-muted hover:border-border hover:bg-border-subtle/70"
            >
              <svg className="h-4 w-4 shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="truncate">Search users, companies, logs… ({modKey}K)</span>
            </button>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {isDeveloper && (
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              aria-label="Open search"
              onClick={() => chrome.openCommandPalette()}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </Button>
          )}

          <button
            type="button"
            className="relative rounded-control p-2 text-foreground-muted hover:bg-border-subtle hover:text-foreground"
            aria-label="Notifications"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
            {unread > 0 && (
              <Badge variant="danger" className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] justify-center px-1 py-0 text-[10px]">
                {unread > 99 ? '99+' : unread}
              </Badge>
            )}
          </button>

          <Menu>
            <MenuRoot>
              <MenuTrigger>
                <Button variant="ghost" size="sm" aria-label="Help">
                  Help
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuSection>
                  <MenuItem onClick={() => chrome.openShortcuts()} shortcut="?">
                    Keyboard shortcuts
                  </MenuItem>
                  <MenuItem onClick={() => window.open('https://docs.clockinn.pro', '_blank', 'noopener,noreferrer')}>
                    Documentation
                  </MenuItem>
                  <MenuItem onClick={() => chrome.openFeedback({ kind: 'feedback' })}>Contact support</MenuItem>
                </MenuSection>
              </MenuContent>
            </MenuRoot>
          </Menu>

          <ProfileMenu user={user} onLogout={onLogout} />
        </div>
      </div>
    </header>
  )
}
