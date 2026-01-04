'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import logger from '@/lib/logger'
import { format, startOfWeek, addWeeks, subWeeks, addDays } from 'date-fns'

interface Employee {
  id: string
  name: string
  email: string
}

interface DayTemplate {
  enabled: boolean
  start_time?: string
  end_time?: string
  break_minutes?: number
}

interface PreviewShift {
  employee_id: string
  employee_name?: string
  shift_date: string
  start_time: string
  end_time: string
  break_minutes: number
  status: string
  notes?: string
  job_role?: string
  has_conflict: boolean
  conflict_detail?: any
}

interface BulkWeekShiftPreviewResponse {
  shifts_to_create: PreviewShift[]
  conflicts: any[]
  total_shifts: number
  total_conflicts: number
}

export default function BulkWeekShiftPage() {
  const router = useRouter()
  const toast = useToast()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [preview, setPreview] = useState<BulkWeekShiftPreviewResponse | null>(null)
  
  // Week picker - always start from Monday
  const [currentWeek, setCurrentWeek] = useState(() => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    return isNaN(weekStart.getTime()) ? new Date() : weekStart
  })
  const weekStartDate = useMemo(() => {
    if (!currentWeek || isNaN(currentWeek.getTime())) {
      const validWeek = startOfWeek(new Date(), { weekStartsOn: 1 })
      return format(validWeek, 'yyyy-MM-dd')
    }
    return format(currentWeek, 'yyyy-MM-dd')
  }, [currentWeek])
  
  // Form state
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('')
  const [mode, setMode] = useState<'same_each_day' | 'per_day'>('same_each_day')
  const [timezone, setTimezone] = useState('America/Chicago')
  const [conflictPolicy, setConflictPolicy] = useState<'skip' | 'overwrite' | 'draft' | 'error'>('skip')
  
  // Template (for same_each_day mode)
  const [template, setTemplate] = useState({
    start_time: '09:00',
    end_time: '17:00',
    break_minutes: 30,
    status: 'DRAFT' as 'DRAFT' | 'PUBLISHED' | 'APPROVED',
    notes: '',
    job_role: '',
  })
  
  // Per-day configuration
  const [days, setDays] = useState<Record<string, DayTemplate>>({
    mon: { enabled: true },
    tue: { enabled: true },
    wed: { enabled: true },
    thu: { enabled: true },
    fri: { enabled: true },
    sat: { enabled: false },
    sun: { enabled: false },
  })
  
  const dayLabels = [
    { key: 'mon', label: 'Monday' },
    { key: 'tue', label: 'Tuesday' },
    { key: 'wed', label: 'Wednesday' },
    { key: 'thu', label: 'Thursday' },
    { key: 'fri', label: 'Friday' },
    { key: 'sat', label: 'Saturday' },
    { key: 'sun', label: 'Sunday' },
  ]
  
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const response = await api.get('/users/admin/employees')
        setEmployees(response.data || [])
      } catch (error: any) {
        logger.error('Failed to fetch employees', error as Error)
        toast.error('Failed to load employees')
      }
    }
    fetchEmployees()
  }, [toast])
  
  const updateDay = (dayKey: string, updates: Partial<DayTemplate>) => {
    setDays(prev => ({
      ...prev,
      [dayKey]: { ...prev[dayKey], ...updates },
    }))
  }
  
  const handlePreview = async () => {
    if (!selectedEmployeeId) {
      toast.error('Please select an employee')
      return
    }
    
    // Validate per_day mode
    if (mode === 'per_day') {
      const enabledDays = Object.entries(days).filter(([_, config]) => config.enabled)
      for (const [dayKey, config] of enabledDays) {
        if (!config.start_time || !config.end_time) {
          toast.error(`Please provide start and end times for ${dayLabels.find(d => d.key === dayKey)?.label}`)
          return
        }
      }
    }
    
    setPreviewing(true)
    try {
      const payload = {
        week_start_date: weekStartDate,
        timezone,
        employee_id: selectedEmployeeId,
        mode,
        template: {
          start_time: template.start_time,
          end_time: template.end_time,
          break_minutes: template.break_minutes,
          status: template.status,
          notes: template.notes || undefined,
          job_role: template.job_role || undefined,
        },
        days,
        conflict_policy: conflictPolicy,
      }
      
      const response = await api.post('/shifts/bulk/week/preview', payload)
      setPreview(response.data)
      toast.success(`Preview: ${response.data.total_shifts} shifts, ${response.data.total_conflicts} conflicts`)
    } catch (error: any) {
      logger.error('Failed to preview shifts', error as Error)
      toast.error(error.response?.data?.detail || 'Failed to preview shifts')
    } finally {
      setPreviewing(false)
    }
  }
  
  const handleCreate = async () => {
    if (!selectedEmployeeId) {
      toast.error('Please select an employee')
      return
    }
    
    // Validate per_day mode
    if (mode === 'per_day') {
      const enabledDays = Object.entries(days).filter(([_, config]) => config.enabled)
      for (const [dayKey, config] of enabledDays) {
        if (!config.start_time || !config.end_time) {
          toast.error(`Please provide start and end times for ${dayLabels.find(d => d.key === dayKey)?.label}`)
          return
        }
      }
    }
    
    setCreating(true)
    try {
      const payload = {
        week_start_date: weekStartDate,
        timezone,
        employee_id: selectedEmployeeId,
        mode,
        template: {
          start_time: template.start_time,
          end_time: template.end_time,
          break_minutes: template.break_minutes,
          status: template.status,
          notes: template.notes || undefined,
          job_role: template.job_role || undefined,
        },
        days,
        conflict_policy: conflictPolicy,
      }
      
      const response = await api.post('/shifts/bulk/week', payload)
      toast.success(
        `Created ${response.data.created_count} shifts. ` +
        (response.data.skipped_count > 0 ? `Skipped ${response.data.skipped_count}. ` : '') +
        (response.data.overwritten_count > 0 ? `Overwritten ${response.data.overwritten_count}. ` : '')
      )
      router.push('/schedules')
    } catch (error: any) {
      logger.error('Failed to create shifts', error as Error)
      if (error.response?.status === 409) {
        toast.error('Conflicts detected. Please review and adjust conflict policy.')
        setPreview(error.response.data.detail)
      } else {
        toast.error(error.response?.data?.detail || 'Failed to create shifts')
      }
    } finally {
      setCreating(false)
    }
  }
  
  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Create Shifts for Week</h1>
          <p className="text-gray-600">Create shifts for an employee for an entire week</p>
        </div>
        
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          {/* Week Picker */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Week Starting (Monday)
            </label>
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  if (currentWeek && !isNaN(currentWeek.getTime())) {
                    const newWeek = subWeeks(currentWeek, 1)
                    if (!isNaN(newWeek.getTime())) {
                      setCurrentWeek(newWeek)
                    }
                  }
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                ← Previous
              </button>
              <input
                type="date"
                value={weekStartDate}
                onChange={(e) => {
                  if (!e.target.value) return
                  const date = new Date(e.target.value)
                  if (!isNaN(date.getTime())) {
                    const weekStart = startOfWeek(date, { weekStartsOn: 1 })
                    if (!isNaN(weekStart.getTime())) {
                      setCurrentWeek(weekStart)
                    }
                  }
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg"
              />
              <span className="text-gray-600">
                {currentWeek && !isNaN(currentWeek.getTime()) 
                  ? `${format(currentWeek, 'MMM d')} - ${format(addDays(currentWeek, 6), 'MMM d, yyyy')}`
                  : 'Invalid date'
                }
              </span>
              <button
                onClick={() => {
                  if (currentWeek && !isNaN(currentWeek.getTime())) {
                    const newWeek = addWeeks(currentWeek, 1)
                    if (!isNaN(newWeek.getTime())) {
                      setCurrentWeek(newWeek)
                    }
                  }
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Next →
              </button>
            </div>
          </div>
          
          {/* Employee Selection */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Employee <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              className="block w-full md:w-64 px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              required
            >
              <option value="">Select Employee</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>
          
          {/* Mode Toggle */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">Mode</label>
            <div className="flex gap-4">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="same_each_day"
                  checked={mode === 'same_each_day'}
                  onChange={(e) => setMode(e.target.value as any)}
                  className="text-blue-600 focus:ring-blue-500"
                />
                <span>Same Schedule Each Day</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="per_day"
                  checked={mode === 'per_day'}
                  onChange={(e) => setMode(e.target.value as any)}
                  className="text-blue-600 focus:ring-blue-500"
                />
                <span>Different Schedule Per Day</span>
              </label>
            </div>
          </div>
          
          {/* Template (Same Each Day Mode) */}
          {mode === 'same_each_day' && (
            <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Start Time</label>
                <input
                  type="time"
                  value={template.start_time}
                  onChange={(e) => setTemplate({ ...template, start_time: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">End Time</label>
                <input
                  type="time"
                  value={template.end_time}
                  onChange={(e) => setTemplate({ ...template, end_time: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Break (min)</label>
                <input
                  type="number"
                  value={template.break_minutes}
                  onChange={(e) => setTemplate({ ...template, break_minutes: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                <select
                  value={template.status}
                  onChange={(e) => setTemplate({ ...template, status: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="APPROVED">Approved</option>
                </select>
              </div>
            </div>
          )}
          
          {/* Per Day Configuration */}
          {mode === 'per_day' && (
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">Day Configuration</label>
              <div className="space-y-3">
                {dayLabels.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-4 p-3 border border-gray-200 rounded-lg">
                    <label className="flex items-center space-x-2 min-w-[120px]">
                      <input
                        type="checkbox"
                        checked={days[key].enabled}
                        onChange={(e) => updateDay(key, { enabled: e.target.checked })}
                        className="rounded border-gray-300 text-blue-600"
                      />
                      <span className="text-sm font-medium">{label}</span>
                    </label>
                    {days[key].enabled && (
                      <>
                        <input
                          type="time"
                          placeholder="Start"
                          value={days[key].start_time || ''}
                          onChange={(e) => updateDay(key, { start_time: e.target.value })}
                          className="px-3 py-1.5 border border-gray-300 rounded text-sm"
                        />
                        <span className="text-gray-400">-</span>
                        <input
                          type="time"
                          placeholder="End"
                          value={days[key].end_time || ''}
                          onChange={(e) => updateDay(key, { end_time: e.target.value })}
                          className="px-3 py-1.5 border border-gray-300 rounded text-sm"
                        />
                        <input
                          type="number"
                          placeholder="Break (min)"
                          value={days[key].break_minutes || ''}
                          onChange={(e) => updateDay(key, { break_minutes: parseInt(e.target.value) || 0 })}
                          className="px-3 py-1.5 border border-gray-300 rounded text-sm w-24"
                          min="0"
                        />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Days Selection */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">Enabled Days</label>
            <div className="flex flex-wrap gap-2">
              {dayLabels.map(({ key, label }) => (
                <label key={key} className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={days[key].enabled}
                    onChange={(e) => updateDay(key, { enabled: e.target.checked })}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </div>
          
          {/* Conflict Policy */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">Conflict Policy</label>
            <select
              value={conflictPolicy}
              onChange={(e) => setConflictPolicy(e.target.value as any)}
              className="w-full md:w-64 px-3 py-2 border border-gray-300 rounded-lg"
            >
              <option value="skip">Skip conflicting shifts</option>
              <option value="overwrite">Overwrite conflicting shifts</option>
              <option value="draft">Create as draft with conflict note</option>
              <option value="error">Reject if conflicts exist</option>
            </select>
          </div>
          
          {/* Timezone */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">Timezone</label>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full md:w-64 px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="America/Chicago"
            />
            <p className="text-xs text-gray-500 mt-1">IANA timezone identifier (e.g., America/Chicago)</p>
          </div>
          
          {/* Actions */}
          <div className="flex gap-4">
            <button
              onClick={handlePreview}
              disabled={previewing || creating}
              className="px-6 py-2.5 bg-gray-600 text-white font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50"
            >
              {previewing ? 'Previewing...' : 'Preview'}
            </button>
            <button
              onClick={handleCreate}
              disabled={previewing || creating}
              className="px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Shifts'}
            </button>
          </div>
        </div>
        
        {/* Preview Results */}
        {preview && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Preview Results</h2>
            
            <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="text-sm text-gray-600">Total Shifts</div>
                <div className="text-2xl font-bold text-blue-600">{preview.total_shifts}</div>
              </div>
              <div className="p-3 bg-red-50 rounded-lg">
                <div className="text-sm text-gray-600">Conflicts</div>
                <div className="text-2xl font-bold text-red-600">{preview.total_conflicts}</div>
              </div>
            </div>
            
            {preview.conflicts.length > 0 && (
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Conflicts</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {preview.conflicts.map((conflict: any, idx: number) => (
                    <div key={idx} className="p-3 bg-red-50 border border-red-200 rounded text-sm">
                      <strong>{conflict.employee_name}</strong> on {conflict.shift_date}: {conflict.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {preview.shifts_to_create.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Shifts to Create</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {preview.shifts_to_create.slice(0, 50).map((shift, idx) => (
                    <div
                      key={idx}
                      className={`p-3 border rounded text-sm ${
                        shift.has_conflict ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <strong>{shift.employee_name}</strong> - {shift.shift_date}: {shift.start_time} - {shift.end_time}
                      {shift.has_conflict && <span className="ml-2 text-yellow-600">(Conflict)</span>}
                    </div>
                  ))}
                  {preview.shifts_to_create.length > 50 && (
                    <div className="text-sm text-gray-500 p-2">
                      ... and {preview.shifts_to_create.length - 50} more shifts
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}

