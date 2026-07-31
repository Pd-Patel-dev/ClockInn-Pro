'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { cn } from '@/lib/cn'
import { focusRing, transitionUi } from './variants'

interface MenuContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerId: string
  menuId: string
  activeIndex: number
  setActiveIndex: (index: number) => void
}

const MenuContext = createContext<MenuContextValue | null>(null)

export function useMenuContext() {
  const ctx = useContext(MenuContext)
  if (!ctx) throw new Error('Menu components must be used within Menu')
  return ctx
}

export interface MenuProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function Menu({ children, open: controlledOpen, onOpenChange }: MenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange]
  )
  const triggerId = useId()
  const menuId = useId()
  const [activeIndex, setActiveIndex] = useState(-1)

  const value: MenuContextValue = {
    open,
    setOpen,
    triggerId,
    menuId,
    activeIndex,
    setActiveIndex,
  }

  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>
}

export interface MenuTriggerProps {
  children: React.ReactElement
  className?: string
}

export function MenuTrigger({ children, className }: MenuTriggerProps) {
  const { open, setOpen, triggerId, menuId } = useMenuContext()

  return React.cloneElement(children, {
    id: triggerId,
    className: cn(children.props.className, className),
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': menuId,
    onClick: (e: React.MouseEvent) => {
      children.props.onClick?.(e)
      setOpen(!open)
    },
  })
}

export interface MenuContentProps {
  children: React.ReactNode
  align?: 'start' | 'end'
  className?: string
  widthClass?: string
}

export function MenuContent({
  children,
  align = 'end',
  className,
  widthClass = 'w-56',
}: MenuContentProps) {
  const { open, setOpen, triggerId, menuId, activeIndex, setActiveIndex } = useMenuContext()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      const trigger = document.getElementById(triggerId)
      if (trigger?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        document.getElementById(triggerId)?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen, triggerId])

  if (!open) return null

  return (
    <div
      ref={ref}
      id={menuId}
      role="menu"
      aria-labelledby={triggerId}
      className={cn(
        'absolute z-50 mt-2 origin-top animate-in-ui',
        align === 'end' ? 'right-0' : 'left-0',
        widthClass,
        'surface-elevated py-1',
        className
      )}
      onKeyDown={(e) => {
        const items = ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')
        if (!items?.length) return
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          const next = (activeIndex + 1) % items.length
          setActiveIndex(next)
          items[next]?.focus()
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          const next = (activeIndex - 1 + items.length) % items.length
          setActiveIndex(next)
          items[next]?.focus()
        }
      }}
    >
      {children}
    </div>
  )
}

export function MenuSection({
  title,
  children,
  className,
}: {
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('py-1', className)} role="group">
      {title && (
        <div className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-foreground-subtle">
          {title}
        </div>
      )}
      {children}
    </div>
  )
}

export function MenuDivider() {
  return <div className="my-1 h-px bg-border" role="separator" />
}

export interface MenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode
  shortcut?: string
  destructive?: boolean
}

export function MenuItem({
  icon,
  shortcut,
  destructive,
  className,
  children,
  onClick,
  ...props
}: MenuItemProps) {
  const { setOpen } = useMenuContext()

  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm',
        transitionUi,
        focusRing,
        destructive
          ? 'text-danger hover:bg-red-500/10'
          : 'text-foreground hover:bg-border-subtle/70',
        className
      )}
      onClick={(e) => {
        onClick?.(e)
        setOpen(false)
      }}
      {...props}
    >
      {icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-70">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && (
        <span className="text-2xs text-foreground-subtle tabular-nums">{shortcut}</span>
      )}
    </button>
  )
}

/** Relative wrapper for trigger + content */
export function MenuRoot({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('relative inline-block text-left', className)}>{children}</div>
}

export { Menu as Dropdown, MenuContent as DropdownContent, MenuItem as DropdownItem }
