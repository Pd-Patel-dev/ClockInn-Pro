'use client'

import React from 'react'
import Link from 'next/link'
import type { User } from '@/lib/auth'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import {
  Menu,
  MenuContent,
  MenuDivider,
  MenuItem,
  MenuRoot,
  MenuSection,
  MenuTrigger,
  useMenuContext,
} from '@/components/ui/Dropdown'
import { cn } from '@/lib/cn'
import { focusRing, transitionUi } from '@/components/ui/variants'
import { useDeveloperChrome } from '@/components/DeveloperChromeContext'

function MenuLink({
  href,
  icon,
  children,
  external,
}: {
  href: string
  icon?: React.ReactNode
  children: React.ReactNode
  external?: boolean
}) {
  const { setOpen } = useMenuContext()

  const className = cn(
    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm',
    transitionUi,
    focusRing,
    'text-foreground hover:bg-border-subtle/70'
  )

  if (external) {
    return (
      <a
        href={href}
        role="menuitem"
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        onClick={() => setOpen(false)}
      >
        {icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-70">{icon}</span>}
        <span className="flex-1 truncate">{children}</span>
      </a>
    )
  }

  return (
    <Link href={href} role="menuitem" className={className} onClick={() => setOpen(false)}>
      {icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-70">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
    </Link>
  )
}

function roleBadge(user: User) {
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

export interface ProfileMenuProps {
  user: User
  onLogout: () => void
}

export function ProfileMenu({ user, onLogout }: ProfileMenuProps) {
  const chrome = useDeveloperChrome()
  const isDeveloper = user.role === 'DEVELOPER'

  return (
    <Menu>
      <MenuRoot>
        <MenuTrigger>
          <button
            type="button"
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Open profile menu"
          >
            <Avatar name={user.name} size="sm" />
          </button>
        </MenuTrigger>
        <MenuContent align="end" widthClass="w-[280px]" className="max-h-[min(85vh,640px)] overflow-y-auto">
          <div className="border-b border-border px-3 py-3">
            <div className="flex items-start gap-3">
              <Avatar name={user.name} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
                <p className="truncate text-xs text-foreground-muted">{user.email}</p>
                <div className="mt-2">{roleBadge(user)}</div>
                <p className="mt-2 text-xs text-foreground-subtle">
                  {isDeveloper ? 'Platform Developer — no company' : user.company_name || '—'}
                </p>
              </div>
            </div>
          </div>

          <MenuSection title="Account">
            <MenuLink href="/profile">My Profile</MenuLink>
          </MenuSection>

          {isDeveloper && (
            <>
              <MenuDivider />
              <MenuSection title="Workspace">
                <MenuLink href="/developer/companies">Companies</MenuLink>
                <MenuItem onClick={() => chrome.openCommandPalette()}>All Users</MenuItem>
                <MenuLink href="/developer/logs">Activity Logs</MenuLink>
                <MenuLink href="/settings/email">Email Service</MenuLink>
                <MenuLink href="/settings/api-keys">API Keys</MenuLink>
              </MenuSection>
            </>
          )}

          <MenuDivider />
          <MenuSection title="Support">
            <MenuItem shortcut="?" onClick={() => chrome.openShortcuts()}>
              Keyboard Shortcuts
            </MenuItem>
            <MenuLink href="https://docs.clockinn.pro" external>
              Documentation
            </MenuLink>
            <MenuItem onClick={() => chrome.openFeedback({ kind: 'feedback' })}>Send Feedback</MenuItem>
            <MenuItem onClick={() => chrome.openFeedback({ kind: 'bug' })}>Report Bug</MenuItem>
            <MenuItem onClick={() => chrome.openChangelog()}>What&apos;s New</MenuItem>
          </MenuSection>

          <MenuDivider />
          <MenuSection title="Appearance">
            <div className="px-3 py-2">
              <ThemeToggle className="w-full justify-between" />
            </div>
          </MenuSection>

          <MenuDivider />
          <MenuItem
            destructive
            onClick={() => {
              onLogout()
            }}
          >
            Sign Out
          </MenuItem>
        </MenuContent>
      </MenuRoot>
    </Menu>
  )
}
