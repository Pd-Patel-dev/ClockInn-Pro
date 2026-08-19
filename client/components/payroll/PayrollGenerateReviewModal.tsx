'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import api from '@/lib/api'
import logger from '@/lib/logger'
import { ButtonSpinner } from '@/components/LoadingSpinner'

export type PayrollGenerateFormValues = {
  payroll_type: 'WEEKLY' | 'BIWEEKLY'
  start_date: string
  include_inactive: boolean
  entry_hour_overrides?: Record<string, number>
}

type ReviewEntry = {
  id: string
  clock_in_at: string | null
  clock_out_at: string | null
  clock_in_local: string | null
  clock_out_local: string | null
  break_minutes: number
  status: string | null
  minutes: number
  hours: number
  is_open: boolean
  note: string | null
}

type ReviewEmployee = {
  employee_id: string
  employee_name: string
  pay_rate_cents: number
  overtime_multiplier: number
  regular_minutes: number
  overtime_minutes: number
  total_minutes: number
  total_hours: number
  exceptions_count: number
  entry_count: number
  open_entry_count: number
  entries: ReviewEntry[]
}

type ReviewPreview = {
  payroll_type: string
  period_start: string
  period_end: string
  timezone: string
  breaks_paid: boolean
  employee_count: number
  employees: ReviewEmployee[]
}

type Props = {
  open: boolean
  scheduleLocked: boolean
  nextPayDate?: string | null
  initialValues: PayrollGenerateFormValues
  generating: boolean
  onClose: () => void
  onGenerate: (values: PayrollGenerateFormValues) => Promise<void>
  onError: (message: string) => void
  onInfo: (message: string) => void
}

function formatHours(hours: number) {
  return `${Number(hours || 0).toFixed(2)}h`
}

function formatPeriodLabel(start: string, end: string) {
  try {
    return `${format(parseISO(start), 'MMM d')} – ${format(parseISO(end), 'MMM d, yyyy')}`
  } catch {
    return `${start} – ${end}`
  }
}

function parseDraftHours(raw: string | undefined, fallback: number) {
  if (raw === undefined || raw === '') return fallback
  const hours = parseFloat(raw)
  return Number.isFinite(hours) ? hours : fallback
}

function entryDisplayHours(entry: ReviewEntry, drafts: Record<string, string>) {
  return parseDraftHours(drafts[entry.id], entry.hours || 0)
}

function employeeDisplayHours(emp: ReviewEmployee, drafts: Record<string, string>) {
  return emp.entries.reduce((sum, entry) => sum + entryDisplayHours(entry, drafts), 0)
}

function applyDraftHoursToEmployee(
  emp: ReviewEmployee,
  drafts: Record<string, string>
): ReviewEmployee {
  const entries = emp.entries.map((entry) => {
    const hours = entryDisplayHours(entry, drafts)
    const minutes = Math.max(0, Math.round(hours * 60))
    return {
      ...entry,
      hours,
      minutes,
      is_open: false,
    }
  })
  const total_minutes = entries.reduce((sum, entry) => sum + entry.minutes, 0)
  return {
    ...emp,
    entries,
    total_minutes,
    total_hours: Math.round((total_minutes / 60) * 100) / 100,
    regular_minutes: total_minutes,
    overtime_minutes: 0,
    open_entry_count: 0,
  }
}

export default function PayrollGenerateReviewModal({
  open,
  scheduleLocked,
  nextPayDate,
  initialValues,
  generating,
  onClose,
  onGenerate,
  onError,
  onInfo,
}: Props) {
  const [step, setStep] = useState<'setup' | 'review'>('setup')
  const [payrollType, setPayrollType] = useState<PayrollGenerateFormValues['payroll_type']>(
    initialValues.payroll_type
  )
  const [startDate, setStartDate] = useState(initialValues.start_date)
  const [includeInactive, setIncludeInactive] = useState(initialValues.include_inactive)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [preview, setPreview] = useState<ReviewPreview | null>(null)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [verifiedIds, setVerifiedIds] = useState<Set<string>>(new Set())
  const [hoursDraft, setHoursDraft] = useState<Record<string, string>>({})
  const [savingEntryId, setSavingEntryId] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const hourOverridesRef = useRef<Record<string, number>>({})

  useEffect(() => {
    if (!open) return
    setStep('setup')
    setPayrollType(initialValues.payroll_type)
    setStartDate(initialValues.start_date)
    setIncludeInactive(initialValues.include_inactive)
    setPreview(null)
    setSelectedEmployeeId(null)
    setVerifiedIds(new Set())
    setHoursDraft({})
    hourOverridesRef.current = {}
  }, [open, initialValues])

  const selectedEmployee = useMemo(
    () => preview?.employees.find((e) => e.employee_id === selectedEmployeeId) || null,
    [preview, selectedEmployeeId]
  )

  const allVerified =
    !!preview &&
    preview.employees.length > 0 &&
    preview.employees.every((e) => verifiedIds.has(e.employee_id))

  const verifiedCount = preview
    ? preview.employees.filter((e) => verifiedIds.has(e.employee_id)).length
    : 0

  const computedEnd = useMemo(() => {
    if (!startDate) return ''
    try {
      const start = parseISO(startDate)
      const days = payrollType === 'BIWEEKLY' ? 13 : 6
      const end = new Date(start)
      end.setDate(end.getDate() + days)
      return end.toISOString().slice(0, 10)
    } catch {
      return ''
    }
  }, [startDate, payrollType])

  const syncOverridesFromDrafts = (drafts: Record<string, string>, employees: ReviewEmployee[]) => {
    const next = { ...hourOverridesRef.current }
    employees.forEach((emp) => {
      emp.entries.forEach((entry) => {
        next[entry.id] = entryDisplayHours(entry, drafts)
      })
    })
    hourOverridesRef.current = next
    return next
  }

  const loadPreview = useCallback(async () => {
    if (!startDate) {
      onError('Period start is required')
      return
    }
    setLoadingPreview(true)
    try {
      const params = new URLSearchParams({
        payroll_type: payrollType,
        start_date: startDate,
        include_inactive: String(includeInactive),
      })
      const response = await api.get(`/admin/payroll/review-preview?${params}`)
      const data = response.data as ReviewPreview
      setPreview(data)
      setVerifiedIds(new Set())
      setSelectedEmployeeId(data.employees[0]?.employee_id || null)
      const drafts: Record<string, string> = {}
      data.employees.forEach((emp) => {
        emp.entries.forEach((entry) => {
          drafts[entry.id] = entry.is_open ? '' : String(entry.hours)
        })
      })
      setHoursDraft(drafts)
      syncOverridesFromDrafts(drafts, data.employees)
      setStep('review')
      if (!data.employees.length) {
        onError('No employees with pay rates found for this period')
      }
    } catch (error: any) {
      logger.error('Failed to load payroll review preview', error as Error, {
        endpoint: '/admin/payroll/review-preview',
      })
      onError(error.response?.data?.detail || 'Failed to load employees for review')
    } finally {
      setLoadingPreview(false)
    }
  }, [payrollType, startDate, includeInactive, onError])

  const persistEntryHours = async (entry: ReviewEntry, hours: number) => {
    await api.put(`/admin/payroll/review-entries/${entry.id}/hours`, {
      hours,
      break_minutes: entry.break_minutes,
      edit_reason: 'Payroll review hours adjustment',
    })
    hourOverridesRef.current[entry.id] = hours
  }

  const saveEmployeeHours = async (employee: ReviewEmployee, drafts: Record<string, string>) => {
    for (const entry of employee.entries) {
      const hours = entryDisplayHours(entry, drafts)
      if (hours < 0 || !Number.isFinite(hours)) {
        throw new Error(`Enter valid hours for ${employee.employee_name}`)
      }
      // Open punches must have hours typed
      if (entry.is_open && (drafts[entry.id] === undefined || drafts[entry.id] === '')) {
        throw new Error(`Set hours for open punch for ${employee.employee_name}`)
      }
      setSavingEntryId(entry.id)
      await persistEntryHours(entry, hours)
    }
    // Update local preview so totals/hours match what was typed
    setPreview((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        employees: prev.employees.map((emp) =>
          emp.employee_id === employee.employee_id
            ? applyDraftHoursToEmployee(emp, drafts)
            : emp
        ),
      }
    })
    setHoursDraft((prev) => {
      const next = { ...prev }
      employee.entries.forEach((entry) => {
        next[entry.id] = String(entryDisplayHours(entry, drafts))
      })
      return next
    })
  }

  const verifySelectedEmployee = async () => {
    if (!selectedEmployee || !preview) return
    setVerifying(true)
    try {
      try {
        await saveEmployeeHours(selectedEmployee, hoursDraft)
      } catch (error: any) {
        onError(
          error?.response?.data?.detail ||
            error?.message ||
            'Failed to save hours before verify'
        )
        return
      }

      const currentId = selectedEmployee.employee_id
      const employees = preview.employees
      const currentIndex = employees.findIndex((e) => e.employee_id === currentId)

      const nextVerified = new Set(verifiedIds)
      nextVerified.add(currentId)

      let upcomingId: string | null = null
      for (let i = currentIndex + 1; i < employees.length; i++) {
        if (!nextVerified.has(employees[i].employee_id)) {
          upcomingId = employees[i].employee_id
          break
        }
      }

      setVerifiedIds(nextVerified)
      setSelectedEmployeeId(upcomingId)
      onInfo(`${selectedEmployee.employee_name} verified`)
    } finally {
      setSavingEntryId(null)
      setVerifying(false)
    }
  }

  const handleGenerate = async () => {
    if (!allVerified || !preview) {
      onError('Verify hours for every employee before generating')
      return
    }
    // Capture overrides synchronously before any awaits (avoid stale React state)
    const overrides = syncOverridesFromDrafts(hoursDraft, preview.employees)
    try {
      for (const emp of preview.employees) {
        await saveEmployeeHours(emp, hoursDraft)
      }
      await onGenerate({
        payroll_type: payrollType,
        start_date: startDate,
        include_inactive: includeInactive,
        entry_hour_overrides: overrides,
      })
    } catch (error: any) {
      logger.error('Failed during payroll generate from review', error as Error)
      onError(
        error?.response?.data?.detail ||
          error?.message ||
          'Failed to save hours before generate'
      )
    } finally {
      setSavingEntryId(null)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-800/10 bg-slate-900 px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                {step === 'setup' ? 'New payroll run' : 'Review hours'}
              </p>
              <h3 className="mt-1 text-xl font-semibold tracking-tight">Generate payroll</h3>
              {preview && (
                <p className="mt-1 text-sm text-slate-300">
                  {formatPeriodLabel(preview.period_start, preview.period_end)} · {verifiedCount}/
                  {preview.employee_count} verified
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {step === 'setup' ? (
          <div className="space-y-4 overflow-y-auto p-5">
            {scheduleLocked && (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Period is locked from your pay schedule
                {nextPayDate ? ` (payday ${nextPayDate})` : ''}.
              </p>
            )}
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                Payroll type
              </label>
              <select
                value={payrollType}
                disabled={scheduleLocked}
                onChange={(e) => setPayrollType(e.target.value as 'WEEKLY' | 'BIWEEKLY')}
                className="block w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm shadow-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-50 disabled:text-slate-500"
              >
                <option value="WEEKLY">Weekly</option>
                <option value="BIWEEKLY">Biweekly</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                Period start
              </label>
              <input
                type="date"
                value={startDate}
                readOnly={scheduleLocked}
                onChange={(e) => setStartDate(e.target.value)}
                className="block w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm shadow-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 read-only:bg-slate-50 read-only:text-slate-500"
              />
            </div>
            {computedEnd && (
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Period end
                </label>
                <input
                  type="date"
                  value={computedEnd}
                  disabled
                  className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500"
                />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
              />
              Include inactive employees
            </label>
            <div className="flex gap-3 border-t border-slate-100 pt-5">
              <button
                type="button"
                disabled={loadingPreview || !startDate}
                onClick={loadPreview}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {loadingPreview ? (
                  <>
                    <ButtonSpinner />
                    Loading…
                  </>
                ) : (
                  'Review employees'
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <p className="mb-3 text-xs text-slate-500">
                Expand one employee at a time, edit hours if needed, then verify — changes save
                automatically. Generate stays locked until everyone is verified.
              </p>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                {preview?.employees.map((emp, index) => {
                  const verified = verifiedIds.has(emp.employee_id)
                  const expanded = emp.employee_id === selectedEmployeeId
                  return (
                    <div
                      key={emp.employee_id}
                      className={index > 0 ? 'border-t border-slate-200' : undefined}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedEmployeeId((current) =>
                            current === emp.employee_id ? null : emp.employee_id
                          )
                        }
                        className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition ${
                          expanded ? 'bg-slate-50' : 'bg-white hover:bg-slate-50/80'
                        }`}
                        aria-expanded={expanded}
                      >
                        <svg
                          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                            expanded ? 'rotate-90' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-slate-900">
                            {emp.employee_name}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {formatHours(employeeDisplayHours(emp, hoursDraft))}
                            {emp.entries.some(
                              (e) => e.is_open && !(hoursDraft[e.id] || '').trim()
                            )
                              ? ' · open punch'
                              : ''}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            verified
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {verified ? 'Verified' : 'Review'}
                        </span>
                      </button>

                      {expanded && (
                        <div className="space-y-3 border-t border-slate-100 bg-white px-4 py-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm text-slate-600">
                              {formatHours(employeeDisplayHours(emp, hoursDraft))} total
                            </p>
                            <button
                              type="button"
                              disabled={verifying || verified || savingEntryId !== null}
                              onClick={verifySelectedEmployee}
                              className="rounded-xl bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                            >
                              {verified
                                ? 'Verified'
                                : verifying || savingEntryId
                                  ? 'Saving…'
                                  : 'Verify hours'}
                            </button>
                          </div>

                          {emp.entries.length === 0 ? (
                            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                              No time entries in this period. Verify if zero hours is correct.
                            </p>
                          ) : (
                            <div className="overflow-x-auto rounded-xl border border-slate-200">
                              <table className="min-w-full text-sm">
                                <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                  <tr>
                                    <th className="px-3 py-2.5">Clock in</th>
                                    <th className="px-3 py-2.5">Clock out</th>
                                    <th className="px-3 py-2.5">Break</th>
                                    <th className="px-3 py-2.5">Hours</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {emp.entries.map((entry) => (
                                    <tr key={entry.id} className="bg-white">
                                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-700">
                                        {entry.clock_in_local || '—'}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-700">
                                        {entry.is_open ? (
                                          <span className="font-medium text-amber-700">Open</span>
                                        ) : (
                                          entry.clock_out_local || '—'
                                        )}
                                      </td>
                                      <td className="px-3 py-2.5 tabular-nums text-slate-600">
                                        {entry.break_minutes}m
                                      </td>
                                      <td className="px-3 py-2.5">
                                        <input
                                          type="number"
                                          min={0}
                                          max={24}
                                          step={0.25}
                                          value={hoursDraft[entry.id] ?? ''}
                                          onChange={(e) => {
                                            const value = e.target.value
                                            setHoursDraft((prev) => ({
                                              ...prev,
                                              [entry.id]: value,
                                            }))
                                            const parsed = parseFloat(value)
                                            if (Number.isFinite(parsed) && parsed >= 0) {
                                              hourOverridesRef.current[entry.id] = parsed
                                            }
                                            setVerifiedIds((prev) => {
                                              if (!prev.has(emp.employee_id)) return prev
                                              const next = new Set(prev)
                                              next.delete(emp.employee_id)
                                              return next
                                            })
                                          }}
                                          className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm tabular-nums focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                                        />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-4">
              <button
                type="button"
                onClick={() => setStep('setup')}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Back
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!allVerified || generating}
                  onClick={handleGenerate}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {generating ? (
                    <>
                      <ButtonSpinner />
                      Generating…
                    </>
                  ) : (
                    'Generate payroll'
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
