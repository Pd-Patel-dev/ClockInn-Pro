'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getCurrentUser, logout, User } from '@/lib/auth'
import { initializeAuth, startTokenRefreshInterval, stopTokenRefreshInterval } from '@/lib/api'
import Link from 'next/link'

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const dropdownRefs = useRef<{ [key: string]: HTMLDivElement | null }>({})

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

  const handleLogout = async () => {
    stopTokenRefreshInterval() // Stop proactive refresh
    await logout()
    router.push('/login')
  }


  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <div className="mt-4 h-4 w-24 bg-gray-200 rounded mx-auto animate-pulse"></div>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  const isAdmin = user.role === 'ADMIN'
  const isEmployee = user.role === 'EMPLOYEE'
  const isDeveloper = user.role === 'DEVELOPER'

  const employeeLinks = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/punch', label: 'Punch In/Out' },
    { href: '/my-schedule', label: 'My Schedule' },
    { href: '/logs', label: 'My Logs' },
    { href: '/leave', label: 'Leave' },
  ]

  // Admin navigation organized by type
  const adminNavGroups = [
    {
      type: 'single',
      items: [{ href: '/dashboard', label: 'Dashboard' }]
    },
    {
      type: 'dropdown',
      label: 'Team Management',
      items: [
    { href: '/employees', label: 'Employees' },
        { href: '/leave-requests', label: 'Leave Requests' },
      ]
    },
    {
      type: 'dropdown',
      label: 'Time & Scheduling',
      items: [
    { href: '/schedules', label: 'Schedules' },
        { href: '/time-entries', label: 'Time Entries' },
      ]
    },
    {
      type: 'dropdown',
      label: 'Financial',
      items: [
    { href: '/payroll', label: 'Payroll' },
        { href: '/admin/cash', label: 'Cash Drawer' },
      ]
    },
    {
      type: 'single',
      items: [{ href: '/reports', label: 'Reports' }]
    },
    {
      type: 'single',
      items: [{ href: '/settings', label: 'Settings' }]
    },
  ]

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
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-14">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <Link href="/dashboard" className="text-xl font-semibold text-gray-900">
                  ClockInn
                </Link>
              </div>
              {/* Desktop Navigation */}
              <div className="hidden md:ml-8 md:flex md:space-x-1 md:items-center">
                {isAdmin ? (
                  adminNavGroups.map((group, idx) => {
                    if (group.type === 'single') {
                      return group.items.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`inline-flex items-center px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                            isActive(item.href)
                              ? 'border-blue-600 text-blue-600'
                              : 'border-transparent text-gray-700 hover:text-gray-900 hover:border-gray-300'
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
                            onClick={() => setOpenDropdown(openDropdown === dropdownId ? null : dropdownId)}
                            className={`inline-flex items-center px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                              isActiveGroup
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-700 hover:text-gray-900 hover:border-gray-300'
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
                            <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-50">
                              <div className="py-1">
                                {group.items.map((item) => (
                                  <Link
                                    key={item.href}
                                    href={item.href}
                                    onClick={() => setOpenDropdown(null)}
                                    className={`block px-4 py-2 text-sm transition-colors ${
                                      isActive(item.href)
                                        ? 'bg-blue-50 text-blue-600 font-medium'
                                        : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
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
                  links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`inline-flex items-center px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                      isActive(link.href)
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-700 hover:text-gray-900 hover:border-gray-300'
                    }`}
                  >
                    {link.label}
                  </Link>
                  ))
                )}
              </div>
            </div>
            {/* User Menu */}
            <div className="flex items-center space-x-3">
              <div className="hidden sm:block">
                <p className="text-sm text-gray-700">{user.name}</p>
              </div>
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded"
              >
                Logout
              </button>
              {/* Mobile menu button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden inline-flex items-center justify-center p-2 rounded-md text-gray-700 hover:text-gray-900 hover:bg-gray-100"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>
        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 bg-white">
            <div className="px-2 pt-2 pb-3 space-y-1">
              {isAdmin ? (
                adminNavGroups.map((group, idx) => {
                  if (group.type === 'single') {
                    return group.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`block px-3 py-2 text-sm font-medium border-l-4 transition-colors ${
                          isActive(item.href)
                            ? 'border-blue-600 text-blue-600 bg-blue-50'
                            : 'border-transparent text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {item.label}
                      </Link>
                    ))
                  } else {
                    const dropdownId = `mobile-dropdown-${idx}`
                    return (
                      <div key={dropdownId}>
                        <button
                          onClick={() => setOpenDropdown(openDropdown === dropdownId ? null : dropdownId)}
                          className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium border-l-4 transition-colors ${
                            isDropdownActive(group.items)
                              ? 'border-blue-600 text-blue-600 bg-blue-50'
                              : 'border-transparent text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          {group.label}
                          <svg
                            className={`h-4 w-4 transition-transform ${
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
                          <div className="pl-4 space-y-1">
                            {group.items.map((item) => (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => {
                                  setMobileMenuOpen(false)
                                  setOpenDropdown(null)
                                }}
                                className={`block px-3 py-2 text-sm transition-colors ${
                                  isActive(item.href)
                                    ? 'text-blue-600 font-medium bg-blue-50'
                                    : 'text-gray-600 hover:bg-gray-50'
                                }`}
                              >
                                {item.label}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  }
                })
              ) : (
                links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block px-3 py-2 text-sm font-medium border-l-4 transition-colors ${
                    isActive(link.href)
                      ? 'border-blue-600 text-blue-600 bg-blue-50'
                      : 'border-transparent text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {link.label}
                </Link>
                ))
              )}
            </div>
          </div>
        )}
      </nav>
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  )
}
