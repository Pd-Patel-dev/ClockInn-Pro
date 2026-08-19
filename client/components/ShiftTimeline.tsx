'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO, addDays } from 'date-fns'
import { getEmployeeColor } from '@/lib/employeeColors'
import { parseTime24 } from '@/lib/time'
import type { CSSProperties } from 'react'

const HOUR_HEIGHT = 30
const SLOT_HEIGHT = HOUR_HEIGHT * 4 // 4-hour slot = 120px
const TOTAL_HEIGHT = 24 * HOUR_HEIGHT // 720px; always 24h so overnight shifts fit
const TIME_COL_WIDTH = 48
const HEADER_HEIGHT = 44
const SHIFT_MIN_HEIGHT = 24
const SHIFT_GAP = 3
const TOOLTIP_OFFSET = 8
const TOOLTIP_PADDING = 12
const TOOLTIP_MAX_WIDTH = 240
const TOOLTIP_EST_HEIGHT = 90

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

function normalizeShift(shift: ShiftForTimeline): {
  startAt: Date
  endAt: Date
  durationMinutes: number
  invalid: boolean
} {
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
  return realHour === 0
    ? '12a'
    : realHour < 12
      ? `${realHour}a`
      : realHour === 12
        ? '12p'
        : `${realHour - 12}p`
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
  /** When true, clicking a block toggles selection instead of opening the shift. */
  selectionMode?: boolean
  selectedIds?: ReadonlySet<string> | string[]
  onToggleSelect?: (shiftId: string) => void
}

const EVEN_DISPLAY_HOURS = [0, 4, 8, 12, 16, 20]

function isIdSelected(selectedIds: ReadonlySet<string> | string[] | undefined, id: string) {
  if (!selectedIds) return false
  if (selectedIds instanceof Set) return selectedIds.has(id)
  return selectedIds.includes(id)
}

export function ShiftTimeline({
  shifts,
  weekDays,
  onShiftClick,
  loading,
  today,
  dayStartHour = 7,
  dayEndHour = 7,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
}: ShiftTimelineProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [tooltipAnchor, setTooltipAnchor] = useState<DOMRect | null>(null)
  const todayKey = today ? format(today, 'yyyy-MM-dd') : null

  const tooltipStyle = useMemo((): CSSProperties => {
    if (typeof window === 'undefined' || !tooltipAnchor) {
      return { left: TOOLTIP_PADDING, top: 100 }
    }
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
        if (!byDay.has(startKey)) byDay.set(startKey, [])
        byDay.get(startKey)!.push({
          shift,
          dayKey: startKey,
          displayStart: startAt,
          displayEnd: endOfTimeline,
          durationMinutes: (endOfTimeline.getTime() - startAt.getTime()) / (1000 * 60),
          isContinuation: false,
        })
        const startOfNextDay = dayEndsNextMorning
          ? new Date(endOfTimeline)
          : (() => {
              const d = new Date(endAt)
              d.setHours(0, 0, 0, 0)
              return d
            })()
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
      <div className="bg-white p-4 min-h-[400px]">
        <div className="h-[480px] animate-pulse rounded-lg bg-slate-100" />
      </div>
    )
  }

  return (
    <div className="overflow-x-auto overflow-y-auto bg-white">
      <div className="flex w-full min-w-0" style={{ minHeight: TOTAL_HEIGHT + HEADER_HEIGHT }}>
        <div
          className="flex-shrink-0 sticky left-0 z-20 border-r border-slate-200 bg-white"
          style={{ width: TIME_COL_WIDTH }}
        >
          <div className="border-b border-slate-200" style={{ height: HEADER_HEIGHT }} />
          <div className="relative" style={{ height: TOTAL_HEIGHT }}>
            {EVEN_DISPLAY_HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 flex items-start justify-end pr-2 pt-0.5 border-t border-slate-100"
                style={{ top: hour * HOUR_HEIGHT, height: SLOT_HEIGHT }}
              >
                <span className="text-[11px] tabular-nums text-slate-400">
                  {displayHourToLabel(hour, dayStartHour)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {weekDays.map((day) => {
          const dayKey = format(day, 'yyyy-MM-dd')
          const dayShifts = shiftsByDay.get(dayKey) ?? []
          const laneIndices = lanesByDay.get(dayKey) ?? []
          const totalLanes = dayShifts.length ? Math.max(...laneIndices) + 1 : 1
          const isToday = dayKey === todayKey

          return (
            <div
              key={dayKey}
              className="flex-1 min-w-0 relative border-r border-slate-100 last:border-r-0 bg-white"
              style={{
                height: TOTAL_HEIGHT + HEADER_HEIGHT,
                overflow: 'visible',
                minWidth: 72,
              }}
            >
              <div
                className="sticky top-0 z-10 flex flex-col items-center justify-center border-b border-slate-200 bg-white"
                style={{ height: HEADER_HEIGHT }}
              >
                <span className="text-[10px] font-medium uppercase text-slate-400">
                  {format(day, 'EEE')}
                </span>
                {isToday ? (
                  <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white tabular-nums">
                    {format(day, 'd')}
                  </span>
                ) : (
                  <span className="mt-0.5 text-sm font-semibold text-slate-700 tabular-nums">
                    {format(day, 'd')}
                  </span>
                )}
              </div>

              <div className="relative overflow-visible" style={{ height: TOTAL_HEIGHT }}>
                {(invalidShiftsByDay.get(dayKey) ?? []).length > 0 && (
                  <div
                    className="absolute top-1.5 left-1.5 right-1.5 z-10 rounded px-1.5 py-1 text-[10px] font-medium bg-amber-50 text-amber-800"
                    title={`${(invalidShiftsByDay.get(dayKey) ?? []).length} shift(s) with invalid or missing time`}
                  >
                    Invalid time
                  </div>
                )}

                {EVEN_DISPLAY_HOURS.slice(1).map((hour) => (
                  <div
                    key={hour}
                    className="absolute left-0 right-0 border-t border-slate-100"
                    style={{ top: hour * HOUR_HEIGHT }}
                  />
                ))}

                {dayShifts.map((seg, idx) => {
                  const { shift, displayStart, displayEnd, isContinuation } = seg
                  let startDisplayH = displayHoursFromDate(displayStart, dayStartHour)
                  let endDisplayH = displayHoursFromDate(displayEnd, dayStartHour)
                  if (endDisplayH <= startDisplayH) endDisplayH += 24
                  const top = startDisplayH * HOUR_HEIGHT + SHIFT_GAP / 2
                  const height = Math.max(
                    (endDisplayH - startDisplayH) * HOUR_HEIGHT - SHIFT_GAP,
                    SHIFT_MIN_HEIGHT
                  )
                  const lane = laneIndices[idx] ?? 0
                  const leftPct = (lane / totalLanes) * 100
                  const widthPct = (1 / totalLanes) * 100
                  const colors = getEmployeeColor(shift.employee_id)
                  const isHovered = hoveredId === shift.id
                  const isSelected = isIdSelected(selectedIds, shift.id)

                  return (
                    <div
                      key={`${shift.id}-${seg.dayKey}-${isContinuation ? 'cont' : 'start'}-${idx}`}
                      className={`absolute rounded-md cursor-pointer overflow-hidden px-1.5 py-1 border border-black/5 ${
                        isSelected
                          ? 'ring-2 ring-slate-900 ring-offset-1 z-20'
                          : isHovered
                            ? 'ring-1 ring-slate-400 z-20'
                            : 'z-[5]'
                      }`}
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        left: `calc(${leftPct}% + ${SHIFT_GAP / 2}px)`,
                        width: `calc(${widthPct}% - ${SHIFT_GAP}px)`,
                        minWidth: 20,
                        backgroundColor: colors.bg,
                        color: colors.text,
                        boxShadow: `inset 3px 0 0 0 ${colors.border}`,
                      }}
                      onClick={() => {
                        if (selectionMode) {
                          onToggleSelect?.(shift.id)
                          return
                        }
                        onShiftClick?.(shift)
                      }}
                      onMouseEnter={(e) => {
                        setHoveredId(shift.id)
                        setTooltipAnchor(e.currentTarget.getBoundingClientRect())
                      }}
                      onMouseLeave={() => {
                        setHoveredId(null)
                        setTooltipAnchor(null)
                      }}
                    >
                      {isSelected && (
                        <span className="absolute top-0.5 right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-900 text-white">
                          <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      )}
                      <div className="font-medium text-[11px] truncate leading-tight pr-3">
                        {shift.employee_name}
                      </div>
                      {height >= 36 && (
                        <div className="text-[10px] opacity-80 tabular-nums truncate mt-0.5">
                          {isContinuation
                            ? `– ${format(displayEnd, 'h:mma').toLowerCase()}`
                            : `${format(displayStart, 'h:mma').toLowerCase()}–${format(displayEnd, 'h:mma').toLowerCase()}`}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {hoveredId &&
        typeof document !== 'undefined' &&
        createPortal(
          (() => {
            const shift = shifts.find((s) => s.id === hoveredId)
            if (!shift) return null
            const norm = normalizeShift(shift)
            if (norm.invalid) {
              return (
                <div
                  className="fixed z-[100] pointer-events-none rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg max-w-[240px]"
                  style={tooltipStyle}
                >
                  <div className="text-sm font-medium text-slate-900">{shift.employee_name}</div>
                  <div className="text-xs text-amber-700 mt-1">Invalid time</div>
                </div>
              )
            }
            const { startAt, endAt, durationMinutes } = norm
            return (
              <div
                className="fixed z-[100] pointer-events-none rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg max-w-[240px]"
                style={tooltipStyle}
              >
                <div className="text-sm font-medium text-slate-900">{shift.employee_name}</div>
                <div className="text-xs text-slate-500 mt-1 tabular-nums">
                  {format(startAt, 'EEE MMM d · h:mm a')} – {format(endAt, 'h:mm a')}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {durationMinutes >= 60
                    ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`
                    : `${durationMinutes}m`}
                  {shift.job_role ? ` · ${shift.job_role}` : ''}
                </div>
              </div>
            )
          })(),
          document.body
        )}
    </div>
  )
}
