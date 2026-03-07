/**
 * Parse a time string as 24-hour (HH:MM or HH:MM:SS).
 * Use this for shift start_time/end_time from the API to avoid 12h/24h mix-ups.
 * @returns { hour: 0-23, minute: 0-59 } or null if invalid
 */
export function parseTime24(timeStr: string | undefined): { hour: number; minute: number } | null {
  if (!timeStr || typeof timeStr !== 'string') return null
  const s = timeStr.trim()
  const match = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!match) return null
  const hour = parseInt(match[1], 10)
  const minute = parseInt(match[2], 10)
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

/**
 * Normalize time for API: ensure HH:mm 24-hour (e.g. 23:00 for 11 PM, 07:00 for 7 AM).
 * Use when sending start_time/end_time to create/update shift.
 */
export function toApiTime24(value: string | undefined): string {
  const parsed = parseTime24(value ?? '')
  if (!parsed) return '00:00'
  const h = String(parsed.hour).padStart(2, '0')
  const m = String(parsed.minute).padStart(2, '0')
  return `${h}:${m}`
}

/** 12-hour representation for display/input */
export interface Time12h {
  hour12: number  // 1-12
  minute: number // 0-59
  ampm: 'AM' | 'PM'
}

/** Convert 24h (HH:mm) to 12h for display */
export function toTime12h(value: string | undefined): Time12h {
  const parsed = parseTime24(value ?? '')
  if (!parsed) return { hour12: 12, minute: 0, ampm: 'AM' }
  const { hour, minute } = parsed
  if (hour === 0) return { hour12: 12, minute, ampm: 'AM' }
  if (hour === 12) return { hour12: 12, minute, ampm: 'PM' }
  if (hour < 12) return { hour12: hour, minute, ampm: 'AM' }
  return { hour12: hour - 12, minute, ampm: 'PM' }
}

/** Convert 12h (from UI) to 24h HH:mm for API */
export function fromTime12h(t: Time12h): string {
  let hour24: number
  if (t.ampm === 'AM') {
    hour24 = t.hour12 === 12 ? 0 : t.hour12
  } else {
    hour24 = t.hour12 === 12 ? 12 : t.hour12 + 12
  }
  const h = String(hour24).padStart(2, '0')
  const m = String(Math.min(59, Math.max(0, t.minute))).padStart(2, '0')
  return `${h}:${m}`
}

/**
 * Safely format an ISO date-time string for display (shift notes, common log).
 * Uses the browser's local timezone. Returns fallback if value is null, undefined, or invalid.
 */
export function formatDateTimeForDisplay(
  value: string | null | undefined,
  fallback: string = '—'
): string {
  if (value == null || value === '') return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  const pad = (n: number) => String(n).padStart(2, '0')
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = monthNames[date.getMonth()]
  const day = date.getDate()
  const year = date.getFullYear()
  let hours = date.getHours()
  const minutes = date.getMinutes()
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12 || 12
  const timeStr = `${hours}:${pad(minutes)} ${ampm}`
  return `${month} ${day}, ${year} at ${timeStr}`
}

/**
 * Safely format an ISO date-time as time only (e.g. "2:30 PM") for display.
 */
export function formatTimeOnly(value: string | null | undefined, fallback: string = '—'): string {
  if (value == null || value === '') return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  const pad = (n: number) => String(n).padStart(2, '0')
  let hours = date.getHours()
  const minutes = date.getMinutes()
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12 || 12
  return `${hours}:${pad(minutes)} ${ampm}`
}
