'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getCurrentUser, logout, User } from '@/lib/auth'
import api, { initializeAuth, startTokenRefreshInterval, stopTokenRefreshInterval } from '@/lib/api'
import Link from 'next/link'
import { usePermissions } from '@/hooks/usePermissions'
import { ROUTE_PERMISSIONS } from '@/config/navigation'
import { AppHeader } from '@/components/AppHeader'
import { DeveloperChromeProvider } from '@/components/DeveloperChromeContext'

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [sideMenuOpen, setSideMenuOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  /** From GET /company/info — hide Drawer Log when cash drawer is off */
  const [cashDrawerEnabled, setCashDrawerEnabled] = useState(false)
  const { can } = usePermissions(user)

  // Lock body scroll when side menu is open (below 950px)
  useEffect(() => {
    if (sideMenuOpen && typeof window !== 'undefined') {
      const w = document.documentElement.clientWidth
      if (w < 950) {
        document.body.style.overflow = 'hidden'
      }
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [sideMenuOpen])

  useEffect(() => {
    // Don't fetch user on login, verify-email, set-password, or register pages
    if (pathname === '/login' || pathname === '/verify-email' || pathname === '/set-password' || pathname === '/register') {
      setLoading(false)
      return
    }
    
    let abortController = new AbortController()
    let isMounted = true

    const fetchUser = async () => {
      try {
        const authInitialized = await initializeAuth()
        if (!authInitialized || !isMounted) {
          if (isMounted && pathname !== '/login') {
            setLoading(false)
            window.location.href = '/login'
          }
          return
        }

        // Start proactive token refresh interval after successful auth initialization
        startTokenRefreshInterval()

        const currentUser = await getCurrentUser(abortController.signal)
        if (isMounted) {
          setUser(currentUser)
          setLoading(false)
          
          // Check if verification is required - redirect to verify-email page
          if (currentUser.verification_required === true || currentUser.email_verified === false) {
            router.push(`/verify-email?email=${encodeURIComponent(currentUser.email)}`)
            return
          }
        }
      } catch (error: any) {
        if (abortController.signal.aborted || !isMounted) return
        
        // Don't redirect if it's a cancelled request
        if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
          if (isMounted) {
            setLoading(false)
          }
          return
        }
        
        // Handle email verification required - redirect to verify-email page
        if (error.isVerificationRequired || (error.response?.status === 403 && (
          error.response?.data?.detail?.error === 'EMAIL_VERIFICATION_REQUIRED' ||
          error.response?.data?.detail === 'EMAIL_VERIFICATION_REQUIRED' ||
          error.response?.data?.error === 'EMAIL_VERIFICATION_REQUIRED'
        ))) {
          if (isMounted) {
            const verificationEmail = error.verificationEmail || error.response?.data?.detail?.email || user?.email || null
            if (verificationEmail) {
              router.push(`/verify-email?email=${encodeURIComponent(verificationEmail)}`)
            } else {
              router.push('/verify-email')
            }
            setLoading(false)
          }
          return
        }
        
        // Only redirect if not already on login page and it's an auth error
        if (error.response?.status === 401 || (error.response?.status === 403 && !error.isVerificationRequired)) {
          if (isMounted && typeof window !== 'undefined' && window.location.pathname !== '/login') {
            setLoading(false)
            // Use window.location.href for hard redirect to stop all execution
            window.location.href = '/login'
          }
          return
        }
        
        if (isMounted) {
          setLoading(false)
        }
      }
    }
    
    fetchUser()

    // Cleanup function
    return () => {
      isMounted = false
      abortController.abort()
      // Don't stop token refresh interval here - it should run as long as user is logged in
    }
  }, [router, pathname, user?.email])

  useEffect(() => {
    if (!user) return
    // Platform developers have no company — skip tenant company info fetch
    if (user.role === 'DEVELOPER' || user.company_id == null) {
      setCashDrawerEnabled(false)
      return
    }
    let cancelled = false
    api
      .get('/company/info')
      .then((res) => {
        if (!cancelled) {
          setCashDrawerEnabled(res.data?.settings?.cash_drawer_enabled === true)
        }
      })
      .catch(() => {
        /* keep defaults on error */
      })
    return () => {
      cancelled = true
    }
  }, [user?.id, user?.role, user?.company_id])

  // Stop token refresh interval when component unmounts (e.g., on logout)
  useEffect(() => {
    return () => {
      // Only stop if user is not logged in (handled in handleLogout)
    }
  }, [])

  const employeeLinks = useMemo(() => {
    const all = [
      { href: '/dashboard', label: 'Dashboard', permission: 'clock' },
      { href: '/my-schedule', label: 'My Schedule', permission: 'schedule' },
      { href: '/logs', label: 'My Logs', permission: 'clock' },
      { href: '/leave', label: 'Leave', permission: 'leave' },
      { href: '/housekeeping', label: 'Housekeeping', permission: 'housekeeping' },
    ]
    return all.filter((l) => can(l.permission))
  }, [can])

  const adminNavGroups = useMemo(() => {
    const groups = [
      {
        type: 'single' as const,
        items: [
          { href: '/dashboard', label: 'Dashboard', permission: 'clock' },
        ],
      },
      {
        type: 'dropdown' as const,
        label: 'Team',
        items: [
          { href: '/employees', label: 'Employees', permission: 'user_management' },
          { href: '/leave-requests', label: 'Leave Requests', permission: 'user_management' },
        ],
      },
      {
        type: 'single' as const,
        items: [
          { href: '/schedules', label: 'Schedules', permission: 'schedule' },
          { href: '/housekeeping', label: 'Housekeeping', permission: 'housekeeping' },
        ],
      },
      {
        type: 'dropdown' as const,
        label: 'Logs',
        items: [
          { href: '/admin/punch-log', label: 'Punch Log', permission: 'common_log' },
          ...(cashDrawerEnabled
            ? [
                { href: '/admin/drawer-log', label: 'Drawer Log', permission: 'common_log' },
              ]
            : []),
        ],
      },
      {
        type: 'single' as const,
        items: [
          { href: '/payroll', label: 'Payroll', permission: 'payroll' },
          { href: '/reports', label: 'Reports', permission: 'reports' },
          { href: '/settings', label: 'Settings', permission: 'settings' },
        ],
      },
    ]

    const filtered = groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => can(item.permission)),
      }))
      .filter((group) => group.items.length > 0)

    return filtered
  }, [can, cashDrawerEnabled])

  const requiredPermission = useMemo(
    () =>
      Object.entries(ROUTE_PERMISSIONS).find(([route]) => pathname === route || pathname.startsWith(`${route}/`))?.[1],
    [pathname]
  )

  // Must run before any early return — same hook order every render (Rules of Hooks).
  useEffect(() => {
    if (loading || !user || !requiredPermission) return
    if (!can(requiredPermission)) {
      router.replace('/unauthorized')
    }
  }, [loading, user, requiredPermission, can, router])

  const handleLogout = async () => {
    stopTokenRefreshInterval() // Stop proactive refresh
    await logout()
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="text-center" role="status" aria-live="polite" aria-label="Loading">
          <div className="mx-auto h-9 w-9 rounded-full border-2 border-border border-t-accent animate-spin" />
          <p className="mt-4 text-sm text-foreground-muted">Loading…</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  const isAdmin = user.role === 'ADMIN' || user.role === 'MANAGER'
  const isEmployee = ['MAINTENANCE', 'FRONTDESK', 'HOUSEKEEPING', 'RESTAURANT', 'SECURITY'].includes(user.role)
  const isDeveloper = user.role === 'DEVELOPER'

  const developerLinks = [
    { href: '/developer', label: 'Developer Portal' },
    { href: '/developer/logs', label: 'Logs' },
    { href: '/settings/email', label: 'Email Service' },
  ]

  const tenantNavLinks = isDeveloper
    ? developerLinks
    : isAdmin
      ? []
      : employeeLinks.map(({ href, label }) => ({ href, label }))

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === href
    if (href === '/developer') return pathname === '/developer' || pathname === '/developer/'
    return pathname.startsWith(href)
  }

  const isDropdownActive = (items: Array<{ href: string; label: string }>) =>
    items.some((item) => isActive(item.href))

  return (
    <DeveloperChromeProvider isDeveloper={isDeveloper}>
      <div className="min-h-screen bg-page">
        <AppHeader
          user={user}
          onLogout={handleLogout}
          isDeveloper={isDeveloper}
          isAdmin={isAdmin}
          adminNavGroups={adminNavGroups}
          tenantLinks={tenantNavLinks}
          onMobileMenuToggle={() => setSideMenuOpen((o) => !o)}
          showMobileNavButton={!isDeveloper}
          cashDrawerEnabled={cashDrawerEnabled}
        />

      {/* Side menu overlay - below 950px only (tenant admin/employee) */}
      {!isDeveloper && (
        <>
      <div
        role="presentation"
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 min-[950px]:hidden ${
          sideMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setSideMenuOpen(false)}
        aria-hidden="true"
      />

      {/* Side menu drawer - below 950px only */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-72 max-w-[85vw] border-r border-border/80 bg-surface/95 shadow-lifted backdrop-blur-xl transition-transform duration-200 ease-out min-[950px]:hidden ${
          sideMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Main navigation"
        {...(sideMenuOpen ? { role: 'dialog', 'aria-modal': true as const } : {})}
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-border/80">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold tracking-tight text-foreground">ClockInn Pro</p>
              <p className="mt-0.5 truncate text-[11px] text-foreground-muted">
                {user.name}
                <span className="text-foreground-subtle"> · </span>
                {user.role === 'ADMIN'
                  ? 'Admin'
                  : user.role === 'MANAGER'
                    ? 'Manager'
                    : user.role.replace(/_/g, ' ')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSideMenuOpen(false)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground-muted hover:bg-border-subtle hover:text-foreground"
              aria-label="Close menu"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto py-4 px-3">
            <div className="space-y-1">
              {isAdmin ? (
                adminNavGroups.map((group, idx) => {
                  if (group.type === 'single') {
                    return group.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setSideMenuOpen(false)}
                        className={`block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                          isActive(item.href)
                            ? 'bg-accent/10 text-accent'
                            : 'text-foreground-muted hover:bg-border-subtle hover:text-foreground'
                        }`}
                      >
                        {item.label}
                      </Link>
                    ))
                  } else {
                    const dropdownId = `side-dropdown-${idx}`
                    return (
                      <div key={dropdownId} className="space-y-0.5 pt-2">
                        <button
                          type="button"
                          onClick={() => setOpenDropdown(openDropdown === dropdownId ? null : dropdownId)}
                          className={`w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                            isDropdownActive(group.items)
                              ? 'bg-accent/10 text-accent'
                              : 'text-foreground-muted hover:bg-border-subtle hover:text-foreground'
                          }`}
                        >
                          {group.label}
                          <svg
                            className={`h-4 w-4 opacity-60 transition-transform ${openDropdown === dropdownId ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <div className={openDropdown === dropdownId ? 'space-y-0.5 pl-2' : 'hidden'}>
                          {group.items.map((item) => (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={() => {
                                setSideMenuOpen(false)
                                setOpenDropdown(null)
                              }}
                              className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                                isActive(item.href)
                                  ? 'bg-accent/10 font-medium text-accent'
                                  : 'text-foreground-muted hover:bg-border-subtle/80'
                              }`}
                            >
                              {item.label}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )
                  }
                })
              ) : (
                tenantNavLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setSideMenuOpen(false)}
                    className={`block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive(link.href)
                        ? 'bg-accent/10 text-accent'
                        : 'text-foreground-muted hover:bg-border-subtle hover:text-foreground'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))
              )}
            </div>
          </nav>
        </div>
      </aside>
        </>
      )}
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
    </DeveloperChromeProvider>
  )
}
