'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import logger from '@/lib/logger'
import { format, startOfWeek, endOfWeek, addDays, addWeeks, subWeeks, parseISO } from 'date-fns'
import { parseTime24, toApiTime24 } from '@/lib/time'
import { buildSchedulePrintHtml, printScheduleHtml } from '@/lib/schedulePrintExport'
import { getCurrentUser } from '@/lib/auth'
import { ShiftTimeline } from '@/components/ShiftTimeline'
import TimeInput12h from '@/components/TimeInput12h'
import ConfirmationDialog from '@/components/ConfirmationDialog'

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

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function formatHoursLabel(totalMinutes: number) {
  const totalHours = totalMinutes / 60
  if (totalHours === 0) return '0 h'
  if (totalHours % 1 === 0) return `${totalHours} h`
  return `${totalHours.toFixed(1)} h`
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
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
  const [sendScheduleTarget, setSendScheduleTarget] = useState<{
    id: string
    name: string
    email: string
  } | null>(null)
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
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [showBulkEditModal, setShowBulkEditModal] = useState(false)
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkEditForm, setBulkEditForm] = useState({
    applyStart: false,
    start_time: '09:00',
    applyEnd: false,
    end_time: '17:00',
    applyBreak: false,
    break_minutes: '0',
    status: '',
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

  const weekStats = useMemo(() => {
    const weekStartStrOnly = format(weekStart, 'yyyy-MM-dd')
    const weekEndStrOnly = format(weekEnd, 'yyyy-MM-dd')
    const weekShifts = filteredShifts.filter(
      (s) => s.shift_date >= weekStartStrOnly && s.shift_date <= weekEndStrOnly
    )
    const totalMinutes = Object.values(employeeWeekTotals).reduce((sum, m) => sum + m, 0)
    const staffScheduled = Object.values(employeeWeekTotals).filter((m) => m > 0).length
    const drafts = weekShifts.filter((s) => s.status?.toUpperCase() === 'DRAFT').length
    const published = weekShifts.filter((s) => {
      const st = s.status?.toUpperCase()
      return st === 'PUBLISHED' || st === 'APPROVED'
    }).length
    return {
      shifts: weekShifts.length,
      totalHoursLabel: formatHoursLabel(totalMinutes),
      staffScheduled,
      staffInView: filteredEmployees.length,
      drafts,
      published,
    }
  }, [filteredShifts, employeeWeekTotals, filteredEmployees.length, weekStart, weekEnd])

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

  // Single batch: employees + shifts in range + timeline hours (GET /schedules/view-context)
  useEffect(() => {
    if (authErrorOccurred) {
      setLoading(false)
      return
    }

    const abortController = new AbortController()
    let isMounted = true

    const load = async () => {
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
        const response = await api.get(`/schedules/view-context?${params.toString()}`, {
          signal: abortController.signal,
        })
        const data = response.data as {
          employees: Employee[]
          shifts: Shift[]
          schedule_day_start_hour?: number
          schedule_day_end_hour?: number
        }
        if (isMounted && !authErrorOccurred) {
          setEmployees(data.employees || [])
          setShifts(data.shifts || [])
          setScheduleDayStartHour(data.schedule_day_start_hour ?? 7)
          setScheduleDayEndHour(data.schedule_day_end_hour ?? 7)
        }
      } catch (error: unknown) {
        if (abortController.signal.aborted) return
        if (!isMounted) return
        const err = error as { response?: { status?: number } }
        if (err.response?.status === 401 || err.response?.status === 403) {
          setAuthErrorOccurred(true)
          setLoading(false)
          return
        }
        if (isMounted && !authErrorOccurred) {
          logger.error('Failed to load schedule', error as Error)
          toast.error('Failed to load schedule')
        }
      } finally {
        if (isMounted && !authErrorOccurred) {
          setLoading(false)
        }
      }
    }

    void load()

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

  const openSendScheduleDialog = (employeeId: string, employeeName: string, employeeEmail: string) => {
    setSendScheduleTarget({ id: employeeId, name: employeeName, email: employeeEmail })
  }

  const executeSendSchedule = async (employeeId: string) => {
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

  const handleConfirmSendSchedule = () => {
    if (!sendScheduleTarget) return
    const id = sendScheduleTarget.id
    setSendScheduleTarget(null)
    void executeSendSchedule(id)
  }

  const clearSelection = () => setSelectedIds(new Set())

  const setSelectionModeOn = (on: boolean) => {
    setSelectionMode(on)
    if (!on) clearSelection()
  }

  const toggleSelectShift = (shiftId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(shiftId)) next.delete(shiftId)
      else next.add(shiftId)
      return next
    })
  }

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setBulkBusy(true)
    try {
      const res = await api.post('/shifts/bulk/delete', { shift_ids: ids })
      const data = res.data as { deleted?: number; failed?: Array<{ id: string; detail: string }> }
      const deleted = data.deleted ?? 0
      const failed = data.failed ?? []
      if (deleted > 0) toast.success(`Deleted ${deleted} shift${deleted === 1 ? '' : 's'}`)
      if (failed.length > 0) {
        toast.error(`${failed.length} could not be deleted`)
      }
      clearSelection()
      setShowBulkDeleteConfirm(false)
      await refetchShifts()
    } catch (error: unknown) {
      const err = error as { response?: { status?: number; data?: { detail?: string } } }
      if (err.response?.status === 401 || err.response?.status === 403) {
        setAuthErrorOccurred(true)
        return
      }
      toast.error(err.response?.data?.detail || 'Bulk delete failed')
    } finally {
      setBulkBusy(false)
    }
  }

  const handleBulkEdit = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const payload: Record<string, unknown> = { shift_ids: ids }
    if (bulkEditForm.applyStart) payload.start_time = toApiTime24(bulkEditForm.start_time)
    if (bulkEditForm.applyEnd) payload.end_time = toApiTime24(bulkEditForm.end_time)
    if (bulkEditForm.applyBreak) {
      payload.break_minutes = parseInt(bulkEditForm.break_minutes, 10) || 0
    }
    if (bulkEditForm.status) payload.status = bulkEditForm.status
    if (
      !payload.start_time &&
      !payload.end_time &&
      payload.break_minutes === undefined &&
      !payload.status
    ) {
      toast.error('Change at least one field')
      return
    }
    setBulkBusy(true)
    try {
      const res = await api.post('/shifts/bulk/update', payload)
      const data = res.data as { updated?: number; failed?: Array<{ id: string; detail: string }> }
      const updated = data.updated ?? 0
      const failed = data.failed ?? []
      if (updated > 0) toast.success(`Updated ${updated} shift${updated === 1 ? '' : 's'}`)
      if (failed.length > 0) {
        toast.error(`${failed.length} could not be updated`)
      }
      setShowBulkEditModal(false)
      setBulkEditForm({
        applyStart: false,
        start_time: '09:00',
        applyEnd: false,
        end_time: '17:00',
        applyBreak: false,
        break_minutes: '0',
        status: '',
      })
      clearSelection()
      await refetchShifts()
    } catch (error: unknown) {
      const err = error as { response?: { status?: number; data?: { detail?: string } } }
      if (err.response?.status === 401 || err.response?.status === 403) {
        setAuthErrorOccurred(true)
        return
      }
      const detail = err.response?.data?.detail
      toast.error(typeof detail === 'string' ? detail : 'Bulk update failed')
    } finally {
      setBulkBusy(false)
    }
  }

  /** Print / Save as PDF using professional schedule template (see `schedulePrintExport.ts`). */
  const handlePrintSchedule = async () => {
    const sortedEmployees = [...filteredEmployees]
      .map((emp) => ({ id: emp.id, name: emp.name || 'Unknown', role: emp.role }))
      .sort((a, b) => a.name.localeCompare(b.name))

    if (sortedEmployees.length === 0) {
      toast.error('No employees to show in the schedule.')
      return
    }

    let companyName = 'Company'
    try {
      const user = await getCurrentUser()
      if (user.company_name?.trim()) companyName = user.company_name.trim()
    } catch {
      /* keep default */
    }

    const html = buildSchedulePrintHtml({
      companyName,
      weekStart,
      weekEnd,
      weekDays,
      employees: sortedEmployees,
      shifts: filteredShifts,
    })

    const filenameBase = `schedule-${format(weekStart, 'yyyy-MM-dd')}`
    if (!printScheduleHtml(html, filenameBase)) {
      toast.error('Could not open print preview.')
    }
  }

  return (
    <Layout>
      <div className="relative mx-auto max-w-[1600px]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-4 h-52 overflow-hidden"
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(15,23,42,0.06),_transparent_65%)]" />
          <div
            className="absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgb(226 232 240 / 0.55) 1px, transparent 1px), linear-gradient(to bottom, rgb(226 232 240 / 0.55) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
              maskImage: 'linear-gradient(to bottom, black, transparent)',
            }}
          />
        </div>

        <div className="relative space-y-6 pb-8">
          <header className="overflow-hidden rounded-2xl border border-slate-800/10 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.45)]">
            <div className="relative bg-slate-900 px-5 py-6 sm:px-7 sm:py-8 text-white">
              <div
                aria-hidden
                className="absolute inset-0 opacity-40"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 12% 20%, rgba(45,212,191,0.28), transparent 42%), radial-gradient(circle at 88% 10%, rgba(59,130,246,0.22), transparent 36%)',
                }}
              />
              <div
                aria-hidden
                className="absolute inset-y-0 right-0 w-1/2 opacity-[0.07]"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(-32deg, transparent, transparent 10px, white 10px, white 11px)',
                }}
              />
              <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Scheduling · Weekly
                  </p>
                  <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight">
                    Schedules
                  </h1>
                  <p className="mt-2 max-w-lg text-sm text-slate-300 leading-relaxed">
                    Plan the week, assign shifts, and keep the floor covered.
                  </p>
                  <p className="mt-3 text-sm font-medium text-teal-200/90 tabular-nums">
                    {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handlePrintSchedule}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm font-medium text-slate-100 hover:bg-white/10 transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                      />
                    </svg>
                    Print / Export
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/schedules/week')}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm font-medium text-slate-100 hover:bg-white/10 transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    Bulk shifts
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(true)}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-colors shadow-sm"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    Create shift
                  </button>
                </div>
              </div>
            </div>
          </header>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Shifts" value={weekStats.shifts} hint="This week" />
            <StatCard label="Total hours" value={weekStats.totalHoursLabel} hint="Scheduled time" />
            <StatCard
              label="Staff scheduled"
              value={weekStats.staffScheduled}
              hint={`${weekStats.staffInView} in view`}
            />
            {weekStats.drafts > 0 ? (
              <StatCard label="Drafts" value={weekStats.drafts} hint="Not published yet" />
            ) : (
              <StatCard
                label="Published"
                value={weekStats.published}
                hint={weekStats.published > 0 ? 'Ready for the floor' : 'No published shifts'}
              />
            )}
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
              <div className="lg:col-span-2">
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 mb-1.5">
                  Department
                </label>
                <select
                  value={selectedDepartment}
                  onChange={(e) => {
                    setSelectedDepartment(e.target.value)
                    if (selectedEmployee && e.target.value) {
                      const nextFiltered = employees.filter(
                        (emp: Employee) => emp.role === e.target.value
                      )
                      if (!nextFiltered.some((emp: Employee) => emp.id === selectedEmployee)) {
                        setSelectedEmployee('')
                      }
                    }
                  }}
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
                >
                  <option value="">All Departments</option>
                  <option value="FRONTDESK">Front Desk</option>
                  <option value="HOUSEKEEPING">Housekeeping</option>
                  <option value="MAINTENANCE">Maintenance</option>
                </select>
              </div>
              <div className="lg:col-span-2">
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 mb-1.5">
                  Employee
                </label>
                <select
                  value={selectedEmployee}
                  onChange={(e) => setSelectedEmployee(e.target.value)}
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
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
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 mb-1.5">
                  Week
                </label>
                <div className="flex items-center rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                  <button
                    type="button"
                    onClick={() => {
                      clearSelection()
                      setCurrentWeek(subWeeks(currentWeek, 1))
                    }}
                    className="p-2.5 text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-900/10 transition-colors"
                    aria-label="Previous week"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                  </button>
                  <div className="flex-1 px-3 py-2.5 border-x border-slate-200 bg-slate-50/50 text-center">
                    <span className="text-sm font-semibold text-slate-900 tabular-nums">
                      {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      clearSelection()
                      setCurrentWeek(addWeeks(currentWeek, 1))
                    }}
                    className="p-2.5 text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-900/10 transition-colors"
                    aria-label="Next week"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="lg:col-span-2">
                <button
                  type="button"
                  onClick={() => {
                    clearSelection()
                    setCurrentWeek(new Date())
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-900/10 transition-colors"
                >
                  This week
                </button>
              </div>

              <div className="lg:col-span-2">
                <button
                  type="button"
                  onClick={() => setSelectionModeOn(!selectionMode)}
                  className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 transition-colors ${
                    selectionMode
                      ? 'bg-slate-900 text-white hover:bg-slate-800'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {selectionMode ? 'Selecting…' : 'Select'}
                </button>
              </div>
            </div>
            {selectionMode && (
              <p className="mt-2 text-xs text-slate-500">
                Click shifts on the chart to select them, then edit or delete together.
              </p>
            )}
          </div>

          {selectedIds.size > 0 && (
            <div className="sticky top-2 z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800/10 bg-slate-900 px-4 py-3 text-white shadow-lg">
              <span className="text-sm font-medium tabular-nums">
                {selectedIds.size} selected
              </span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={clearSelection}
                disabled={bulkBusy}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-white/10 disabled:opacity-50"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  setBulkEditForm({
                    applyStart: false,
                    start_time: '09:00',
                    applyEnd: false,
                    end_time: '17:00',
                    applyBreak: false,
                    break_minutes: '0',
                    status: '',
                  })
                  setShowBulkEditModal(true)
                }}
                disabled={bulkBusy}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/15 disabled:opacity-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setShowBulkDeleteConfirm(true)}
                disabled={bulkBusy}
                className="rounded-lg bg-red-500/90 px-3 py-1.5 text-sm font-semibold hover:bg-red-500 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex gap-4">
              <div className="flex-1 min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm p-4 space-y-3">
                <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
                <div className="h-[480px] animate-pulse rounded-xl bg-slate-100" />
              </div>
              <aside className="hidden lg:block w-[260px] flex-shrink-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm p-4 space-y-2">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </aside>
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex-1 min-w-0 max-h-[calc(100vh-200px)] overflow-auto min-h-[540px] rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                <ShiftTimeline
                  shifts={filteredShifts}
                  weekDays={weekDays}
                  onShiftClick={(s) => router.push(`/schedules/shift/${s.id}`)}
                  loading={loading}
                  today={new Date()}
                  dayStartHour={scheduleDayStartHour}
                  dayEndHour={scheduleDayEndHour}
                  selectionMode={selectionMode}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelectShift}
                />
              </div>

              <aside className="w-full lg:w-[260px] flex-shrink-0 rounded-2xl border border-slate-200/80 bg-white shadow-sm max-h-[calc(100vh-200px)] overflow-auto">
                <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                    Employees
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">Week totals · edit · send</p>
                </div>
                <ul className="p-2 space-y-0.5">
                  {filteredEmployees.map((emp) => {
                    const totalMinutes = employeeWeekTotals[emp.id] ?? 0
                    const hoursLabel = formatHoursLabel(totalMinutes)
                    return (
                      <li
                        key={emp.id}
                        className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                          {initials(emp.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span
                            className="block text-sm font-medium text-slate-900 truncate"
                            title={emp.name}
                          >
                            {emp.name}
                          </span>
                          <span className="block text-xs text-slate-500 tabular-nums">
                            {hoursLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              router.push(
                                `/schedules/week/edit?employee_id=${emp.id}&week_start=${format(weekStart, 'yyyy-MM-dd')}`
                              )
                            }
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                            title="Edit shifts"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openSendScheduleDialog(emp.id, emp.name, emp.email)
                            }
                            disabled={sendingEmployeeId === emp.id}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                            title="Send schedule"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                              />
                            </svg>
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
                {filteredEmployees.length === 0 && (
                  <p className="px-4 py-6 text-sm text-slate-500 text-center">
                    No employees in this view.
                  </p>
                )}
              </aside>
            </div>
          )}
        </div>

        {showCreateModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
            onClick={() => setShowCreateModal(false)}
          >
            <div
              className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-slate-100 bg-slate-900 px-5 py-4 text-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      New assignment
                    </p>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight">Create shift</h2>
                    <p className="mt-1 text-sm text-slate-300">Schedule one employee for a day</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                    aria-label="Close"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="p-5">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Employee <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.employee_id}
                      onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                      className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
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
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={formData.shift_date}
                      onChange={(e) => setFormData({ ...formData, shift_date: e.target.value })}
                      className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
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
                      <p className="mt-1 text-xs text-slate-500">
                        Overnight: end next morning (e.g. 7:00 AM)
                      </p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Break (minutes)
                    </label>
                    <input
                      type="number"
                      value={formData.break_minutes}
                      onChange={(e) =>
                        setFormData({ ...formData, break_minutes: parseInt(e.target.value) || 0 })
                      }
                      className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
                      min="0"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes</label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300 resize-none"
                      rows={3}
                      placeholder="Optional notes for this shift…"
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 bg-slate-50/80">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-900/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateShift}
                  className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/20 transition-colors"
                >
                  Create shift
                </button>
              </div>
            </div>
          </div>
        )}

        {showBulkEditModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
            onClick={() => !bulkBusy && setShowBulkEditModal(false)}
          >
            <div
              className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-slate-100 bg-slate-900 px-5 py-4 text-white">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  Bulk edit
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">
                  Edit {selectedIds.size} shift{selectedIds.size === 1 ? '' : 's'}
                </h2>
                <p className="mt-1 text-sm text-slate-300">
                  Only checked fields are applied to every selected shift.
                </p>
              </div>
              <div className="p-5 space-y-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={bulkEditForm.applyStart}
                    onChange={(e) =>
                      setBulkEditForm({ ...bulkEditForm, applyStart: e.target.checked })
                    }
                    className="mt-1 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-slate-700 mb-1.5">
                      Start time
                    </span>
                    <TimeInput12h
                      label=""
                      value={bulkEditForm.start_time}
                      onChange={(v) => setBulkEditForm({ ...bulkEditForm, start_time: v })}
                      disabled={!bulkEditForm.applyStart}
                      className="w-full"
                    />
                  </span>
                </label>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={bulkEditForm.applyEnd}
                    onChange={(e) =>
                      setBulkEditForm({ ...bulkEditForm, applyEnd: e.target.checked })
                    }
                    className="mt-1 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-slate-700 mb-1.5">
                      End time
                    </span>
                    <TimeInput12h
                      label=""
                      value={bulkEditForm.end_time}
                      onChange={(v) => setBulkEditForm({ ...bulkEditForm, end_time: v })}
                      disabled={!bulkEditForm.applyEnd}
                      className="w-full"
                    />
                  </span>
                </label>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={bulkEditForm.applyBreak}
                    onChange={(e) =>
                      setBulkEditForm({ ...bulkEditForm, applyBreak: e.target.checked })
                    }
                    className="mt-1 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-slate-700 mb-1.5">
                      Break (minutes)
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={bulkEditForm.break_minutes}
                      disabled={!bulkEditForm.applyBreak}
                      onChange={(e) =>
                        setBulkEditForm({ ...bulkEditForm, break_minutes: e.target.value })
                      }
                      className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </span>
                </label>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Status (optional)
                  </label>
                  <select
                    value={bulkEditForm.status}
                    onChange={(e) =>
                      setBulkEditForm({ ...bulkEditForm, status: e.target.value })
                    }
                    className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
                  >
                    <option value="">Leave unchanged</option>
                    <option value="DRAFT">Draft</option>
                    <option value="PUBLISHED">Published</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 bg-slate-50/80">
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => setShowBulkEditModal(false)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={handleBulkEdit}
                  className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                >
                  {bulkBusy ? 'Saving…' : 'Apply to selected'}
                </button>
              </div>
            </div>
          </div>
        )}

        <ConfirmationDialog
          isOpen={showBulkDeleteConfirm}
          type="warning"
          title="Delete selected shifts?"
          message={`You are about to delete ${selectedIds.size} shift${selectedIds.size === 1 ? '' : 's'}. This cannot be undone from the schedule view.`}
          confirmText={bulkBusy ? 'Deleting…' : 'Delete'}
          cancelText="Cancel"
          onConfirm={() => {
            if (!bulkBusy) void handleBulkDelete()
          }}
          onCancel={() => {
            if (!bulkBusy) setShowBulkDeleteConfirm(false)
          }}
        />

        <ConfirmationDialog
          isOpen={!!sendScheduleTarget}
          type="warning"
          title="Send email to employee?"
          message={
            sendScheduleTarget
              ? `You are about to send an email to this employee.\n\nEmployee: ${sendScheduleTarget.name}\nEmail will be sent to: ${sendScheduleTarget.email || 'their registered email address'}\n\nDo you want to continue?`
              : ''
          }
          confirmText="Send email"
          cancelText="Cancel"
          onConfirm={handleConfirmSendSchedule}
          onCancel={() => setSendScheduleTarget(null)}
        />
      </div>
    </Layout>
  )
}

