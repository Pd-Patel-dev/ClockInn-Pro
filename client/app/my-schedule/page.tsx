'use client'

import { useState, useEffect, useMemo } from 'react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import logger from '@/lib/logger'
import { format, startOfWeek, endOfWeek, addDays, addWeeks, subWeeks, isSameDay, parseISO, startOfDay, endOfDay } from 'date-fns'
import { getEmployeeColorStyles, getEmployeeColor } from '@/lib/employeeColors'
import { getCurrentUser, User } from '@/lib/auth'
import type { CSSProperties } from 'react'

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

export default function MySchedulePage() {
  const toast = useToast()
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [currentWeek, setCurrentWeek] = useState(new Date())
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [userLoading, setUserLoading] = useState(true)

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 }) // Monday
  const weekEnd = endOfWeek(currentWeek, { weekStartsOn: 1 }) // Sunday
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  
  // Extend fetch window by 1 day on each side to catch overnight shifts
  const fetchStartDate = useMemo(() => addDays(weekStart, -1), [weekStart])
  const fetchEndDate = useMemo(() => addDays(weekEnd, 1), [weekEnd])

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await getCurrentUser()
        setCurrentUser(user)
      } catch (error) {
        logger.error('Failed to fetch user', error as Error)
      } finally {
        setUserLoading(false)
      }
    }
    fetchUser()
  }, [])

  useEffect(() => {
    if (!userLoading) {
      fetchShifts()
    }
  }, [currentWeek, userLoading])

  const fetchShifts = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('start_date', format(fetchStartDate, 'yyyy-MM-dd'))
      params.append('end_date', format(fetchEndDate, 'yyyy-MM-dd'))
      // Employee ID is automatically filtered by the API based on current user
      const response = await api.get(`/shifts?${params.toString()}`)
      setShifts(response.data || [])
    } catch (error) {
      logger.error('Failed to fetch shifts', error as Error)
      toast.error('Failed to load schedule')
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status.toUpperCase()) {
      case 'PUBLISHED':
        return 'bg-blue-50 text-blue-700 border border-blue-200'
      case 'APPROVED':
        return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
      case 'DRAFT':
        return 'bg-amber-50 text-amber-700 border border-amber-200'
      case 'CANCELLED':
        return 'bg-red-50 text-red-700 border border-red-200'
      default:
        return 'bg-gray-50 text-gray-700 border border-gray-200'
    }
  }

  /**
   * Normalize a shift into absolute datetime intervals.
   * Handles overnight shifts correctly.
   */
  const normalizeShift = (shift: Shift): { startAt: Date; endAt: Date } => {
    const shiftDate = parseISO(shift.shift_date)
    const [startHour, startMinute] = shift.start_time.split(':').map(Number)
    const [endHour, endMinute] = shift.end_time.split(':').map(Number)
    
    const startAt = new Date(shiftDate)
    startAt.setHours(startHour, startMinute, 0, 0)
    
    let endAt = new Date(shiftDate)
    endAt.setHours(endHour, endMinute, 0, 0)
    
    // Handle overnight shifts: if end_time <= start_time, end is on next day
    if (endAt <= startAt) {
      endAt = addDays(endAt, 1)
    }
    
    return { startAt, endAt }
  }

  /**
   * Split an overnight shift into day segments for UI display.
   */
  interface ShiftSegment {
    shift: Shift
    day: Date
    displayStart: Date
    displayEnd: Date
    isSegment: boolean
    segmentIndex?: number
  }
  
  const splitShiftForDisplay = (shift: Shift): ShiftSegment[] => {
    const { startAt, endAt } = normalizeShift(shift)
    const shiftDate = parseISO(shift.shift_date)
    
    const isOvernight = !isSameDay(startAt, endAt)
    
    if (!isOvernight) {
      return [{
        shift,
        day: shiftDate,
        displayStart: startAt,
        displayEnd: endAt,
        isSegment: false,
      }]
    }
    
    const endOfStartDay = endOfDay(shiftDate)
    const startOfEndDay = startOfDay(addDays(shiftDate, 1))
    const endDate = parseISO(format(endAt, 'yyyy-MM-dd'))
    
    return [
      {
        shift,
        day: shiftDate,
        displayStart: startAt,
        displayEnd: endOfStartDay,
        isSegment: true,
        segmentIndex: 0,
      },
      {
        shift,
        day: endDate,
        displayStart: startOfEndDay,
        displayEnd: endAt,
        isSegment: true,
        segmentIndex: 1,
      },
    ]
  }

  const getShiftsForDay = (date: Date): ShiftSegment[] => {
    const segments: ShiftSegment[] = []
    
    shifts.forEach(shift => {
      const shiftSegments = splitShiftForDisplay(shift)
      shiftSegments.forEach(segment => {
        if (isSameDay(segment.day, date)) {
          segments.push(segment)
        }
      })
    })
    
    segments.sort((a, b) => a.displayStart.getTime() - b.displayStart.getTime())
    
    return segments
  }

  const formatTime = (timeStr: string) => {
    return timeStr.substring(0, 5) // HH:MM format
  }

  const formatTimeFromDate = (date: Date) => {
    return format(date, 'HH:mm')
  }

  const isOvernightShift = (shift: Shift) => {
    return shift.end_time <= shift.start_time
  }

  const calculateDuration = (start: string, end: string, breakMins: number) => {
    const [startH, startM] = start.split(':').map(Number)
    const [endH, endM] = end.split(':').map(Number)
    const startMinutes = startH * 60 + startM
    let endMinutes = endH * 60 + endM
    if (endMinutes <= startMinutes) {
      endMinutes += 24 * 60 // Add 24 hours for overnight shifts
    }
    const totalMinutes = endMinutes - startMinutes - breakMins
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return `${hours}h ${minutes}m`
  }

  // Get employee color for the current user
  const employeeColors = useMemo(() => {
    if (!currentUser?.id) return null
    return getEmployeeColor(currentUser.id)
  }, [currentUser?.id])

  const employeeColorStyles = useMemo(() => {
    if (!currentUser?.id) return {}
    return getEmployeeColorStyles(currentUser.id, { state: 'normal', opacity: 1 })
  }, [currentUser?.id])

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">My Schedule</h1>
          <p className="text-sm text-gray-600 mt-1">View your upcoming shifts</p>
        </div>

        {/* Week Navigation */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
              className="p-2 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="text-center">
              <span className="text-lg font-medium">
                {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
              </span>
            </div>
            <button
              onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
              className="p-2 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <div className="mt-4 text-center">
            <button
              onClick={() => setCurrentWeek(new Date())}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Go to Current Week
            </button>
          </div>
        </div>

        {/* Calendar View */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading schedule...</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="grid grid-cols-7 border-b border-gray-200 bg-gradient-to-b from-gray-50 to-white">
              {weekDays.map((day, idx) => {
                const isToday = isSameDay(day, new Date())
                return (
                  <div 
                    key={idx} 
                    className={`p-4 text-center border-r last:border-r-0 ${
                      isToday ? 'bg-blue-50 border-blue-200' : ''
                    }`}
                  >
                    <div className={`text-xs font-semibold uppercase tracking-wider ${
                      isToday ? 'text-blue-600' : 'text-gray-500'
                    }`}>
                      {format(day, 'EEE')}
                    </div>
                    <div className={`text-xl font-bold mt-2 ${
                      isToday ? 'text-blue-600' : 'text-gray-900'
                    }`}>
                      {format(day, 'd')}
                    </div>
                    {isToday && (
                      <div className="mt-1">
                        <span className="inline-block w-1.5 h-1.5 bg-blue-600 rounded-full"></span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="grid grid-cols-7 min-h-[400px]">
              {weekDays.map((day, idx) => {
                const dayShifts = getShiftsForDay(day)
                const isToday = isSameDay(day, new Date())
                return (
                  <div
                    key={idx}
                    className={`p-3 border-r last:border-r-0 border-b min-h-[200px] min-w-[140px] overflow-hidden ${
                      isToday ? 'bg-blue-50/30' : 'bg-white'
                    } hover:bg-gray-50/50 transition-colors`}
                  >
                    <div className="space-y-2.5 h-full">
                      {dayShifts.length === 0 && (
                        <div className="text-center py-8">
                          <p className="text-xs text-gray-400 font-medium">No shifts</p>
                        </div>
                      )}
                      {dayShifts.map((segment, segIdx) => {
                        const { shift, isSegment, displayStart, displayEnd } = segment
                        const overnight = isOvernightShift(shift)
                        const isFirstSegment = !isSegment || segment.segmentIndex === 0
                        const isSecondSegment = isSegment && segment.segmentIndex === 1
                        
                        // Determine state and opacity based on shift status
                        let state: 'normal' | 'hover' | 'selected' | 'conflict' | 'muted' = 'normal'
                        let opacity = 1
                        if (shift.status === 'DRAFT' || shift.status === 'CANCELLED') {
                          state = 'muted'
                          opacity = 0.7
                        }
                        
                        // Get color styles for current user
                        const colorStyles = currentUser?.id 
                          ? getEmployeeColorStyles(currentUser.id, { state, opacity })
                          : {}
                        
                        // Convert CSS custom properties to inline styles
                        const currentStyles: Record<string, string> = currentUser?.id ? {
                          backgroundColor: colorStyles['--shift-bg'] || employeeColors?.bg || '#f3f4f6',
                          color: colorStyles['--shift-text'] || employeeColors?.text || '#1f2937',
                          borderColor: colorStyles['--shift-border'] || employeeColors?.border || '#d1d5db',
                        } : {}
                        
                        const segmentStyles = isSecondSegment 
                          ? {
                              ...currentStyles,
                              opacity: `${opacity * 0.95}`,
                            }
                          : currentStyles
                        
                        return (
                          <div
                            key={`${shift.id}-${isSegment ? segment.segmentIndex : 'single'}-${segIdx}`}
                            className="group p-2.5 border-l-4 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md hover:scale-[1.01] active:scale-[0.99] w-full min-w-0 overflow-hidden"
                            style={{
                              ...segmentStyles as CSSProperties,
                              borderLeftWidth: '4px',
                              flexShrink: 0,
                            }}
                            onMouseEnter={(e) => {
                              if (currentUser?.id) {
                                const hoverColors = getEmployeeColor(currentUser.id)
                                e.currentTarget.style.backgroundColor = hoverColors.bgHover
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (currentUser?.id) {
                                e.currentTarget.style.backgroundColor = segmentStyles.backgroundColor as string
                              }
                            }}
                          >
                            <div className="mb-2 min-w-0">
                              <div className="flex justify-start mb-1.5">
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-wide whitespace-nowrap flex-shrink-0 ${getStatusColor(shift.status)}`}>
                                  {shift.status === 'APPROVED' && (
                                    <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                  {shift.status === 'CANCELLED' && (
                                    <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                  {shift.status.charAt(0) + shift.status.slice(1).toLowerCase()}
                                </span>
                              </div>
                              <div className="font-semibold text-sm leading-tight break-words" style={{ color: segmentStyles.color }}>
                                {shift.employee_name || 'My Shift'}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 text-xs font-medium flex-wrap min-w-0" style={{ color: currentUser?.id ? employeeColors?.textMuted : '#6b7280' }}>
                              <svg className="w-3 h-3 opacity-60 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {isSegment ? (
                                <div className="flex items-center gap-1 flex-wrap min-w-0">
                                  {isFirstSegment ? (
                                    <>
                                      <span className="whitespace-nowrap">{formatTimeFromDate(displayStart)}</span>
                                      <span className="opacity-50 flex-shrink-0">→</span>
                                      <span className="whitespace-nowrap">24:00</span>
                                      <span className="ml-1 text-[10px] opacity-60 font-normal whitespace-nowrap">(continues)</span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="whitespace-nowrap">00:00</span>
                                      <span className="opacity-50 flex-shrink-0">→</span>
                                      <span className="whitespace-nowrap">{formatTimeFromDate(displayEnd)}</span>
                                      <span className="ml-1 text-[10px] opacity-60 font-normal whitespace-nowrap">(continued)</span>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 whitespace-nowrap">
                                  <span>{formatTimeFromDate(displayStart)}</span>
                                  <span className="opacity-50">-</span>
                                  <span>{formatTimeFromDate(displayEnd)}</span>
                                </div>
                              )}
                            </div>
                            {shift.break_minutes > 0 && (
                              <div className="mt-1 text-[10px] opacity-70" style={{ color: currentUser?.id ? employeeColors?.textMuted : '#6b7280' }}>
                                {shift.break_minutes}m break
                              </div>
                            )}
                            {shift.notes && (
                              <div className="mt-1 text-[10px] italic truncate opacity-80" style={{ color: currentUser?.id ? employeeColors?.textMuted : '#6b7280' }}>
                                {shift.notes}
                              </div>
                            )}
                            {overnight && isFirstSegment && (
                              <div className="mt-1 flex items-center gap-1 text-[9px] opacity-60 truncate" style={{ color: currentUser?.id ? employeeColors?.textMuted : '#6b7280' }}>
                                <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                                </svg>
                                <span className="truncate">Overnight</span>
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
          </div>
        )}

        {/* Summary */}
        {!loading && shifts.length > 0 && (
          <div className="mt-6 bg-white rounded-lg shadow p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Week Summary</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="text-sm text-gray-600">Total Shifts</div>
                <div className="text-2xl font-bold text-gray-900">{shifts.length}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Approved Shifts</div>
                <div className="text-2xl font-bold text-green-600">
                  {shifts.filter(s => s.status.toUpperCase() === 'APPROVED').length}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Published Shifts</div>
                <div className="text-2xl font-bold text-blue-600">
                  {shifts.filter(s => s.status.toUpperCase() === 'PUBLISHED').length}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

