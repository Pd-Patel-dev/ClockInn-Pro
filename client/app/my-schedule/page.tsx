'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import logger from '@/lib/logger'
import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  isSameDay,
  parseISO,
  isSameWeek,
} from 'date-fns'
import { parseTime24, toTime12h } from '@/lib/time'
import { InfoTip } from '@/components/ui/InfoTip'

interface Shift {
  id: string
  employee_id: string
  employee_name: string
  shift_date: string
  start_time: string
  end_time: string
  break_minutes: number
  status: string
  notes?: string
}

function formatTime12h(timeStr: string) {
  const t = toTime12h(timeStr)
  const m = String(t.minute).padStart(2, '0')
  return `${t.hour12}:${m} ${t.ampm}`
}

/** Full shift duration in hours (overnight-aware), after break. */
function shiftNetHours(shift: Shift): number {
  const startParsed = parseTime24(shift.start_time)
  const endParsed = parseTime24(shift.end_time)
  if (!startParsed || !endParsed) return 0
  let endMins = endParsed.hour * 60 + endParsed.minute
  const startMins = startParsed.hour * 60 + startParsed.minute
  if (endMins <= startMins) endMins += 24 * 60
  const total = endMins - startMins - (shift.break_minutes || 0)
  return Math.max(0, total) / 60
}

function formatHoursLabel(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0h'
  const rounded = Math.round(hours * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`
}

function statusStyles(status: string): string {
  switch (status.toUpperCase()) {
    case 'PUBLISHED':
      return 'text-blue-700 bg-blue-50'
    case 'APPROVED':
      return 'text-emerald-700 bg-emerald-50'
    case 'DRAFT':
      return 'text-amber-700 bg-amber-50'
    case 'CANCELLED':
      return 'text-red-700 bg-red-50'
    default:
      return 'text-slate-600 bg-slate-100'
  }
}

function statusLabel(status: string): string {
  const s = status || ''
  return s.charAt(0) + s.slice(1).toLowerCase()
}

type ShiftPeriod = 'morning' | 'noon' | 'overnight'

/** Classify by start time; overnight if the shift crosses midnight. */
function getShiftPeriod(shift: Shift): ShiftPeriod {
  const start = parseTime24(shift.start_time)
  const end = parseTime24(shift.end_time)
  if (!start || !end) return 'noon'
  if (end.hour * 60 + end.minute <= start.hour * 60 + start.minute) return 'overnight'
  if (start.hour >= 17) return 'overnight'
  if (start.hour < 11) return 'morning'
  return 'noon'
}

const SHIFT_PERIOD_STYLES: Record<
  ShiftPeriod,
  { card: string; label: string; chip: string; title: string }
> = {
  morning: {
    title: 'Morning',
    card: 'border-amber-200 bg-amber-50 text-amber-950',
    label: 'text-amber-800/70',
    chip: 'bg-amber-100/80 text-amber-800',
  },
  noon: {
    title: 'Noon',
    card: 'border-sky-200 bg-sky-50 text-sky-950',
    label: 'text-sky-800/70',
    chip: 'bg-sky-100/80 text-sky-800',
  },
  overnight: {
    title: 'Overnight',
    card: 'border-slate-300 bg-slate-100 text-slate-900',
    label: 'text-slate-600',
    chip: 'bg-slate-200/80 text-slate-700',
  },
}

export default function MySchedulePage() {
  const toast = useToast()
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [currentWeek, setCurrentWeek] = useState(new Date())

  const weekStart = useMemo(() => startOfWeek(currentWeek, { weekStartsOn: 1 }), [currentWeek])
  const weekEnd = useMemo(() => endOfWeek(currentWeek, { weekStartsOn: 1 }), [currentWeek])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const isCurrentWeek = isSameWeek(currentWeek, new Date(), { weekStartsOn: 1 })

  const fetchShifts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('start_date', format(weekStart, 'yyyy-MM-dd'))
      params.append('end_date', format(weekEnd, 'yyyy-MM-dd'))
      const response = await api.get(`/shifts?${params.toString()}`)
      setShifts(response.data || [])
    } catch (error) {
      logger.error('Failed to fetch shifts', error as Error)
      toast.error('Failed to load schedule')
    } finally {
      setLoading(false)
    }
  }, [weekStart, weekEnd, toast])

  useEffect(() => {
    fetchShifts()
  }, [fetchShifts])

  /** Place each shift on its start day only (overnight stays as one card). */
  const getShiftsForDay = (date: Date): Shift[] => {
    return shifts
      .filter((shift) => {
        try {
          return isSameDay(parseISO(shift.shift_date), date)
        } catch {
          return false
        }
      })
      .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
  }

  /** Shifts whose shift_date falls in this week (for summary; avoid double-count overnight). */
  const weekShifts = useMemo(() => {
    return shifts.filter((s) => {
      try {
        const d = parseISO(s.shift_date)
        return d >= weekStart && d <= weekEnd
      } catch {
        return false
      }
    })
  }, [shifts, weekStart, weekEnd])

  const summary = useMemo(() => {
    const totalShifts = weekShifts.length
    const approved = weekShifts.filter((s) => s.status.toUpperCase() === 'APPROVED').length
    const totalHours = weekShifts.reduce((sum, s) => sum + shiftNetHours(s), 0)
    return { totalShifts, approved, totalHours }
  }, [weekShifts])

  const weekRangeLabel = `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`

  return (
    <Layout>
      <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-0">
        {/* Header + week nav */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">My Schedule</h1>
            <p className="mt-1 text-sm text-slate-500">{weekRangeLabel}</p>
          </div>
          <div className="inline-flex items-center gap-1 self-start rounded-xl border border-slate-200/80 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              aria-label="Previous week"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setCurrentWeek(new Date())}
              disabled={isCurrentWeek}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-default disabled:text-sky-700 disabled:hover:bg-transparent"
            >
              This week
            </button>
            <button
              type="button"
              onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              aria-label="Next week"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </header>

        {/* Week summary strip */}
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-y border-slate-200/80 py-5">
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Shifts</p>
              {loading ? (
                <div className="mt-2 h-8 w-10 animate-pulse rounded bg-slate-200" />
              ) : (
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
                  {summary.totalShifts}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Hours</p>
              {loading ? (
                <div className="mt-2 h-8 w-14 animate-pulse rounded bg-slate-200" />
              ) : (
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
                  {formatHoursLabel(summary.totalHours)}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Approved</p>
              {loading ? (
                <div className="mt-2 h-8 w-10 animate-pulse rounded bg-slate-200" />
              ) : (
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-emerald-700">
                  {summary.approved}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-amber-300" /> Morning
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-sky-300" /> Noon
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-slate-400" /> Overnight
            </span>
            <InfoTip
              label="About shift colors"
              content="Morning: starts before 11 AM. Noon: starts 11 AM–5 PM. Overnight: crosses midnight or starts at/after 5 PM."
            />
          </div>
        </div>

        {/* Week grid */}
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <div className="min-w-[1260px]">
              {/* Day headers */}
              <div className="grid grid-cols-7 border-b border-slate-200/80">
                {weekDays.map((day) => {
                  const isToday = isSameDay(day, new Date())
                  return (
                    <div
                      key={day.toISOString()}
                      className={
                        isToday
                          ? 'min-w-[180px] border-t-[3px] border-t-sky-400 bg-sky-50/80 px-3 py-3 text-center'
                          : 'min-w-[180px] border-t-[3px] border-t-transparent px-3 py-3 text-center'
                      }
                    >
                      <p
                        className={
                          isToday
                            ? 'text-[11px] font-semibold uppercase tracking-wider text-sky-600'
                            : 'text-[11px] font-semibold uppercase tracking-wider text-slate-400'
                        }
                      >
                        {isToday ? 'Today' : format(day, 'EEE')}
                      </p>
                      <p
                        className={
                          isToday
                            ? 'mx-auto mt-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-sky-500 text-sm font-semibold text-white'
                            : 'mt-1.5 text-lg font-semibold tabular-nums text-slate-900'
                        }
                      >
                        {format(day, 'd')}
                      </p>
                    </div>
                  )
                })}
              </div>

              {/* Day columns */}
              <div className="grid grid-cols-7">
                {loading
                  ? weekDays.map((day) => (
                      <div
                        key={`skel-${day.toISOString()}`}
                        className="min-h-[280px] min-w-[180px] space-y-2 border-r border-slate-100 p-3 last:border-r-0"
                      >
                        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
                        <div className="h-12 animate-pulse rounded-xl bg-slate-50" />
                      </div>
                    ))
                  : weekDays.map((day) => {
                      const dayShifts = getShiftsForDay(day)
                      const isToday = isSameDay(day, new Date())
                      return (
                        <div
                          key={day.toISOString()}
                          className={
                            isToday
                              ? 'min-h-[280px] min-w-[180px] border-r border-sky-100 bg-sky-50/40 p-3 last:border-r-0'
                              : 'min-h-[280px] min-w-[180px] border-r border-slate-100 bg-white p-3 last:border-r-0'
                          }
                        >
                          {dayShifts.length === 0 ? (
                            <p className="px-1 py-6 text-center text-xs font-medium text-slate-300">Off</p>
                          ) : (
                            <div className="space-y-2.5">
                              {dayShifts.map((shift) => {
                                const period = getShiftPeriod(shift)
                                const periodStyle = SHIFT_PERIOD_STYLES[period]
                                const hoursLabel = formatHoursLabel(shiftNetHours(shift))
                                const muted =
                                  shift.status.toUpperCase() === 'CANCELLED' ||
                                  shift.status.toUpperCase() === 'DRAFT'

                                return (
                                  <div
                                    key={shift.id}
                                    className={`rounded-xl border px-2.5 py-2.5 shadow-sm ${periodStyle.card} ${muted ? 'opacity-70' : ''}`}
                                  >
                                    <p className="whitespace-nowrap text-[12px] font-medium tabular-nums leading-tight">
                                      {formatTime12h(shift.start_time)}
                                      <span className="mx-1 opacity-40">–</span>
                                      {formatTime12h(shift.end_time)}
                                    </p>
                                    <div className="mt-1.5 flex items-center justify-between gap-2">
                                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                        <span
                                          className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusStyles(shift.status)}`}
                                        >
                                          {statusLabel(shift.status)}
                                        </span>
                                        <span
                                          className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ${periodStyle.chip}`}
                                        >
                                          {periodStyle.title}
                                        </span>
                                      </div>
                                      <span className="shrink-0 text-[12px] font-semibold tabular-nums">
                                        {hoursLabel}
                                      </span>
                                    </div>

                                    {shift.break_minutes > 0 && (
                                      <p className={`mt-1 text-[10px] ${periodStyle.label}`}>
                                        {shift.break_minutes}m break
                                      </p>
                                    )}
                                    {shift.notes && (
                                      <p
                                        className={`mt-1 truncate text-[10px] italic ${periodStyle.label}`}
                                        title={shift.notes}
                                      >
                                        {shift.notes}
                                      </p>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
              </div>
            </div>
          </div>
        </div>

        {!loading && weekShifts.length === 0 && (
          <p className="text-center text-sm text-slate-400">No shifts scheduled this week.</p>
        )}
      </div>
    </Layout>
  )
}
