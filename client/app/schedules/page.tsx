'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import logger from '@/lib/logger'
import { format, startOfWeek, endOfWeek, addDays, addWeeks, subWeeks, parseISO } from 'date-fns'
import { getEmployeeColor } from '@/lib/employeeColors'
import { parseTime24, toApiTime24 } from '@/lib/time'
import { ShiftTimeline } from '@/components/ShiftTimeline'
import TimeInput12h from '@/components/TimeInput12h'

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
  role?: string
}

export default function SchedulesPage() {
  const router = useRouter()
  const toast = useToast()
  const [shifts, setShifts] = useState<Shift[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [currentWeek, setCurrentWeek] = useState(new Date())
  const [selectedDepartment, setSelectedDepartment] = useState<string>('')
  const [selectedEmployee, setSelectedEmployee] = useState<string>('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [sendingEmployeeId, setSendingEmployeeId] = useState<string | null>(null)
  const [authErrorOccurred, setAuthErrorOccurred] = useState(false)
  const [scheduleDayStartHour, setScheduleDayStartHour] = useState(7)
  const [scheduleDayEndHour, setScheduleDayEndHour] = useState(7)
  const [formData, setFormData] = useState({
    employee_id: '',
    shift_date: '',
    start_time: '09:00',
    end_time: '17:00',
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

  // Department filter: map role to employees (role used as department)
  const filteredEmployees = useMemo(() => {
    if (!selectedDepartment) return employees
    return employees.filter((emp) => emp.role === selectedDepartment)
  }, [employees, selectedDepartment])

  // Shifts to display: when department filter is on, only show shifts for employees in that department
  const filteredShifts = useMemo(() => {
    if (!selectedDepartment) return shifts
    const ids = new Set(filteredEmployees.map((e) => e.id))
    return shifts.filter((s) => ids.has(s.employee_id))
  }, [shifts, selectedDepartment, filteredEmployees])

  /**
   * Normalize a shift into absolute datetime intervals (used for totals and conflicts).
   * Times from API are 24-hour (HH:MM).
   */
  const normalizeShift = (shift: Shift): { startAt: Date; endAt: Date } => {
    const shiftDate = parseISO(shift.shift_date)
    const startParsed = parseTime24(shift.start_time)
    const endParsed = parseTime24(shift.end_time)
    if (!startParsed || !endParsed) {
      const fallback = new Date(shiftDate)
      fallback.setHours(0, 0, 0, 0)
      return { startAt: fallback, endAt: addDays(fallback, 1) }
    }
    const startAt = new Date(shiftDate)
    startAt.setHours(startParsed.hour, startParsed.minute, 0, 0)
    let endAt = new Date(shiftDate)
    endAt.setHours(endParsed.hour, endParsed.minute, 0, 0)
    if (endAt <= startAt) endAt = addDays(endAt, 1)
    return { startAt, endAt }
  }

  // Total hours per employee for the current week (Mon–Sun)
  const employeeWeekTotals = useMemo(() => {
    const weekStartStrOnly = format(weekStart, 'yyyy-MM-dd')
    const weekEndStrOnly = format(weekEnd, 'yyyy-MM-dd')
    const totals: Record<string, number> = {}
    filteredEmployees.forEach((emp) => { totals[emp.id] = 0 })
    filteredShifts.forEach((shift) => {
      if (shift.shift_date < weekStartStrOnly || shift.shift_date > weekEndStrOnly) return
      const { startAt, endAt } = normalizeShift(shift)
      let minutes = (endAt.getTime() - startAt.getTime()) / (1000 * 60)
      minutes -= shift.break_minutes || 0
      totals[shift.employee_id] = (totals[shift.employee_id] ?? 0) + minutes
    })
    return totals
  }, [filteredEmployees, filteredShifts, weekStart, weekEnd])

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
      params.append('limit', '1000')
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
        params.append('limit', '1000')
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

  // Fetch company settings for schedule day start/end (once on mount)
  useEffect(() => {
    let isMounted = true
    const fetchCompanySettings = async () => {
      try {
        const response = await api.get('/company/info')
        if (isMounted && response.data?.settings) {
          const s = response.data.settings
          setScheduleDayStartHour(s.schedule_day_start_hour ?? 7)
          setScheduleDayEndHour(s.schedule_day_end_hour ?? 7)
        }
      } catch (_) {
        // Use defaults if fetch fails
      }
    }
    fetchCompanySettings()
    return () => { isMounted = false }
  }, [])

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
    // Validation and conflict detection happen on the backend; we rely on the create
    // response to show any overlap warning (server has full data, pagination-safe).
    
    // Prepare payload - clean up empty strings and ensure proper types
    const payload: any = {
      employee_id: formData.employee_id, // UUID string (required)
      shift_date: formData.shift_date, // YYYY-MM-DD format (required)
      start_time: toApiTime24(formData.start_time), // 24-hour HH:mm (e.g. 23:00 = 11 PM)
      end_time: toApiTime24(formData.end_time), // 24-hour HH:mm (e.g. 07:00 = 7 AM)
      break_minutes: parseInt(formData.break_minutes.toString()) || 0, // int >= 0
    }
    
    // Only include optional fields if they have values (not empty strings)
    if (formData.notes && formData.notes.trim()) {
      payload.notes = formData.notes.trim()
    }
    // job_role and requires_approval are optional and have defaults on server
    
    try {
      const response = await api.post('/shifts', payload)
      const data = response.data as { shift?: unknown; conflicts?: Array<{ message?: string }> }
      const conflicts = data?.conflicts ?? []
      toast.success('Shift created successfully')
      if (conflicts.length > 0) {
        toast.error(`Shift created but overlaps with ${conflicts.length} existing shift(s). Check the schedule.`)
      }
      setShowCreateModal(false)
      setFormData({
        employee_id: '',
        shift_date: '',
        start_time: '09:00',
        end_time: '17:00',
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
      if (process.env.NODE_ENV !== 'production') {
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

  const handleSendSchedule = async (employeeId: string) => {
    const weekStartDateStr = format(weekStart, 'yyyy-MM-dd')
    setSendingEmployeeId(employeeId)
    try {
      await api.post('/shifts/send-schedule', {
        employee_id: employeeId,
        week_start_date: weekStartDateStr,
      })
      toast.success('Schedule sent to employee')
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        setAuthErrorOccurred(true)
        return
      }
      const msg = error.response?.data?.detail ?? 'Failed to send schedule'
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setSendingEmployeeId(null)
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
   * Format a Date object to time string (HH:MM) for display
   */
  const formatTimeFromDate = (date: Date) => {
    return format(date, 'HH:mm')
  }

  const isOvernightShift = (shift: Shift) => {
    return shift.end_time <= shift.start_time
  }

  /** Open print-friendly schedule in new window and trigger print (or Save as PDF). */
  const handlePrintSchedule = () => {
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    // Use filtered employees (by department) so print matches current view
    const sortedEmployees = [...filteredEmployees]
      .map((emp) => ({ id: emp.id, name: emp.name || 'Unknown' }))
      .sort((a, b) => a.name.localeCompare(b.name))

    if (sortedEmployees.length === 0) {
      toast.error('No employees to show in the schedule.')
      return
    }

    const shiftsByEmployeeAndDay = new Map<string, Map<string, Shift[]>>()
    filteredShifts.forEach((shift) => {
      if (!shiftsByEmployeeAndDay.has(shift.employee_id)) {
        shiftsByEmployeeAndDay.set(shift.employee_id, new Map())
      }
      const byDay = shiftsByEmployeeAndDay.get(shift.employee_id)!
      const d = shift.shift_date
      if (!byDay.has(d)) byDay.set(d, [])
      byDay.get(d)!.push(shift)
    })

    const formatTimeNoSeconds = (t: string) => {
      if (!t) return '—'
      const parts = String(t).trim().split(':')
      const h = parts[0] ? parseInt(parts[0], 10) : 0
      const m = parts[1] !== undefined ? parseInt(parts[1], 10) : 0
      const hour = isNaN(h) ? 0 : h
      const min = isNaN(m) ? 0 : m
      return `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
    }

    const formatCell = (dayShifts: Shift[] | undefined) => {
      if (!dayShifts || dayShifts.length === 0) return '<span class="cell-empty">—</span>'
      return dayShifts
        .map((s) => {
          const start = formatTimeNoSeconds(s.start_time)
          const end = formatTimeNoSeconds(s.end_time)
          const br = s.break_minutes ? ` <span class="cell-break">(${s.break_minutes}m break)</span>` : ''
          return `<span class="cell-time">${start} – ${end}</span>${br}`
        })
        .join('<br/>')
    }

    const dayHeaders = weekDays
      .map(
        (d, i) =>
          `<th class="day-col"><span class="day-name">${dayLabels[i]}</span><span class="day-num">${format(d, 'd')}</span><span class="day-month">${format(d, 'MMM')}</span></th>`
      )
      .join('')
    const rows = sortedEmployees
      .map(({ id, name }, idx) => {
        const byDay = shiftsByEmployeeAndDay.get(id)
        const cells = weekDays
          .map((day) => {
            const key = format(day, 'yyyy-MM-dd')
            const dayShifts = byDay?.get(key)
            return `<td class="cell">${formatCell(dayShifts)}</td>`
          })
          .join('')
        const rowClass = idx % 2 === 0 ? 'row-even' : 'row-odd'
        return `<tr class="${rowClass}"><td class="cell-employee">${escapeHtml(name)}</td>${cells}</tr>`
      })
      .join('')

    const title = `Week of ${format(weekStart, 'MMMM d')} – ${format(weekEnd, 'MMMM d, yyyy')}`
    const generated = format(new Date(), "MMM d, yyyy 'at' h:mm a")
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Schedule – ${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #f8fafc; color: #1e293b; padding: 24px; font-size: 16px; line-height: 1.4; }
    .print-sheet { max-width: 880px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .print-header { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: #fff; padding: 24px 28px; }
    .print-header h1 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.9; }
    .print-header .print-title { margin: 8px 0 0 0; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
    .print-header .print-sub { margin: 4px 0 0 0; font-size: 15px; opacity: 0.9; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { background: #f1f5f9; }
    th { text-align: left; padding: 10px 8px; font-weight: 600; font-size: 14px; color: #475569; border-bottom: 2px solid #e2e8f0; overflow: hidden; }
    th.day-col { text-align: center; min-width: 0; width: 12%; }
    th.cell-employee { width: 16%; min-width: 0; }
    th .day-name { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
    th .day-num { display: block; font-size: 20px; color: #1e293b; margin-top: 2px; }
    th .day-month { display: block; font-size: 12px; color: #64748b; margin-top: 1px; }
    td { padding: 10px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; font-size: 15px; overflow: hidden; word-wrap: break-word; }
    td.cell-employee { font-weight: 600; color: #1e293b; background: #fafbfc; width: 16%; min-width: 0; }
    tr.row-odd td.cell-employee { background: #f8fafc; }
    td.cell { color: #475569; width: 12%; min-width: 0; text-align: center; }
    tr.row-even td.cell { background: #fefefe; }
    tr.row-odd td.cell { background: #f8fafc; }
    .cell-empty { color: #94a3b8; font-style: italic; }
    .cell-time { font-weight: 500; color: #1e293b; }
    .cell-break { font-size: 12px; color: #64748b; }
    .print-footer { padding: 12px 20px; border-top: 1px solid #e2e8f0; font-size: 13px; color: #94a3b8; background: #f8fafc; }
    .no-print { margin-top: 16px; font-size: 14px; color: #64748b; }
    @page { size: landscape; margin: 0.5in; }
    @media print {
      body { background: #fff; padding: 0; margin: 0; }
      .print-sheet { max-width: 100%; width: 100%; box-shadow: none; border-radius: 0; }
      .print-header, .print-footer { padding-left: 0.5in; padding-right: 0.5in; }
      .print-body { padding: 0 0.25in; }
      table { width: 100%; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="print-sheet">
    <div class="print-header">
      <h1>ClockIn Pro</h1>
      <p class="print-title">Schedule</p>
      <p class="print-sub">${escapeHtml(title)}</p>
    </div>
    <div class="print-body">
  <table>
    <thead><tr><th class="cell-employee">Employee</th>${dayHeaders}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
    </div>
    <div class="print-footer">
      Generated on ${escapeHtml(generated)} · Print or save as PDF from your browser
    </div>
  </div>
  <p class="no-print">Use Print or Save as PDF to export this schedule.</p>

</body>
</html>`

    // Use a hidden iframe to avoid pop-up blockers (no new window needed)
    const iframe = document.createElement('iframe')
    iframe.setAttribute('style', 'position:absolute;width:0;height:0;border:0;left:-9999px;')
    document.body.appendChild(iframe)
    const doc = iframe.contentWindow?.document
    if (!doc) {
      document.body.removeChild(iframe)
      toast.error('Could not open print preview.')
      return
    }
    doc.open()
    doc.write(html)
    doc.close()
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    // Remove iframe after print dialog closes (user may cancel or print)
    setTimeout(() => {
      if (iframe.parentNode) document.body.removeChild(iframe)
    }, 1000)
  }

  function escapeHtml(text: string): string {
    // Single place we inject user-supplied text into HTML (print iframe). Always escape;
    // do not use dangerouslySetInnerHTML with unsanitized data elsewhere.
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-gray-50 to-indigo-50/30">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="mb-6">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Schedule</h1>
                <p className="mt-1 text-sm text-gray-500">View and manage shifts for the selected week</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handlePrintSchedule}
                  className="inline-flex items-center px-5 py-2.5 bg-white/80 text-gray-700 font-medium rounded-xl shadow-[6px_6px_12px_rgba(0,0,0,0.06),-6px_-6px_12px_rgba(255,255,255,0.9)] border border-white/60 backdrop-blur-sm hover:shadow-[4px_4px_8px_rgba(0,0,0,0.08),-4px_-4px_8px_rgba(255,255,255,0.8)] hover:bg-white/90 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-gray-400/50"
                >
                  <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Print / Export
                </button>
                <button
                  onClick={() => router.push('/schedules/week')}
                  className="inline-flex items-center px-5 py-2.5 bg-white/80 text-purple-700 font-medium rounded-xl shadow-[6px_6px_12px_rgba(0,0,0,0.06),-6px_-6px_12px_rgba(255,255,255,0.9)] border border-white/60 backdrop-blur-sm hover:shadow-[4px_4px_8px_rgba(0,0,0,0.08),-4px_-4px_8px_rgba(255,255,255,0.8)] hover:bg-white/90 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-purple-400/50"
                >
                  <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Create Bulk Shift
                </button>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center px-5 py-2.5 bg-blue-500/90 text-white font-medium rounded-xl shadow-[6px_6px_14px_rgba(59,130,246,0.35),-2px_-2px_8px_rgba(255,255,255,0.2)] border border-white/30 backdrop-blur-sm hover:bg-blue-600 hover:shadow-[4px_4px_12px_rgba(59,130,246,0.4)] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                >
                  <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Shift
                </button>
              </div>
            </div>
          </div>

          {/* Filters & Navigation - glassmorphism */}
          <div className="bg-white/60 backdrop-blur-xl rounded-2xl border border-white/50 shadow-[0_8px_32px_rgba(0,0,0,0.06)] p-4 mb-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
              <div className="lg:col-span-3">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Department</label>
                <select
                  value={selectedDepartment}
                  onChange={(e) => {
                    setSelectedDepartment(e.target.value)
                    if (selectedEmployee && e.target.value) {
                      const nextFiltered = employees.filter((emp: Employee) => emp.role === e.target.value)
                      if (!nextFiltered.some((emp: Employee) => emp.id === selectedEmployee)) {
                        setSelectedEmployee('')
                      }
                    }
                  }}
                  className="block w-full px-4 py-2.5 rounded-xl bg-white/80 border border-white/60 shadow-[inset_4px_4px_8px_rgba(0,0,0,0.04)] backdrop-blur-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-300/50 transition-all"
                >
                  <option value="">All Departments</option>
                  <option value="FRONTDESK">Front Desk</option>
                  <option value="HOUSEKEEPING">Housekeeping</option>
                  <option value="MAINTENANCE">Maintenance</option>
                </select>
              </div>
              <div className="lg:col-span-3">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Employee</label>
                <select
                  value={selectedEmployee}
                  onChange={(e) => setSelectedEmployee(e.target.value)}
                  className="block w-full px-4 py-2.5 rounded-xl bg-white/80 border border-white/60 shadow-[inset_4px_4px_8px_rgba(0,0,0,0.04)] backdrop-blur-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-300/50 transition-all"
                >
                  <option value="">All Employees</option>
                  {filteredEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="lg:col-span-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Week</label>
                <div className="flex items-center">
                  <button
                    onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
                    className="p-2.5 rounded-l-xl bg-white/70 border border-white/50 shadow-[4px_4px_8px_rgba(0,0,0,0.05),-2px_-2px_6px_rgba(255,255,255,0.8)] hover:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.06)] hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-blue-400/40 transition-all"
                    aria-label="Previous week"
                  >
                    <svg className="h-5 w-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <div className="flex-1 px-6 py-2.5 border-y border-gray-200/80 bg-white/50 text-center backdrop-blur-sm">
                    <span className="text-sm font-semibold text-gray-900">
                      {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
                    </span>
                  </div>
                  <button
                    onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
                    className="p-2.5 rounded-r-xl bg-white/70 border border-white/50 shadow-[4px_4px_8px_rgba(0,0,0,0.05),-2px_-2px_6px_rgba(255,255,255,0.8)] hover:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.06)] hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-blue-400/40 transition-all"
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
                  className="w-full px-4 py-2.5 rounded-xl bg-white/70 text-gray-700 font-medium shadow-[4px_4px_10px_rgba(0,0,0,0.06),-4px_-4px_10px_rgba(255,255,255,0.9)] border border-white/50 hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.05)] hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-gray-400/30 transition-all"
                >
                  Today
                </button>
              </div>
            </div>
          </div>

          {/* Calendar View + Side panel */}
          {loading ? (
            <div className="bg-white/60 backdrop-blur-xl rounded-2xl border border-white/50 shadow-[0_8px_32px_rgba(0,0,0,0.06)] p-16">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-2 border-blue-500/60 border-t-transparent mx-auto"></div>
                <p className="mt-4 text-gray-600 font-medium">Loading shifts...</p>
              </div>
            </div>
          ) : (
            <div className="flex gap-4">
              <div className="flex-1 min-w-0 max-h-[calc(100vh-200px)] overflow-auto min-h-[540px] rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.06)]">
                <ShiftTimeline
                  shifts={filteredShifts}
                  weekDays={weekDays}
                  onShiftClick={(s) => router.push(`/schedules/shift/${s.id}`)}
                  loading={loading}
                  today={new Date()}
                  dayStartHour={scheduleDayStartHour}
                  dayEndHour={scheduleDayEndHour}
                />
              </div>
              {/* Side panel: employees, week total, Edit, Send */}
              <aside className="w-[240px] flex-shrink-0 bg-white/70 rounded-xl border border-gray-200/80 p-3 max-h-[calc(100vh-200px)] overflow-auto">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Employees · Week total</p>
                <ul className="space-y-1.5">
                  {filteredEmployees.map((emp) => {
                    const totalMinutes = employeeWeekTotals[emp.id] ?? 0
                    const totalHours = totalMinutes / 60
                    const hoursLabel = totalHours === 0 ? '0 h' : totalHours % 1 === 0 ? `${totalHours} h` : `${totalHours.toFixed(1)} h`
                    return (
                      <li
                        key={emp.id}
                        className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-gray-50/80 border-b border-gray-100 last:border-0"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-gray-900 truncate" title={emp.name}>{emp.name}</span>
                          <span className="block text-xs text-gray-500">{hoursLabel}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => router.push(`/schedules/week/edit?employee_id=${emp.id}&week_start=${format(weekStart, 'yyyy-MM-dd')}`)}
                            className="p-1.5 rounded-md text-gray-500 hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400"
                            title="Edit shifts"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSendSchedule(emp.id)}
                            disabled={sendingEmployeeId === emp.id}
                            className="p-1.5 rounded-md text-blue-600 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            title="Send schedule"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
                {filteredEmployees.length === 0 && (
                  <p className="text-xs text-gray-500 py-2">No employees in this view.</p>
                )}
              </aside>
            </div>
          )}

        {/* Create Shift Modal */}
        {showCreateModal && (
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-md flex items-center justify-center z-50 p-4"
            onClick={() => setShowCreateModal(false)}
          >
            <div 
              className="bg-white/85 backdrop-blur-xl rounded-2xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.2),0_0_0_1px_rgba(255,255,255,0.5)] border border-white/60 max-w-md w-full mx-4 transform transition-all"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-gray-200/60">
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
                        className="block w-full px-4 py-2.5 rounded-xl bg-white/90 border border-white/60 shadow-[inset_4px_4px_8px_rgba(0,0,0,0.04)] backdrop-blur-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-300/50 transition-all"
                        required
                      >
                        <option value="">Select Employee</option>
                        {filteredEmployees.map((emp) => (
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
                        <TimeInput12h
                          label="Start Time *"
                          value={formData.start_time || '09:00'}
                          onChange={(v) => setFormData({ ...formData, start_time: v })}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <TimeInput12h
                          label="End Time *"
                          value={formData.end_time || '17:00'}
                          onChange={(v) => setFormData({ ...formData, end_time: v })}
                          className="w-full"
                        />
                        <p className="mt-1 text-xs text-gray-500">For overnight (e.g. 11 PM–7 AM) set end next day: 7:00 AM</p>
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
                <div className="mt-8 flex justify-end space-x-3 pt-6 border-t border-gray-200/60">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-5 py-2.5 rounded-xl bg-white/80 text-gray-700 font-medium shadow-[4px_4px_10px_rgba(0,0,0,0.06),-4px_-4px_10px_rgba(255,255,255,0.8)] border border-white/50 hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.05)] hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-gray-400/30 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateShift}
                    className="px-5 py-2.5 bg-blue-500/90 text-white font-medium rounded-xl shadow-[6px_6px_14px_rgba(59,130,246,0.35),-2px_-2px_8px_rgba(255,255,255,0.2)] border border-white/30 backdrop-blur-sm hover:bg-blue-600 hover:shadow-[4px_4px_12px_rgba(59,130,246,0.4)] focus:outline-none focus:ring-2 focus:ring-blue-400/50 transition-all"
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

