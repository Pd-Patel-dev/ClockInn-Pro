'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO, addDays } from 'date-fns'
import { getEmployeeColor } from '@/lib/employeeColors'
import { parseTime24 } from '@/lib/time'
import type { CSSProperties } from 'react'

const HOUR_HEIGHT = 30
const SLOT_HEIGHT = HOUR_HEIGHT * 2 // 2-hour slot = 60px
const TOTAL_HEIGHT = 24 * HOUR_HEIGHT // 720px; always 24h so overnight shifts fit
const TIME_COL_WIDTH = 52
const HEADER_HEIGHT = 44
const SHIFT_MIN_HEIGHT = 24
const SHIFT_GAP = 3
const TOOLTIP_OFFSET = 8
const TOOLTIP_PADDING = 12
const TOOLTIP_MAX_WIDTH = 280
const TOOLTIP_EST_HEIGHT = 140

export interface ShiftForTimeline {
  id: string
  employee_id: string
  employee_name: string
  shift_date: string
  start_time: string
  end_time: string
  break_minutes?: number
  status?: string
  job_role?: string
  notes?: string
}

function normalizeShift(shift: ShiftForTimeline): { startAt: Date; endAt: Date; durationMinutes: number; invalid: boolean } {
  const shiftDate = parseISO(shift.shift_date)
  const startParsed = parseTime24(shift.start_time)
  const endParsed = parseTime24(shift.end_time)
  if (!startParsed || !endParsed) {
    const fallback = new Date(shiftDate)
    fallback.setHours(0, 0, 0, 0)
    return { startAt: fallback, endAt: addDays(fallback, 1), durationMinutes: 0, invalid: true }
  }
  const startAt = new Date(shiftDate)
  startAt.setHours(startParsed.hour, startParsed.minute, 0, 0)
  let endAt = new Date(shiftDate)
  endAt.setHours(endParsed.hour, endParsed.minute, 0, 0)
  if (endAt <= startAt) endAt = addDays(endAt, 1)
  const durationMinutes = (endAt.getTime() - startAt.getTime()) / (1000 * 60)
  return { startAt, endAt, durationMinutes, invalid: false }
}

function hoursFromMidnight(d: Date): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
}

/** Hours from dayStart for display axis: dayStart = 0, dayStart+1 = 1, ... (wraps at 24) */
function displayHoursFromDate(d: Date, dayStartHour: number): number {
  const h = hoursFromMidnight(d)
  return (h - dayStartHour + 24) % 24
}

/** Label for display hour slot given day start: 0 -> "7a", 2 -> "9a", ... */
function displayHourToLabel(displayHour: number, dayStartHour: number): string {
  const realHour = (displayHour + dayStartHour) % 24
  return realHour === 0 ? '12a' : realHour < 12 ? `${realHour}a` : realHour === 12 ? '12p' : `${realHour - 12}p`
}

function isNightShift(shift: ShiftForTimeline, startAt: Date, endAt: Date): boolean {
  const startH = startAt.getHours() + startAt.getMinutes() / 60
  const endH = endAt.getHours() + endAt.getMinutes() / 60
  if (endAt.getTime() > startAt.getTime() + 12 * 60 * 60 * 1000) return true
  return startH >= 22 || startH < 6 || endH < 6
}

/** Assign each shift a lane index (0-based) so overlaps are side-by-side */
function computeLanes(shiftsInDay: { startAt: Date; endAt: Date }[]): number[] {
  if (shiftsInDay.length === 0) return []
  const sorted = [...shiftsInDay].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
  const lanes: number[] = []
  const endTimes: number[] = []

  for (const s of sorted) {
    const start = s.startAt.getTime()
    let lane = 0
    while (lane < endTimes.length && endTimes[lane] > start) lane++
    if (lane === endTimes.length) endTimes.push(s.endAt.getTime())
    else endTimes[lane] = s.endAt.getTime()
    lanes.push(lane)
  }
  return lanes
}

interface ShiftTimelineProps {
  shifts: ShiftForTimeline[]
  weekDays: Date[]
  onShiftClick?: (shift: ShiftForTimeline) => void
  loading?: boolean
  today?: Date
  /** Hour (0-23) when the schedule day starts (e.g. 7 = 7 AM). From company settings. */
  dayStartHour?: number
  /** Hour (0-23) when the schedule day ends (same as start = 24h day). From company settings. */
  dayEndHour?: number
}

const EVEN_DISPLAY_HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]

export function ShiftTimeline({ shifts, weekDays, onShiftClick, loading, today, dayStartHour = 7, dayEndHour = 7 }: ShiftTimelineProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [tooltipAnchor, setTooltipAnchor] = useState<DOMRect | null>(null)
  const todayKey = today ? format(today, 'yyyy-MM-dd') : null

  const tooltipStyle = useMemo((): CSSProperties => {
    if (typeof window === 'undefined' || !tooltipAnchor) {
      return { left: TOOLTIP_PADDING, top: 100 }
    }
    // Keep tooltip next to the block; only clamp when it would go off viewport
    let left = tooltipAnchor.left
    let top = tooltipAnchor.bottom + TOOLTIP_OFFSET
    const maxLeft = window.innerWidth - TOOLTIP_MAX_WIDTH - TOOLTIP_PADDING
    const maxTop = window.innerHeight - TOOLTIP_EST_HEIGHT - TOOLTIP_PADDING
    if (left > maxLeft) left = maxLeft
    if (left < TOOLTIP_PADDING) left = TOOLTIP_PADDING
    if (top > maxTop) top = Math.max(TOOLTIP_PADDING, tooltipAnchor.top - TOOLTIP_EST_HEIGHT - TOOLTIP_OFFSET)
    if (top < TOOLTIP_PADDING) top = TOOLTIP_PADDING
    return { left, top }
  }, [tooltipAnchor])

  /** Break when the timeline (schedule day) ends; continuation moves to next day. Otherwise one block. */
  interface ShiftSegment {
    shift: ShiftForTimeline
    dayKey: string
    displayStart: Date
    displayEnd: Date
    durationMinutes: number
    isContinuation: boolean
  }

  const shiftsByDayResult = useMemo(() => {
    const byDay = new Map<string, ShiftSegment[]>()
    const invalidByDay = new Map<string, ShiftForTimeline[]>()
    for (const shift of shifts) {
      const norm = normalizeShift(shift)
      if (norm.invalid) {
        const dayKey = shift.shift_date
        if (!invalidByDay.has(dayKey)) invalidByDay.set(dayKey, [])
        invalidByDay.get(dayKey)!.push(shift)
        continue
      }
      const { startAt, endAt, durationMinutes } = norm
      const startKey = format(startAt, 'yyyy-MM-dd')

      // Timeline end: when day ends at 7 AM, the day runs 7 AM → 7 AM next day (no date change, no break for overnight within that).
      // When day ends in evening (e.g. 11 PM), timeline ends same date at dayEndHour:59:59.
      const endOfTimeline = new Date(startAt)
      const dayEndsNextMorning = dayEndHour <= dayStartHour
      if (dayEndsNextMorning) {
        endOfTimeline.setDate(endOfTimeline.getDate() + 1)
        endOfTimeline.setHours(dayEndHour, 0, 0, 0)
      } else {
        endOfTimeline.setHours(dayEndHour, 59, 59, 999)
      }

      const extendsPastTimeline = endAt.getTime() > endOfTimeline.getTime()

      if (extendsPastTimeline) {
        // Break at timeline end: first block on start day, second on next day
        if (!byDay.has(startKey)) byDay.set(startKey, [])
        byDay.get(startKey)!.push({
          shift,
          dayKey: startKey,
          displayStart: startAt,
          displayEnd: endOfTimeline,
          durationMinutes: (endOfTimeline.getTime() - startAt.getTime()) / (1000 * 60),
          isContinuation: false,
        })
        // Continuation: after timeline end → next day column (at timeline end time, e.g. 7 AM or midnight)
        const startOfNextDay = dayEndsNextMorning ? new Date(endOfTimeline) : (() => { const d = new Date(endAt); d.setHours(0, 0, 0, 0); return d })()
        const contKey = format(startOfNextDay, 'yyyy-MM-dd')
        if (!byDay.has(contKey)) byDay.set(contKey, [])
        byDay.get(contKey)!.push({
          shift,
          dayKey: contKey,
          displayStart: startOfNextDay,
          displayEnd: endAt,
          durationMinutes: (endAt.getTime() - startOfNextDay.getTime()) / (1000 * 60),
          isContinuation: true,
        })
      } else {
        // Stays within timeline: one block on start date (no date change, no break)
        if (!byDay.has(startKey)) byDay.set(startKey, [])
        byDay.get(startKey)!.push({
          shift,
          dayKey: startKey,
          displayStart: startAt,
          displayEnd: endAt,
          durationMinutes,
          isContinuation: false,
        })
      }
    }
    for (const arr of byDay.values()) {
      arr.sort((a, b) => a.displayStart.getTime() - b.displayStart.getTime())
    }
    return { shiftsByDay: byDay, invalidShiftsByDay: invalidByDay }
  }, [shifts, dayStartHour, dayEndHour])

  const { shiftsByDay, invalidShiftsByDay } = shiftsByDayResult

  const lanesByDay = useMemo(() => {
    const lanes = new Map<string, number[]>()
    shiftsByDay.forEach((arr, dayKey) => {
      lanes.set(
        dayKey,
        computeLanes(arr.map((x) => ({ startAt: x.displayStart, endAt: x.displayEnd })))
      )
    })
    return lanes
  }, [shiftsByDay])

  if (loading) {
    return (
      <div className="bg-white/60 backdrop-blur-xl rounded-2xl border border-white/50 shadow-[0_8px_32px_rgba(0,0,0,0.06)] p-16 flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-500/60 border-t-transparent" />
        <span className="ml-3 text-sm font-medium text-gray-600">Loading shifts...</span>
      </div>
    )
  }

  return (
    <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-white/60 shadow-[0_8px_32px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.8)] overflow-y-auto overflow-x-auto">
      <div className="flex w-full min-w-0 pb-8" style={{ minHeight: TOTAL_HEIGHT + HEADER_HEIGHT }}>
        {/* Time column - clear 2-hour slots */}
        <div
          className="flex-shrink-0 sticky left-0 z-20 border-r border-gray-200/70 bg-gray-50/90"
          style={{ width: TIME_COL_WIDTH }}
        >
          <div
            className="flex items-center justify-center border-b border-gray-200/70 bg-white/90 text-[10px] font-semibold uppercase tracking-wider text-gray-400"
            style={{ height: HEADER_HEIGHT }}
          >
            Time
          </div>
          <div className="relative" style={{ height: TOTAL_HEIGHT }}>
            {/* Alternating slot background - render first so behind labels */}
            {EVEN_DISPLAY_HOURS.map((hour, i) => (
              <div
                key={`bg-${hour}`}
                className="absolute left-0 right-0 pointer-events-none"
                style={{
                  top: hour * HOUR_HEIGHT,
                  height: SLOT_HEIGHT,
                  backgroundColor: i % 2 === 0 ? 'rgba(248,250,252,0.8)' : 'rgba(241,245,249,0.6)',
                }}
              />
            ))}
            {EVEN_DISPLAY_HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 flex items-center justify-end pr-2 border-t border-gray-200/60 z-10"
                style={{
                  top: hour * HOUR_HEIGHT,
                  height: SLOT_HEIGHT,
                }}
              >
                <span className="text-xs font-medium tabular-nums text-gray-600">
                  {displayHourToLabel(hour, dayStartHour)}
                </span>
              </div>
            ))}
            {/* Overnight band (11p–7a) in time column for consistency */}
            <div
              className="absolute left-0 right-0 pointer-events-none z-0"
              style={{
                top: 16 * HOUR_HEIGHT,
                height: 8 * HOUR_HEIGHT,
                backgroundColor: 'rgba(99, 102, 241, 0.08)',
              }}
              aria-hidden
            />
          </div>
        </div>

        {/* Day columns */}
        {weekDays.map((day) => {
          const dayKey = format(day, 'yyyy-MM-dd')
          const dayShifts = shiftsByDay.get(dayKey) ?? []
          const laneIndices = lanesByDay.get(dayKey) ?? []
          const totalLanes = dayShifts.length ? Math.max(...laneIndices) + 1 : 1
          const isToday = dayKey === todayKey

          return (
            <div
              key={dayKey}
              className={`flex-1 min-w-0 relative border-r border-gray-200/60 last:border-r-0 ${isToday ? 'bg-blue-50/30' : 'bg-white/50'}`}
              style={{
                height: TOTAL_HEIGHT + HEADER_HEIGHT,
                overflow: 'visible',
                minWidth: 72,
              }}
            >
              <div
                className="sticky top-0 z-10 flex flex-col items-center justify-center border-b border-gray-200/70 bg-white/95"
                style={{ height: HEADER_HEIGHT }}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {format(day, 'EEE')}
                </span>
                <span
                  className={`text-base font-bold mt-0.5 ${isToday ? 'text-blue-600' : 'text-gray-900'}`}
                >
                  {format(day, 'd')}
                </span>
              </div>
              <div
                className="relative overflow-visible"
                style={{ height: TOTAL_HEIGHT }}
              >
                {/* Invalid time indicator for shifts that couldn't be parsed */}
                {(invalidShiftsByDay.get(dayKey) ?? []).length > 0 && (
                  <div
                    className="absolute top-2 left-2 right-2 z-10 px-2 py-1.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-medium border border-amber-200/80"
                    title={`${(invalidShiftsByDay.get(dayKey) ?? []).length} shift(s) with invalid or missing time`}
                  >
                    Invalid time
                  </div>
                )}
                {/* Alternating 2-hour slot backgrounds */}
                {EVEN_DISPLAY_HOURS.map((hour, i) => (
                  <div
                    key={hour}
                    className="absolute left-0 right-0 pointer-events-none"
                    style={{
                      top: hour * HOUR_HEIGHT,
                      height: SLOT_HEIGHT,
                      backgroundColor: i % 2 === 0 ? 'rgba(255,255,255,0.4)' : 'rgba(248,250,252,0.5)',
                    }}
                  />
                ))}
                {/* Grid lines at slot boundaries */}
                {EVEN_DISPLAY_HOURS.slice(1).map((hour) => (
                  <div
                    key={hour}
                    className="absolute left-0 right-0 border-t border-gray-200/70"
                    style={{ top: hour * HOUR_HEIGHT }}
                  />
                ))}
                {/* Overnight band (11p–7a): subtle background so after-11pm shifts read clearly */}
                <div
                  className="absolute left-0 right-0 pointer-events-none border-t border-indigo-200/40"
                  style={{
                    top: 16 * HOUR_HEIGHT,
                    height: 8 * HOUR_HEIGHT,
                    backgroundColor: 'rgba(99, 102, 241, 0.06)',
                  }}
                  aria-hidden
                />

                {/* Shift blocks - positioned on 7 AM–7 AM axis */}
                {dayShifts.map((seg, idx) => {
                  const { shift, displayStart, displayEnd, durationMinutes, isContinuation } = seg
                  let startDisplayH = displayHoursFromDate(displayStart, dayStartHour)
                  let endDisplayH = displayHoursFromDate(displayEnd, dayStartHour)
                  if (endDisplayH <= startDisplayH) endDisplayH += 24
                  const top = startDisplayH * HOUR_HEIGHT + SHIFT_GAP / 2
                  const heightHours = endDisplayH - startDisplayH
                  const height = Math.max(heightHours * HOUR_HEIGHT - SHIFT_GAP, SHIFT_MIN_HEIGHT)

                  const lane = laneIndices[idx] ?? 0
                  const leftPct = (lane / totalLanes) * 100
                  const widthPct = (1 / totalLanes) * 100
                  const night = isNightShift(shift, displayStart, displayEnd)
                  const colors = getEmployeeColor(shift.employee_id)
                  const isHovered = hoveredId === shift.id

                  return (
                    <div
                      key={`${shift.id}-${seg.dayKey}-${isContinuation ? 'cont' : 'start'}-${idx}`}
                      className={`absolute rounded-lg cursor-pointer overflow-hidden border border-white/50 shadow-sm
                        transition-all duration-200 ease-out
                        ${isHovered ? 'scale-[1.01] shadow-md ring-2 ring-blue-400/40 ring-inset' : 'scale-100'}`}
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        left: `calc(${leftPct}% + ${SHIFT_GAP / 2}px)`,
                        width: `calc(${widthPct}% - ${SHIFT_GAP}px)`,
                        minWidth: 20,
                        backgroundColor: night ? 'rgba(76, 29, 149, 0.94)' : colors.bg,
                        color: night ? '#e9d5ff' : colors.text,
                        zIndex: isHovered ? 20 : 5,
                      } as CSSProperties}
                      onClick={() => onShiftClick?.(shift)}
                      onMouseEnter={(e) => {
                        setHoveredId(shift.id)
                        setTooltipAnchor(e.currentTarget.getBoundingClientRect())
                      }}
                      onMouseLeave={() => {
                        setHoveredId(null)
                        setTooltipAnchor(null)
                      }}
                    >
                      <div className="flex items-start gap-2 h-full min-h-0 p-2">
                        <div
                          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold bg-white/25"
                          title={shift.employee_name}
                        >
                          {shift.employee_name
                            .split(/\s+/)
                            .map((n) => n[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-xs truncate leading-tight">{shift.employee_name}</div>
                          <div className="text-[10px] opacity-95 leading-snug mt-0.5">
                            {isContinuation ? (
                              <>12a – {format(displayEnd, 'h:mm a')} <span className="opacity-75">(next day)</span></>
                            ) : (
                              <>
                                {format(displayStart, 'h:mm a')} – {format(displayEnd, 'h:mm a')}
                                {format(displayStart, 'yyyy-MM-dd') !== format(displayEnd, 'yyyy-MM-dd') && (
                                  <span className="opacity-75"> (next day)</span>
                                )}
                              </>
                            )}
                          </div>
                          <div className="text-[10px] font-medium opacity-90 mt-0.5">
                            {durationMinutes >= 60 ? `${Math.floor(durationMinutes / 60)}h` : `${durationMinutes}m`}
                            {isContinuation && <span className="opacity-75"> cont.</span>}
                          </div>
                          {shift.job_role && (
                            <div className="text-[9px] opacity-80 truncate mt-0.5">{shift.job_role}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Hover tooltip - rendered in portal so position:fixed is viewport-relative (parent has backdrop-blur) */}
      {hoveredId && typeof document !== 'undefined' && createPortal(
        (() => {
          const shift = shifts.find((s) => s.id === hoveredId)
          if (!shift) return null
          const norm = normalizeShift(shift)
          if (norm.invalid) {
            return (
              <div
                className="fixed z-[100] pointer-events-none bg-white rounded-xl shadow-lg border border-gray-200/80 p-4 max-w-[280px]"
                style={tooltipStyle}
              >
                <div className="font-semibold text-gray-900 text-sm">{shift.employee_name}</div>
                <div className="text-xs text-amber-700 mt-1.5 font-medium">Invalid time</div>
                <div className="text-[11px] text-gray-500 mt-1">Start/end time could not be parsed.</div>
              </div>
            )
          }
          const { startAt, endAt, durationMinutes } = norm
          const night = isNightShift(shift, startAt, endAt)
          return (
            <div
              className="fixed z-[100] pointer-events-none bg-white rounded-xl shadow-lg border border-gray-200/80 p-4 max-w-[280px]"
              style={tooltipStyle}
            >
              <div className="font-semibold text-gray-900 text-sm">{shift.employee_name}</div>
              <div className="text-xs text-gray-600 mt-1.5">
                {format(startAt, 'EEE, MMM d · h:mm a')} – {format(endAt, 'h:mm a')}
              </div>
              <div className="text-xs font-medium text-gray-700 mt-1">
                Total: {durationMinutes >= 60 ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m` : `${durationMinutes}m`}
              </div>
              {shift.job_role && <div className="text-xs text-gray-500 mt-1">{shift.job_role}</div>}
              {night && (
                <span className="inline-block mt-2 px-2 py-1 rounded-md text-xs font-medium bg-purple-100 text-purple-800">
                  Night shift
                </span>
              )}
            </div>
          )
        })(),
        document.body
      )}
    </div>
  )
}
