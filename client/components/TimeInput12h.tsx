'use client'

import { useMemo, useEffect } from 'react'
import { toTime12h, fromTime12h, parseTime24, type Time12h } from '@/lib/time'

const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const MINUTES = Array.from({ length: 60 }, (_, i) => i)

interface TimeInput12hProps {
  value: string
  onChange: (value: string) => void
  id?: string
  label?: string
  className?: string
  disabled?: boolean
}

export default function TimeInput12h({ value, onChange, id, label, className = '', disabled }: TimeInput12hProps) {
  const parsed = useMemo(() => parseTime24(value), [value])
  const invalid = parsed === null
  const t = useMemo(() => toTime12h(value), [value])

  useEffect(() => {
    if (invalid && value !== '00:00') {
      onChange('00:00')
    }
  }, [invalid, value, onChange])

  const handleChange = (next: Partial<Time12h>) => {
    const updated: Time12h = {
      hour12: next.hour12 ?? t.hour12,
      minute: next.minute ?? t.minute,
      ampm: next.ampm ?? t.ampm,
    }
    onChange(fromTime12h(updated))
  }

  if (invalid) {
    return (
      <div className={className}>
        {label && (
          <label htmlFor={id} className="block text-sm font-semibold text-gray-700 mb-1">
            {label}
          </label>
        )}
        <div className="flex items-center gap-1.5 px-2.5 py-2 border border-amber-300 rounded-lg bg-amber-50/80 text-amber-800 text-sm">
          <span className="text-gray-500">— : —</span>
          <span className="text-amber-700 font-medium">Invalid time</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">Defaulting to 12:00 AM</p>
      </div>
    )
  }

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="block text-sm font-semibold text-gray-700 mb-1">
          {label}
        </label>
      )}
      <div className="flex items-center gap-1.5">
        <select
          id={id}
          value={t.hour12}
          onChange={(e) => handleChange({ hour12: Number(e.target.value) })}
          disabled={disabled}
          className="px-2.5 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white min-w-[4rem]"
          aria-label="Hour"
        >
          {HOURS_12.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="text-gray-500 font-medium">:</span>
        <select
          value={t.minute}
          onChange={(e) => handleChange({ minute: Number(e.target.value) })}
          disabled={disabled}
          className="px-2.5 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white min-w-[4rem]"
          aria-label="Minute"
        >
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, '0')}
            </option>
          ))}
        </select>
        <select
          value={t.ampm}
          onChange={(e) => handleChange({ ampm: e.target.value as 'AM' | 'PM' })}
          disabled={disabled}
          className="px-2.5 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white min-w-[4.5rem]"
          aria-label="AM/PM"
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </div>
  )
}
