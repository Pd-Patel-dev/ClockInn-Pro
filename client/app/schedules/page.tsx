'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import logger from '@/lib/logger'
import { format, startOfWeek, endOfWeek, addDays, addWeeks, subWeeks, isSameDay, startOfDay, endOfDay, parseISO } from 'date-fns'
import { getEmployeeColorStyles, getEmployeeColor } from '@/lib/employeeColors'
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

interface Employee {
  id: string
  name: string
  email: string
}

export default function SchedulesPage() {
  const router = useRouter()
  const toast = useToast()
  const [shifts, setShifts] = useState<Shift[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [currentWeek, setCurrentWeek] = useState(new Date())
  const [selectedEmployee, setSelectedEmployee] = useState<string>('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [authErrorOccurred, setAuthErrorOccurred] = useState(false)
  const [formData, setFormData] = useState({
    employee_id: '',
    shift_date: '',
    start_time: '',
    end_time: '',
    break_minutes: 0,
    notes: '',
  })

  // Memoize week calculations to prevent unnecessary recalculations
  const weekStart = useMemo(() => startOfWeek(currentWeek, { weekStartsOn: 1 }), [currentWeek])
  const weekEnd = useMemo(() => endOfWeek(currentWeek, { weekStartsOn: 1 }), [currentWeek])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  
  // Memoize date strings to prevent unnecessary effect triggers
  // Extend fetch window by 1 day on each side to catch overnight shifts that spill over
  const fetchStartDate = useMemo(() => addDays(weekStart, -1), [weekStart])
  const fetchEndDate = useMemo(() => addDays(weekEnd, 1), [weekEnd])
  const weekStartStr = useMemo(() => format(fetchStartDate, 'yyyy-MM-dd'), [fetchStartDate])
  const weekEndStr = useMemo(() => format(fetchEndDate, 'yyyy-MM-dd'), [fetchEndDate])

  // Refetch function that can be called from anywhere
  const refetchShifts = async () => {
    if (authErrorOccurred) {
      setLoading(false)
      return // Don't refetch if auth error occurred
    }
    
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.append('start_date', weekStartStr)
      params.append('end_date', weekEndStr)
      if (selectedEmployee) {
        params.append('employee_id', selectedEmployee)
      }
      const response = await api.get(`/shifts?${params.toString()}`)
      if (!authErrorOccurred) {
        setShifts(response.data || [])
      }
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        setAuthErrorOccurred(true)
        setLoading(false)
        // Let the interceptor handle redirect
        return
      }
      if (!authErrorOccurred) {
        logger.error('Failed to fetch shifts', error as Error)
        toast.error('Failed to load shifts')
      }
    } finally {
      if (!authErrorOccurred) {
        setLoading(false)
      } else {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    // Don't fetch if auth error occurred - let interceptor handle redirect
    if (authErrorOccurred) {
      setLoading(false)
      return
    }
    
    let abortController = new AbortController()
    let isMounted = true

    const fetchEmployees = async () => {
      if (!isMounted || authErrorOccurred) return
      
      try {
        const response = await api.get('/users/admin/employees', {
          signal: abortController.signal,
        })
        if (isMounted && !authErrorOccurred) {
          setEmployees(response.data || [])
        }
      } catch (error: any) {
        if (abortController.signal.aborted) return // Request was cancelled
        if (!isMounted) return
        
        if (error.response?.status === 401 || error.response?.status === 403) {
          setAuthErrorOccurred(true)
          setLoading(false)
          // Don't log or show error - let the interceptor handle redirect
          return
        }
        // Only log/show error if it's not an auth error
        if (isMounted && !authErrorOccurred) {
          logger.error('Failed to fetch employees', error as Error)
        }
      }
    }

    const fetchShifts = async () => {
      if (!isMounted || authErrorOccurred) return
      
      setLoading(true)
      try {
        const params = new URLSearchParams()
        params.append('start_date', weekStartStr)
        params.append('end_date', weekEndStr)
        if (selectedEmployee) {
          params.append('employee_id', selectedEmployee)
        }
        const response = await api.get(`/shifts?${params.toString()}`, {
          signal: abortController.signal,
        })
        if (isMounted && !authErrorOccurred) {
          setShifts(response.data || [])
        }
      } catch (error: any) {
        if (abortController.signal.aborted) {
          // Request was cancelled, don't update loading state
          return
        }
        if (!isMounted) return
        
        if (error.response?.status === 401 || error.response?.status === 403) {
          setAuthErrorOccurred(true)
          setLoading(false)
          // Don't log or show error - let the interceptor handle redirect
          return
        }
        // Only log/show error if it's not an auth error
        if (isMounted && !authErrorOccurred) {
          logger.error('Failed to fetch shifts', error as Error)
          toast.error('Failed to load shifts')
        }
      } finally {
        if (isMounted && !authErrorOccurred) {
          setLoading(false)
        }
      }
    }

    // Fetch both in parallel
    fetchEmployees()
    fetchShifts()

    // Cleanup function
    return () => {
      isMounted = false
      abortController.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWeek, selectedEmployee, weekStartStr, weekEndStr])

  const handleCreateShift = async () => {
    // Client-side validation
    if (!formData.employee_id) {
      toast.error('Please select an employee')
      return
    }
    if (!formData.shift_date) {
      toast.error('Please select a date')
      return
    }
    if (!formData.start_time) {
      toast.error('Please enter a start time')
      return
    }
    if (!formData.end_time) {
      toast.error('Please enter an end time')
      return
    }
    
    // Note: We allow overnight shifts (end_time < start_time indicates next day)
    // Validation will happen on the backend with proper datetime handling
    
    // Check for conflicts before sending to backend
    const conflicts = checkForConflicts({
      shift_date: formData.shift_date,
      start_time: formData.start_time,
      end_time: formData.end_time,
      employee_id: formData.employee_id,
    })
    
    if (conflicts.length > 0) {
      const conflictDetails = conflicts.map(c => {
        const { startAt, endAt } = normalizeShift(c)
        return `${formatTimeFromDate(startAt)}-${formatTimeFromDate(endAt)} on ${format(parseISO(c.shift_date), 'MMM d')}`
      }).join(', ')
      
      toast.error(`Shift conflicts with existing shifts: ${conflictDetails}`)
      return
    }
    
    // Prepare payload - clean up empty strings and ensure proper types
    const payload: any = {
      employee_id: formData.employee_id, // UUID string (required)
      shift_date: formData.shift_date, // YYYY-MM-DD format (required)
      start_time: formData.start_time, // HH:MM format (required)
      end_time: formData.end_time, // HH:MM format (required)
      break_minutes: parseInt(formData.break_minutes.toString()) || 0, // int >= 0
    }
    
    // Only include optional fields if they have values (not empty strings)
    if (formData.notes && formData.notes.trim()) {
      payload.notes = formData.notes.trim()
    }
    // job_role and requires_approval are optional and have defaults on server
    
    // Calculate actual datetimes for logging (overnight shift detection)
    const startDate = new Date(formData.shift_date + 'T' + formData.start_time + ':00')
    let endDate = new Date(formData.shift_date + 'T' + formData.end_time + ':00')
    const isOvernight = formData.end_time <= formData.start_time
    if (isOvernight) {
      // End time is on next day
      endDate = addDays(endDate, 1)
    }
    
    // Log outgoing request with datetime calculations
    console.log('=== CREATE SHIFT REQUEST (BEFORE API CALL) ===')
    console.log('API Client Base URL:', process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000')
    console.log('Request Path:', '/shifts')
    console.log('Expected Full URL:', `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/shifts`)
    console.log('Method:', 'POST')
    console.log('Payload:', JSON.stringify(payload, null, 2))
    console.log('Form Data (raw):', formData)
    console.log('--- DateTime Calculations ---')
    console.log('Start DateTime:', startDate.toISOString())
    console.log('End DateTime:', endDate.toISOString())
    console.log('Is Overnight:', isOvernight)
    console.log('Duration (hours):', (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60))
    
    // Verify token availability before making request
    const tokenCheck = (await import('@/lib/api')).getAccessToken()
    console.log('Token Available Before Request:', !!tokenCheck)
    console.log('Token Preview:', tokenCheck ? `${tokenCheck.substring(0, 20)}...` : 'MISSING')
    
    try {
      const response = await api.post('/shifts', payload)
      console.log('=== CREATE SHIFT SUCCESS ===')
      console.log('Response:', response.data)
      
      toast.success('Shift created successfully')
      setShowCreateModal(false)
      setFormData({
        employee_id: '',
        shift_date: '',
        start_time: '',
        end_time: '',
        break_minutes: 0,
        notes: '',
      })
      // Refetch shifts to show the new shift
      await refetchShifts()
    } catch (error: any) {
      // Don't handle auth errors here - let the interceptor handle redirect
      if (error.response?.status === 401 || error.response?.status === 403) {
        setAuthErrorOccurred(true)
        return
      }
      
      // Only log as error if it's NOT a 401 that was retried and succeeded
      // (401s that get retried successfully shouldn't reach here, but if they do, it's handled)
      if (error.response?.status !== 401 || !error.config?._retry) {
        console.error('=== CREATE SHIFT ERROR (FINAL) ===')
        console.error('Status:', error.response?.status)
        console.error('Status Text:', error.response?.statusText)
        console.error('Response Headers:', error.response?.headers)
        console.error('Response Data (FULL):', JSON.stringify(error.response?.data, null, 2))
        console.error('Request Config URL:', error.config?.url)
        console.error('Request Config Method:', error.config?.method)
        console.error('Request Config Data (raw):', error.config?.data)
        console.error('Request Config Headers:', error.config?.headers)
        console.error('Was Retried:', error.config?._retry)
        console.error('Full Error Object:', error)
      } else {
        console.warn('=== CREATE SHIFT: 401 ERROR (LIKELY RETRIED BY INTERCEPTOR) ===')
        console.warn('This error may have been automatically retried. Check network tab for final request status.')
      }
      
      logger.error('Failed to create shift', error as Error)
      
      // Show detailed error message from FastAPI validation
      const errorData = error.response?.data
      let displayMessage = 'Failed to create shift'
      
      if (errorData?.errors && Array.isArray(errorData.errors)) {
        // FastAPI validation errors format: [{ field, message, type }]
        const errorMessages = errorData.errors.map((e: any) => {
          const field = e.field || 'Unknown field'
          const msg = e.message || 'Invalid value'
          return `${field}: ${msg}`
        })
        displayMessage = errorMessages.join(', ')
      } else if (errorData?.detail) {
        displayMessage = typeof errorData.detail === 'string' 
          ? errorData.detail 
          : JSON.stringify(errorData.detail)
      } else if (errorData?.message) {
        displayMessage = errorData.message
      }
      
      toast.error(displayMessage)
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
   * Handles overnight shifts correctly by converting shift_date + start_time/end_time
   * into absolute Date objects that can be compared.
   */
  const normalizeShift = (shift: Shift): { startAt: Date; endAt: Date } => {
    // Parse shift_date (YYYY-MM-DD format)
    const shiftDate = parseISO(shift.shift_date)
    
    // Parse start_time and end_time (HH:MM format)
    const [startHour, startMinute] = shift.start_time.split(':').map(Number)
    const [endHour, endMinute] = shift.end_time.split(':').map(Number)
    
    // Combine date and time for start
    const startAt = new Date(shiftDate)
    startAt.setHours(startHour, startMinute, 0, 0)
    
    // Combine date and time for end
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
   * Returns 1 segment for same-day shifts, or 2 segments for overnight shifts.
   * Each segment includes the original shift ID to keep them linked.
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
    
    // Check if it's overnight (endAt is on a different day)
    const isOvernight = !isSameDay(startAt, endAt)
    
    if (!isOvernight) {
      // Same-day shift: return single segment
      return [{
        shift,
        day: shiftDate,
        displayStart: startAt,
        displayEnd: endAt,
        isSegment: false,
      }]
    }
    
    // Overnight shift: split into two segments
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

  /**
   * Get all shift segments for a specific day, including overnight shifts
   * that start on previous days or end on subsequent days.
   */
  const getShiftsForDay = (date: Date): ShiftSegment[] => {
    const segments: ShiftSegment[] = []
    
    // Process all shifts and collect segments for this day
    shifts.forEach(shift => {
      const shiftSegments = splitShiftForDisplay(shift)
      shiftSegments.forEach(segment => {
        if (isSameDay(segment.day, date)) {
          segments.push(segment)
        }
      })
    })
    
    // Sort by start time
    segments.sort((a, b) => a.displayStart.getTime() - b.displayStart.getTime())
    
    return segments
  }
  
  /**
   * Memoized employee color objects to avoid recalculation
   * The getEmployeeColor function has its own cache, but we can still memoize
   * the lookup to avoid repeated function calls in render
   */
  const employeeColors = useMemo(() => {
    const colorMap = new Map<string, ReturnType<typeof getEmployeeColor>>()
    shifts.forEach(shift => {
      if (!colorMap.has(shift.employee_id)) {
        colorMap.set(shift.employee_id, getEmployeeColor(shift.employee_id))
      }
    })
    return colorMap
  }, [shifts])

  const formatTime = (timeStr: string) => {
    return timeStr.substring(0, 5) // HH:MM format
  }

  /**
   * Format a Date object to time string (HH:MM) for display
   */
  const formatTimeFromDate = (date: Date) => {
    return format(date, 'HH:mm')
  }

  const isOvernightShift = (shift: Shift) => {
    // Check if shift is overnight (end_time <= start_time means it spans midnight)
    return shift.end_time <= shift.start_time
  }
  
  /**
   * Check if two datetime intervals overlap
   */
  const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean => {
    return aStart < bEnd && aEnd > bStart
  }
  
  /**
   * Check if a new shift would conflict with existing shifts
   */
  const checkForConflicts = (candidateShift: { shift_date: string; start_time: string; end_time: string; employee_id: string }): Shift[] => {
    const candidate = normalizeShift(candidateShift as Shift)
    const conflicts: Shift[] = []
    
    shifts.forEach(shift => {
      // Only check conflicts with the same employee
      if (shift.employee_id !== candidateShift.employee_id) return
      
      const existing = normalizeShift(shift)
      
      // Check for overlap
      if (overlaps(candidate.startAt, candidate.endAt, existing.startAt, existing.endAt)) {
        conflicts.push(shift)
      }
    })
    
    return conflicts
  }

  return (
    <Layout>
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="mb-8">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Schedule</h1>
                <p className="mt-2 text-sm text-gray-500">View and manage employee shifts for the selected week</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => router.push('/schedules/week')}
                  className="inline-flex items-center px-5 py-2.5 bg-purple-600 text-white font-medium rounded-lg shadow-sm hover:bg-purple-700 hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
                >
                  <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Create Week Shifts
                </button>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg shadow-sm hover:bg-blue-700 hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Shift
                </button>
              </div>
            </div>
          </div>

          {/* Filters & Navigation */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
              <div className="lg:col-span-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Employee</label>
                <select
                  value={selectedEmployee}
                  onChange={(e) => setSelectedEmployee(e.target.value)}
                  className="block w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                >
                  <option value="">All Employees</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="lg:col-span-6">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Week</label>
                <div className="flex items-center">
                  <button
                    onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
                    className="p-2.5 border border-gray-300 rounded-l-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                    aria-label="Previous week"
                  >
                    <svg className="h-5 w-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <div className="flex-1 px-6 py-2.5 border-y border-gray-300 text-center bg-gray-50">
                    <span className="text-sm font-semibold text-gray-900">
                      {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
                    </span>
                  </div>
                  <button
                    onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
                    className="p-2.5 border border-gray-300 rounded-r-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                    aria-label="Next week"
                  >
                    <svg className="h-5 w-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
              
              <div className="lg:col-span-2">
                <button
                  onClick={() => setCurrentWeek(new Date())}
                  className="w-full px-4 py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors"
                >
                  Today
                </button>
              </div>
            </div>
          </div>

          {/* Calendar View */}
          {loading ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-16">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-3 border-blue-600 border-t-transparent mx-auto"></div>
                <p className="mt-4 text-gray-600 font-medium">Loading shifts...</p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* Calendar Header */}
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
              
              {/* Calendar Grid */}
              <div className="grid grid-cols-7 min-h-[600px] auto-rows-fr" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
                {weekDays.map((day, idx) => {
                  const dayShifts = getShiftsForDay(day)
                  const isToday = isSameDay(day, new Date())
                  return (
                    <div
                      key={idx}
                      className={`relative p-3 border-r last:border-r-0 border-b border-gray-100 min-h-[600px] min-w-[140px] ${
                        isToday ? 'bg-blue-50/30' : 'bg-white'
                      } hover:bg-gray-50/50 transition-colors overflow-hidden`}
                    >
                      <div className="space-y-2.5 h-full">
                        {dayShifts.length === 0 && (
                          <div className="text-center py-8">
                            <p className="text-xs text-gray-400 font-medium">No shifts</p>
                          </div>
                        )}
                        {dayShifts.map((segment, idx) => {
                        const { shift, isSegment, displayStart, displayEnd } = segment
                        const overnight = isOvernightShift(shift)
                        
                        // Create unique key for each segment (shift.id + segment index if split)
                        const segmentKey = `${shift.id}-${isSegment ? segment.segmentIndex : 'single'}-${idx}`
                        
                        // Determine visual styling based on segment position
                        const isFirstSegment = !isSegment || segment.segmentIndex === 0
                        const isSecondSegment = isSegment && segment.segmentIndex === 1
                        
                        // Get employee color scheme (from memoized cache or calculate)
                        const colors = employeeColors.get(shift.employee_id) || getEmployeeColor(shift.employee_id)
                        
                        // Determine state and opacity based on shift status
                        let state: 'normal' | 'hover' | 'selected' | 'conflict' | 'muted' = 'normal'
                        let opacity = 1
                        if (shift.status === 'DRAFT' || shift.status === 'CANCELLED') {
                          state = 'muted'
                          opacity = 0.7
                        }
                        
                        // Get color styles for current state
                        const colorStyles = getEmployeeColorStyles(shift.employee_id, { state, opacity })
                        
                        // Convert CSS custom properties to inline styles
                        // TypeScript doesn't support CSS custom properties in CSSProperties, so we use Record
                        const currentStyles: Record<string, string> = {
                          backgroundColor: colorStyles['--shift-bg'] || colors.bg,
                          color: colorStyles['--shift-text'] || colors.text,
                          borderColor: colorStyles['--shift-border'] || colors.border,
                        }
                        
                        // For second segment of overnight shifts, use slightly different styling
                        const segmentStyles = isSecondSegment 
                          ? {
                              ...currentStyles,
                              // Slightly adjust opacity for visual distinction while maintaining color family
                              opacity: `${opacity * 0.95}`,
                            }
                          : currentStyles
                        
                          return (
                          <div
                            key={segmentKey}
                            className="group p-2.5 border-l-4 rounded-lg cursor-pointer transition-all duration-200 shadow-sm hover:shadow-md hover:scale-[1.01] active:scale-[0.99] w-full min-w-0 overflow-hidden"
                            style={{
                              ...segmentStyles as CSSProperties,
                              borderLeftWidth: '4px',
                              flexShrink: 0,
                            }}
                            onMouseEnter={(e) => {
                              // Hover effect: slightly darker background
                              const hoverColors = getEmployeeColor(shift.employee_id)
                              e.currentTarget.style.backgroundColor = hoverColors.bgHover
                            }}
                            onMouseLeave={(e) => {
                              // Reset to original
                              e.currentTarget.style.backgroundColor = segmentStyles.backgroundColor as string
                            }}
                              onClick={() => router.push(`/schedules/${shift.id}`)}
                              title={isSegment 
                                ? (isFirstSegment 
                                    ? `Overnight shift starting ${formatTimeFromDate(displayStart)} (continues tomorrow)` 
                                    : `Overnight shift continuing from yesterday, ending ${formatTimeFromDate(displayEnd)}`)
                                : `${shift.employee_name}: ${formatTimeFromDate(displayStart)} - ${formatTimeFromDate(displayEnd)}`
                              }
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
                                <div className="font-semibold text-sm leading-tight break-words" style={{ color: colors.text }}>
                                  {shift.employee_name}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 text-xs font-medium flex-wrap min-w-0" style={{ color: colors.textMuted }}>
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
                              {overnight && isFirstSegment && (
                                <div className="mt-1 flex items-center gap-1 text-[9px] opacity-60 truncate" style={{ color: colors.textMuted }}>
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

        {/* Create Shift Modal */}
        {showCreateModal && (
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setShowCreateModal(false)}
          >
            <div 
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 transform transition-all"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">Create New Shift</h2>
                    <p className="text-sm text-gray-500 mt-1">Schedule a shift for an employee</p>
                  </div>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100"
                    aria-label="Close"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="p-6">
                  <div className="space-y-5">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Employee <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={formData.employee_id}
                        onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                        className="block w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        required
                      >
                        <option value="">Select Employee</option>
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={formData.shift_date}
                        onChange={(e) => setFormData({ ...formData, shift_date: e.target.value })}
                        className="block w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                          Start Time <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="time"
                          value={formData.start_time}
                          onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                          className="block w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                          End Time <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="time"
                          value={formData.end_time}
                          onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                          className="block w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Break (minutes)</label>
                      <input
                        type="number"
                        value={formData.break_minutes}
                        onChange={(e) => setFormData({ ...formData, break_minutes: parseInt(e.target.value) || 0 })}
                        className="block w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        min="0"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
                      <textarea
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        className="block w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none"
                        rows={3}
                        placeholder="Optional notes for this shift..."
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-8 flex justify-end space-x-3 pt-6 border-t border-gray-200">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-5 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateShift}
                    className="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg shadow-sm hover:bg-blue-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200"
                  >
                    Create Shift
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}

