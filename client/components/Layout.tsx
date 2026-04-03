'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getCurrentUser, logout, User } from '@/lib/auth'
import api, { initializeAuth, startTokenRefreshInterval, stopTokenRefreshInterval } from '@/lib/api'
import Link from 'next/link'
import { usePermissions } from '@/hooks/usePermissions'
import { ROUTE_PERMISSIONS } from '@/config/navigation'

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [sideMenuOpen, setSideMenuOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const dropdownRefs = useRef<{ [key: string]: HTMLDivElement | null }>({})
  /** From GET /company/info — hide employee shift notepad only; admin Shift Log stays available */
  const [shiftNotesEnabled, setShiftNotesEnabled] = useState(true)
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
    let cancelled = false
    api
      .get('/company/info')
      .then((res) => {
        if (!cancelled) {
          setShiftNotesEnabled(res.data?.settings?.shift_notes_enabled !== false)
        }
      })
      .catch(() => {
        /* keep default true on error */
      })
    return () => {
      cancelled = true
    }
  }, [user?.id])

  // Stop token refresh interval when component unmounts (e.g., on logout)
  useEffect(() => {
    return () => {
      // Only stop if user is not logged in (handled in handleLogout)
    }
  }, [])

  // Close dropdown when clicking outside - MUST be called before any early returns
  useEffect(() => {
    if (!openDropdown) return

    const handleClickOutside = (event: MouseEvent) => {
      const ref = dropdownRefs.current[openDropdown]
      if (ref && !ref.contains(event.target as Node)) {
        setOpenDropdown(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openDropdown])

  const employeeLinks = useMemo(() => {
    const all = [
      { href: '/dashboard', label: 'Dashboard', permission: 'clock' },
      { href: '/punch-in-out', label: 'Punch In/Out', permission: 'clock' },
      { href: '/my/shift-notepad', label: 'Shift Notepad', permission: 'shift_notes' },
      { href: '/my-schedule', label: 'My Schedule', permission: 'schedule' },
      { href: '/logs', label: 'My Logs', permission: 'clock' },
      { href: '/leave', label: 'Leave', permission: 'leave' },
    ]
    const filtered = all.filter((l) => can(l.permission))
    if (!shiftNotesEnabled) {
      return filtered.filter((l) => l.href !== '/my/shift-notepad')
    }
    return filtered
  }, [shiftNotesEnabled, can])

  const adminNavGroups = useMemo(() => {
    const groups = [
      {
        type: 'single' as const,
        items: [
          { href: '/dashboard', label: 'Dashboard', permission: 'clock' },
          { href: '/punch-in-out', label: 'Punch In/Out', permission: 'clock' },
        ],
      },
      {
        type: 'dropdown' as const,
        label: 'Team',
        items: [
          { href: '/employees', label: 'Employees', permission: 'user_management' },
          { href: '/leave-requests', label: 'Leave Requests', permission: 'user_management' },
          { href: '/roles', label: 'Roles & Permissions', permission: 'user_management' },
        ],
      },
      {
        type: 'dropdown' as const,
        label: 'Scheduling',
        items: [
          { href: '/schedules', label: 'Schedules', permission: 'schedule' },
          { href: '/time-entries', label: 'Time Entries', permission: 'schedule' },
          { href: '/admin/shift-log', label: 'Shift Log', permission: 'common_log' },
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
  }, [can])

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
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center" role="status" aria-live="polite" aria-label="Loading">
          <div className="mx-auto h-9 w-9 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
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
    { href: '/settings', label: 'Email Service' },
  ]

  const links = isDeveloper ? developerLinks : (isAdmin ? adminNavGroups : employeeLinks)

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === href
    }
    return pathname.startsWith(href)
  }

  const isDropdownActive = (items: Array<{ href: string; label: string }>) => {
    return items.some(item => isActive(item.href))
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Navigation */}
      <nav className="bg-slate-900 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-14">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <Link href="/dashboard" className="inline-flex items-center text-xl font-semibold text-white">
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-2" aria-hidden />
                  ClockInn
                </Link>
              </div>
              {/* Desktop Navigation - from 950px */}
              <div className="hidden min-[950px]:ml-8 min-[950px]:flex min-[950px]:gap-1 min-[950px]:items-center">
                {isAdmin ? (
                  adminNavGroups.map((group, idx) => {
                    if (group.type === 'single') {
                      return group.items.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                            isActive(item.href)
                              ? 'bg-slate-700 text-white'
                              : 'text-slate-300 hover:text-white hover:bg-slate-700'
                          }`}
                        >
                          {item.label}
                        </Link>
                      ))
                    } else {
                      const dropdownId = `dropdown-${idx}`
                      const isActiveGroup = isDropdownActive(group.items)
                      return (
                        <div
                          key={dropdownId}
                          ref={(el) => {
                            if (el) {
                              dropdownRefs.current[dropdownId] = el
                            } else {
                              delete dropdownRefs.current[dropdownId]
                            }
                          }}
                          className="relative"
                        >
                          <button
                            type="button"
                            onClick={() => setOpenDropdown(openDropdown === dropdownId ? null : dropdownId)}
                            className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                              isActiveGroup
                                ? 'bg-slate-700 text-white'
                                : 'text-slate-300 hover:text-white hover:bg-slate-700'
                            }`}
                          >
                            {group.label}
                            <svg
                              className={`ml-1 h-4 w-4 transition-transform ${
                                openDropdown === dropdownId ? 'rotate-180' : ''
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {openDropdown === dropdownId && (
                            <div className="absolute top-full left-0 mt-1 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50">
                              <div className="py-1">
                                {group.items.map((item) => (
                                  <Link
                                    key={item.href}
                                    href={item.href}
                                    onClick={() => setOpenDropdown(null)}
                                    className={`block px-4 py-2 text-sm transition-colors ${
                                      isActive(item.href)
                                        ? 'bg-slate-700 text-white font-medium'
                                        : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                                    }`}
                                  >
                                    {item.label}
                                  </Link>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    }
                  })
                ) : (
                  (links as Array<{ href: string; label: string }>).map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive(link.href)
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-300 hover:text-white hover:bg-slate-700'
                    }`}
                  >
                    {link.label}
                  </Link>
                  ))
                )}
              </div>
            </div>
            {/* User Menu + Hamburger (responsive) */}
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden sm:flex sm:items-center sm:gap-2">
                <div
                  className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-semibold text-white uppercase shrink-0"
                  title={user.name}
                >
                  {user.name.trim().slice(0, 2).toUpperCase() || '?'}
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="text-slate-300 hover:text-white hover:bg-slate-700 px-3 py-1.5 text-sm rounded-md transition-colors"
              >
                Logout
              </button>
              {/* Hamburger - visible below 950px, opens side menu */}
              <button
                type="button"
                onClick={() => setSideMenuOpen(!sideMenuOpen)}
                className="min-[950px]:hidden inline-flex items-center justify-center p-2 rounded-md text-slate-300 hover:text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-500"
                aria-expanded={sideMenuOpen}
                aria-label={sideMenuOpen ? 'Close menu' : 'Open menu'}
              >
                <span className="sr-only">{sideMenuOpen ? 'Close menu' : 'Open menu'}</span>
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  {sideMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Side menu overlay - below 950px only */}
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
        className={`fixed top-0 left-0 z-50 h-full w-72 max-w-[85vw] bg-white shadow-xl transition-transform duration-200 ease-out min-[950px]:hidden ${
          sideMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-modal="true"
        aria-label="Main navigation"
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between h-14 px-4 bg-slate-900 border-b border-slate-700">
            <span className="text-lg font-semibold text-white">Menu</span>
            <button
              type="button"
              onClick={() => setSideMenuOpen(false)}
              className="p-2 rounded-md text-slate-300 hover:text-white hover:bg-slate-700"
              aria-label="Close menu"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto py-4 px-2 bg-white">
            <div className="space-y-1">
              {isAdmin ? (
                adminNavGroups.map((group, idx) => {
                  if (group.type === 'single') {
                    return group.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setSideMenuOpen(false)}
                        className={`block px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                          isActive(item.href)
                            ? 'bg-blue-50 text-blue-700'
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {item.label}
                      </Link>
                    ))
                  } else {
                    const dropdownId = `side-dropdown-${idx}`
                    return (
                      <div key={dropdownId} className="space-y-0.5">
                        <button
                          type="button"
                          onClick={() => setOpenDropdown(openDropdown === dropdownId ? null : dropdownId)}
                          className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                            isDropdownActive(group.items)
                              ? 'bg-blue-50 text-blue-700'
                              : 'text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          {group.label}
                          <svg
                            className={`h-4 w-4 transition-transform ${openDropdown === dropdownId ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <div className={openDropdown === dropdownId ? 'pl-3 space-y-0.5' : 'hidden'}>
                          {group.items.map((item) => (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={() => {
                                setSideMenuOpen(false)
                                setOpenDropdown(null)
                              }}
                              className={`block px-3 py-2 text-sm rounded-lg transition-colors ${
                                isActive(item.href)
                                  ? 'bg-blue-50 text-blue-700 font-medium'
                                  : 'text-gray-600 hover:bg-gray-50'
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
                (links as Array<{ href: string; label: string }>).map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setSideMenuOpen(false)}
                    className={`block px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                      isActive(link.href)
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))
              )}
            </div>
          </nav>
          <div className="border-t border-gray-200 bg-slate-50 p-3">
            <div className="flex items-center gap-3 px-2 min-w-0">
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-semibold text-white uppercase shrink-0">
                {user.name.trim().slice(0, 2).toUpperCase() || '?'}
              </div>
              <p className="text-xs text-gray-700 font-medium truncate">{user.name}</p>
            </div>
          </div>
        </div>
      </aside>
      <main className="max-w-7xl mx-auto w-full py-8 px-4 sm:px-6 lg:px-8">{children}</main>
    </div>
  )
}
