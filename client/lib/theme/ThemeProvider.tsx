'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { THEME_STORAGE_KEY, type ThemeMode } from './tokens'

function resolveDark(mode: ThemeMode): boolean {
  if (typeof window === 'undefined') return false
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyThemeClass(isDark: boolean) {
  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
}

interface ThemeContextValue {
  theme: ThemeMode
  setTheme: (mode: ThemeMode) => void
  resolvedTheme: 'light' | 'dark'
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('system')
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode)
    } catch {
      /* private browsing */
    }
    const isDark = resolveDark(mode)
    applyThemeClass(isDark)
    setResolvedTheme(isDark ? 'dark' : 'light')
  }, [])

  useEffect(() => {
    let stored: ThemeMode = 'system'
    try {
      const raw = localStorage.getItem(THEME_STORAGE_KEY)
      if (raw === 'light' || raw === 'dark' || raw === 'system') {
        stored = raw
      }
    } catch {
      /* ignore */
    }
    setThemeState(stored)
    const isDark = resolveDark(stored)
    applyThemeClass(isDark)
    setResolvedTheme(isDark ? 'dark' : 'light')
  }, [])

  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      const isDark = mq.matches
      applyThemeClass(isDark)
      setResolvedTheme(isDark ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const value = useMemo(
    () => ({ theme, setTheme, resolvedTheme }),
    [theme, setTheme, resolvedTheme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return ctx
}

/** Inline script for root layout — prevents flash of wrong theme. */
export const themeInitScript = `(function(){try{var k='${THEME_STORAGE_KEY}';var t=localStorage.getItem(k);var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`
