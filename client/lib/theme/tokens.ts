/** Design tokens — mirror CSS variables in globals.css for use in JS (charts, etc.). */

export const themeTokens = {
  radii: {
    control: '0.375rem', // 6px — inputs, buttons sm
    card: '0.75rem', // 12px — cards
    pill: '9999px',
  },
  spacing: {
    unit: 4,
    rhythm: [8, 12, 16, 24, 32, 48] as const,
  },
  motion: {
    fast: 150,
    normal: 200,
    slow: 300,
  },
  typography: {
    scale: {
      xs: '0.75rem', // 12
      sm: '0.875rem', // 14
      base: '1rem', // 16
      lg: '1.25rem', // 20
      xl: '1.5rem', // 24
      '2xl': '2rem', // 32
    },
  },
} as const

export type ThemeMode = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'clockinn-theme'
