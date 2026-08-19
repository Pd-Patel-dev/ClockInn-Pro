'use client'

import { useEffect, useMemo, useState } from 'react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import logger from '@/lib/logger'
import ConfirmationDialog from '@/components/ConfirmationDialog'
import { ButtonSpinner } from '@/components/LoadingSpinner'
import { format, parseISO, differenceInCalendarDays } from 'date-fns'
import { deliverExportBlob, openPreviewTab } from '@/lib/deliverExportBlob'

interface Employee {
  id: string
  name: string
  email: string
}

type RangeType = 'none' | 'weekly' | 'biweekly' | 'monthly'
type ExportFormat = 'pdf' | 'xlsx'

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
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function formatPeriodLabel(start: string, end: string) {
  if (!start || !end) return 'Select a date range'
  try {
    return `${format(parseISO(start), 'MMM d')} – ${format(parseISO(end), 'MMM d, yyyy')}`
  } catch {
    return `${start} – ${end}`
  }
}

export default function AdminReportsPage() {
  const toast = useToast()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [showErrorDialog, setShowErrorDialog] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [formData, setFormData] = useState({
    range_type: 'none' as RangeType,
    start_date: '',
    end_date: '',
    format: 'pdf' as ExportFormat,
    employee_ids: [] as string[],
  })

  useEffect(() => {
    fetchEmployees()
  }, [])

  useEffect(() => {
    if (formData.range_type !== 'none' && formData.start_date) {
      const startDate = new Date(formData.start_date)
      const endDate = new Date(startDate)

      switch (formData.range_type) {
        case 'weekly':
          endDate.setDate(startDate.getDate() + 6)
          break
        case 'biweekly':
          endDate.setDate(startDate.getDate() + 13)
          break
        case 'monthly':
          endDate.setMonth(startDate.getMonth() + 1)
          endDate.setDate(0)
          break
        default:
          return
      }

      const formattedEndDate = endDate.toISOString().split('T')[0]
      setFormData((prev) => ({ ...prev, end_date: formattedEndDate }))
    }
  }, [formData.range_type, formData.start_date])

  const fetchEmployees = async () => {
    setLoading(true)
    try {
      const response = await api.get('/users/admin/employees')
      setEmployees(response.data || [])
    } catch (error) {
      logger.error('Failed to fetch employees', error as Error, { endpoint: '/users/admin/employees' })
      toast.error('Failed to load employees')
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    if (!formData.start_date || !formData.end_date) {
      toast.warning('Please select start and end dates')
      return
    }

    const previewWindow = formData.format === 'pdf' ? openPreviewTab() : null
    setExporting(true)
    try {
      const payload = {
        ...formData,
        employee_ids: formData.employee_ids.length > 0 ? formData.employee_ids : undefined,
      }
      const response = await api.post('/reports/export', payload, {
        responseType: 'blob',
      })

      const filename = `report_${formData.start_date}_${formData.end_date}.${
        formData.format === 'pdf' ? 'pdf' : 'xlsx'
      }`
      const result = deliverExportBlob(response.data, filename, {
        previewInBrowser: formData.format === 'pdf',
        previewWindow,
        mimeType:
          formData.format === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      toast.success(
        formData.format === 'pdf' && result.mode === 'preview'
          ? 'PDF opened in a new tab — use the browser to save or print'
          : `Report exported as ${formData.format.toUpperCase()}`
      )
    } catch (error: any) {
      if (previewWindow && !previewWindow.closed) {
        previewWindow.close()
      }
      const errorMsg = error.response?.data?.detail || 'Failed to generate report'
      setErrorMessage(typeof errorMsg === 'string' ? errorMsg : 'Failed to generate report')
      setShowErrorDialog(true)
    } finally {
      setExporting(false)
    }
  }

  const toggleEmployee = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      employee_ids: prev.employee_ids.includes(id)
        ? prev.employee_ids.filter((eid) => eid !== id)
        : [...prev.employee_ids, id],
    }))
  }

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase()
    if (!q) return employees
    return employees.filter(
      (e) => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q)
    )
  }, [employees, employeeSearch])

  const selectedCount = formData.employee_ids.length
  const allSelected = employees.length > 0 && selectedCount === employees.length
  const periodDays =
    formData.start_date && formData.end_date
      ? differenceInCalendarDays(parseISO(formData.end_date), parseISO(formData.start_date)) + 1
      : 0

  const selectAllVisible = () => {
    const ids = new Set(formData.employee_ids)
    filteredEmployees.forEach((e) => ids.add(e.id))
    setFormData((prev) => ({ ...prev, employee_ids: Array.from(ids) }))
  }

  const clearSelection = () => {
    setFormData((prev) => ({ ...prev, employee_ids: [] }))
  }

  const rangeOptions: { value: RangeType; label: string; hint: string }[] = [
    { value: 'none', label: 'Custom', hint: 'Pick any dates' },
    { value: 'weekly', label: 'Weekly', hint: '7 days' },
    { value: 'biweekly', label: 'Biweekly', hint: '14 days' },
    { value: 'monthly', label: 'Monthly', hint: 'Calendar month' },
  ]

  if (loading && employees.length === 0) {
    return (
      <Layout>
        <div className="relative mx-auto max-w-6xl py-16">
          <div className="space-y-3">
            <div className="h-40 animate-pulse rounded-2xl bg-slate-200/80" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
            <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="relative mx-auto max-w-6xl">
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
                className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
              />
              <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Time & attendance
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Reports</h1>
                  <p className="mt-2 max-w-xl text-sm text-slate-300">
                    Export punch history by date range for one employee or your whole team — PDF or
                    Excel.
                  </p>
                  <p className="mt-3 text-sm text-slate-400">
                    {formatPeriodLabel(formData.start_date, formData.end_date)}
                    {periodDays > 0 ? ` · ${periodDays} day${periodDays === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExport}
                    disabled={exporting || !formData.start_date || !formData.end_date}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {exporting && <ButtonSpinner />}
                    {exporting ? 'Generating…' : formData.format === 'pdf' ? 'View PDF report' : `Export ${formData.format.toUpperCase()}`}
                  </button>
                </div>
              </div>
            </div>
          </header>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Employees" value={employees.length} hint="Available to include" />
            <StatCard
              label="Selected"
              value={selectedCount === 0 ? 'All' : selectedCount}
              hint={selectedCount === 0 ? 'Entire roster' : allSelected ? 'Everyone selected' : 'Filtered roster'}
            />
            <StatCard
              label="Period"
              value={periodDays > 0 ? `${periodDays}d` : '—'}
              hint={formData.range_type === 'none' ? 'Custom range' : formData.range_type}
            />
            <StatCard
              label="Format"
              value={formData.format.toUpperCase()}
              hint={formData.format === 'pdf' ? 'Print-ready pages' : 'Spreadsheet workbook'}
            />
          </div>

          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <h2 className="text-sm font-semibold text-slate-900">Report options</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Choose the period, format, and who to include before exporting.
              </p>
            </div>

            <div className="space-y-6 px-5 py-5 sm:px-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Date range
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {rangeOptions.map((opt) => {
                    const active = formData.range_type === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          setFormData((prev) => ({
                            ...prev,
                            range_type: opt.value,
                          }))
                        }
                        className={`rounded-xl border px-3 py-3 text-left transition ${
                          active
                            ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                            : 'border-slate-200 bg-slate-50/80 text-slate-700 hover:border-slate-300 hover:bg-white'
                        }`}
                      >
                        <span className="block text-sm font-semibold">{opt.label}</span>
                        <span
                          className={`mt-0.5 block text-xs ${active ? 'text-slate-300' : 'text-slate-500'}`}
                        >
                          {opt.hint}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                    Start date
                  </label>
                  <input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                    End date
                  </label>
                  <input
                    type="date"
                    value={formData.end_date}
                    onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    disabled={formData.range_type !== 'none'}
                    className={`mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 ${
                      formData.range_type !== 'none'
                        ? 'cursor-not-allowed bg-slate-100 text-slate-500'
                        : 'bg-white'
                    }`}
                  />
                  {formData.range_type !== 'none' && (
                    <p className="mt-1.5 text-xs text-slate-500">
                      Calculated from start date for {formData.range_type} range
                    </p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Export format
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 max-w-md">
                  {(
                    [
                      { value: 'pdf' as const, label: 'PDF', hint: 'One page per employee' },
                      { value: 'xlsx' as const, label: 'Excel', hint: 'Summary + detail sheets' },
                    ] as const
                  ).map((opt) => {
                    const active = formData.format === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setFormData((prev) => ({ ...prev, format: opt.value }))}
                        className={`rounded-xl border px-3 py-3 text-left transition ${
                          active
                            ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                            : 'border-slate-200 bg-slate-50/80 text-slate-700 hover:border-slate-300 hover:bg-white'
                        }`}
                      >
                        <span className="block text-sm font-semibold">{opt.label}</span>
                        <span
                          className={`mt-0.5 block text-xs ${active ? 'text-slate-300' : 'text-slate-500'}`}
                        >
                          {opt.hint}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Employees</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Leave empty to include everyone. {selectedCount > 0 ? `${selectedCount} selected.` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  placeholder="Search name or email…"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-900/10 sm:w-56"
                />
                <button
                  type="button"
                  onClick={selectAllVisible}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Select visible
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={selectedCount === 0}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {filteredEmployees.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-slate-500 sm:px-6">
                  {employees.length === 0 ? 'No employees found.' : 'No matches for your search.'}
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {filteredEmployees.map((employee) => {
                    const checked = formData.employee_ids.includes(employee.id)
                    return (
                      <li key={employee.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-5 py-3 transition hover:bg-slate-50/80 sm:px-6">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEmployee(employee.id)}
                            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                          />
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                            {employee.name
                              .split(/\s+/)
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((p) => p[0]?.toUpperCase() || '')
                              .join('') || '?'}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-900">
                              {employee.name}
                            </span>
                            <span className="block truncate text-xs text-slate-500">{employee.email}</span>
                          </span>
                          {checked && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200/80">
                              Included
                            </span>
                          )}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-xs text-slate-500">
                {selectedCount === 0
                  ? `Export will include all ${employees.length} employees.`
                  : `Export will include ${selectedCount} of ${employees.length} employees.`}
              </p>
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting || !formData.start_date || !formData.end_date}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exporting && <ButtonSpinner />}
                {exporting
                  ? 'Generating…'
                  : formData.format === 'pdf'
                    ? 'View PDF report'
                    : `Generate ${formData.format.toUpperCase()} report`}
              </button>
            </div>
          </section>
        </div>
      </div>

      <ConfirmationDialog
        isOpen={showErrorDialog}
        title="Export failed"
        message={errorMessage}
        confirmText="OK"
        type="error"
        showCancel={false}
        onConfirm={() => setShowErrorDialog(false)}
      />
    </Layout>
  )
}
