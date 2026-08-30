'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import PageAtmosphere from '@/components/PageAtmosphere'
import api from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import { format } from 'date-fns'
import logger from '@/lib/logger'
import { useDebounce } from '@/hooks/useDebounce'

interface TimeEntry {
  id: string
  employee_name: string
  clock_in_at: string
  clock_out_at: string | null
  break_minutes: number
  status: string
  rounded_hours?: number | null
  rounded_minutes?: number | null
  clock_in_at_local?: string | null
  clock_out_at_local?: string | null
  company_timezone?: string | null
  ip_address?: string | null
  user_agent?: string | null
  clock_out_ip_address?: string | null
  clock_out_user_agent?: string | null
  clock_in_latitude?: string | null
  clock_in_longitude?: string | null
  clock_out_latitude?: string | null
  clock_out_longitude?: string | null
  edited_by_name?: string | null
  source?: string
  note?: string | null
  created_at?: string
  updated_at?: string
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'warning' | 'success'
}) {
  const valueClass =
    tone === 'warning'
      ? 'text-amber-600'
      : tone === 'success'
        ? 'text-emerald-600'
        : 'text-slate-900'

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${valueClass}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function statusStyles(status: string) {
  switch (status.toLowerCase()) {
    case 'closed':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200/80'
    case 'open':
      return 'bg-amber-50 text-amber-800 ring-amber-200/80'
    case 'approved':
      return 'bg-sky-50 text-sky-800 ring-sky-200/80'
    case 'edited':
      return 'bg-violet-50 text-violet-800 ring-violet-200/80'
    default:
      return 'bg-slate-50 text-slate-600 ring-slate-200'
  }
}

export default function AdminTimePage() {
  const router = useRouter()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [selectedEntry, setSelectedEntry] = useState<TimeEntry | null>(null)
  const [showInfoModal, setShowInfoModal] = useState(false)

  const debouncedFromDate = useDebounce(fromDate, 500)
  const debouncedToDate = useDebounce(toDate, 500)

  const fetchEntries = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (debouncedFromDate) params.append('from_date', debouncedFromDate)
      if (debouncedToDate) params.append('to_date', debouncedToDate)
      params.append('skip', ((currentPage - 1) * pageSize).toString())
      params.append('limit', pageSize.toString())

      const response = await api.get(`/time/admin/time?${params.toString()}`)
      setEntries(response.data.entries || [])
      setTotal(response.data.total || 0)
    } catch (error: any) {
      logger.error('Failed to fetch time entries', error as Error, { endpoint: '/time/admin/time' })
      if (error.response?.status === 403) {
        setError('Access denied. Admin or manager privileges required.')
        router.push('/dashboard')
      } else {
        setError('Failed to load time entries. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const user = await getCurrentUser()
        if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
          router.push('/dashboard')
          return
        }
        fetchEntries()
      } catch {
        router.push('/login')
      }
    }
    checkAdmin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  useEffect(() => {
    if (debouncedFromDate || debouncedToDate) {
      setCurrentPage(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedFromDate, debouncedToDate])

  useEffect(() => {
    fetchEntries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedFromDate, debouncedToDate, currentPage, pageSize])

  const calculateHours = (entry: TimeEntry) => {
    if (entry.rounded_hours !== null && entry.rounded_hours !== undefined) {
      return entry.rounded_hours.toFixed(2)
    }
    if (!entry.clock_out_at) return '0.00'
    const inTime = new Date(entry.clock_in_at)
    const outTime = new Date(entry.clock_out_at)
    const diffMs = outTime.getTime() - inTime.getTime()
    const diffHours = (diffMs - entry.break_minutes * 60 * 1000) / (1000 * 60 * 60)
    return diffHours.toFixed(2)
  }

  const parseUserAgent = (ua: string | null | undefined): string => {
    if (!ua) return 'N/A'

    let browser = 'Unknown Browser'
    let os = 'Unknown OS'

    if (ua.includes('Windows NT 10')) os = 'Windows 10/11'
    else if (ua.includes('Windows NT 6.3')) os = 'Windows 8.1'
    else if (ua.includes('Windows NT 6.2')) os = 'Windows 8'
    else if (ua.includes('Windows NT 6.1')) os = 'Windows 7'
    else if (ua.includes('Mac OS X')) os = 'macOS'
    else if (ua.includes('Linux')) os = 'Linux'
    else if (ua.includes('Android')) os = 'Android'
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'

    if (ua.includes('Edg/')) {
      const match = ua.match(/Edg\/(\d+)/)
      browser = `Edge ${match ? match[1] : ''}`
    } else if (ua.includes('Chrome/')) {
      const match = ua.match(/Chrome\/(\d+)/)
      browser = `Chrome ${match ? match[1] : ''}`
    } else if (ua.includes('Firefox/')) {
      const match = ua.match(/Firefox\/(\d+)/)
      browser = `Firefox ${match ? match[1] : ''}`
    } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
      const match = ua.match(/Version\/(\d+)/)
      browser = `Safari ${match ? match[1] : ''}`
    }

    return `${browser} on ${os}`
  }

  const formatLocation = (
    lat: string | null | undefined,
    lng: string | null | undefined
  ): string | null => {
    if (!lat || !lng) return null
    return `${parseFloat(lat).toFixed(6)}, ${parseFloat(lng).toFixed(6)}`
  }

  const getMapLink = (
    lat: string | null | undefined,
    lng: string | null | undefined
  ): string | null => {
    if (!lat || !lng) return null
    return `https://www.google.com/maps?q=${lat},${lng}`
  }

  const pageStats = useMemo(() => {
    const open = entries.filter((e) => e.status?.toLowerCase() === 'open' || !e.clock_out_at).length
    const closed = entries.filter((e) => e.clock_out_at).length
    const hours = entries.reduce((sum, e) => {
      let h = 0
      if (e.rounded_hours !== null && e.rounded_hours !== undefined) {
        h = e.rounded_hours
      } else if (e.clock_out_at) {
        const diffMs = new Date(e.clock_out_at).getTime() - new Date(e.clock_in_at).getTime()
        h = (diffMs - e.break_minutes * 60 * 1000) / (1000 * 60 * 60)
      }
      return sum + h
    }, 0)
    return {
      open,
      closed,
      hoursLabel: hours.toFixed(1),
    }
  }, [entries])

  const totalPages = Math.ceil(total / pageSize)
  const startEntry = total === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const endEntry = Math.min(currentPage * pageSize, total)
  const hasFilters = Boolean(fromDate || toDate)

  const clearFilters = () => {
    setFromDate('')
    setToDate('')
    setCurrentPage(1)
  }

  return (
    <Layout>
      <div className="relative mx-auto max-w-6xl">
        <PageAtmosphere />

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
              <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Logs · Attendance
                  </p>
                  <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight">
                    Punch Log
                  </h1>
                  <p className="mt-2 max-w-lg text-sm text-slate-300 leading-relaxed">
                    Review clock-in and clock-out records, open punches, and entry details.
                  </p>
                </div>
                {pageStats.open > 0 && (
                  <div className="shrink-0 sm:text-right">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      Open on page
                    </p>
                    <p className="mt-2 text-3xl sm:text-4xl font-semibold tabular-nums tracking-tight leading-none text-amber-200">
                      {pageStats.open}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Total" value={total} hint="Matching filters" />
            <StatCard
              label="Open"
              value={pageStats.open}
              hint="Still clocked in"
              tone="warning"
            />
            <StatCard
              label="Closed"
              value={pageStats.closed}
              hint="On this page"
              tone="success"
            />
            <StatCard label="Hours" value={pageStats.hoursLabel} hint="Sum on this page" />
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-end gap-3">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 mb-1.5">
                    From
                  </label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 mb-1.5">
                    To
                  </label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
                  />
                </div>
              </div>
              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Clear dates
                </button>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Entries</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {total === 0
                    ? 'No punches in this range'
                    : `Showing ${startEntry}–${endEntry} of ${total}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-500">Rows</label>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setCurrentPage(1)
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                >
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </div>
            </div>

            {loading ? (
              <div className="p-4 space-y-2" role="status" aria-label="Loading">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <p className="text-sm font-semibold text-slate-800">No entries found</p>
                <p className="mt-1 text-sm text-slate-500">Try adjusting your date filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr className="border-b border-slate-100 text-left">
                      <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Employee
                      </th>
                      <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Date
                      </th>
                      <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        In
                      </th>
                      <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Out
                      </th>
                      <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Hours
                      </th>
                      <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Status
                      </th>
                      <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 text-right">
                        Details
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {entries.map((entry) => {
                      const isOpen = !entry.clock_out_at
                      return (
                        <tr
                          key={entry.id}
                          className="hover:bg-slate-50/80 transition-colors"
                        >
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                                {initials(entry.employee_name)}
                              </div>
                              <span className="truncate text-sm font-medium text-slate-900">
                                {entry.employee_name}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-sm text-slate-700 tabular-nums whitespace-nowrap">
                            {entry.clock_in_at_local
                              ? entry.clock_in_at_local.split(' ')[0]
                              : format(new Date(entry.clock_in_at), 'MMM d, yyyy')}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-slate-700 tabular-nums whitespace-nowrap">
                            {entry.clock_in_at_local
                              ? entry.clock_in_at_local.split(' ')[1]?.substring(0, 5)
                              : format(new Date(entry.clock_in_at), 'HH:mm')}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-slate-700 tabular-nums whitespace-nowrap">
                            {entry.clock_out_at_local ? (
                              entry.clock_out_at_local.split(' ')[1]?.substring(0, 5)
                            ) : entry.clock_out_at ? (
                              format(new Date(entry.clock_out_at), 'HH:mm')
                            ) : (
                              <span className="inline-flex rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200/80">
                                Open
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-sm font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                            {calculateHours(entry)}
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <span
                              className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset capitalize ${statusStyles(
                                isOpen ? 'open' : entry.status
                              )}`}
                            >
                              {isOpen
                                ? 'Open'
                                : entry.status
                                  ? entry.status.charAt(0).toUpperCase() +
                                    entry.status.slice(1).toLowerCase()
                                  : '—'}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedEntry(entry)
                                setShowInfoModal(true)
                              }}
                              className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {total > 0 && !loading && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-100 px-5 py-3.5">
                <p className="text-xs text-slate-500 tabular-nums">
                  Page {currentPage} of {Math.max(totalPages, 1)}
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    First
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage >= totalPages}
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Last
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {showInfoModal && selectedEntry && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
            onClick={() => {
              setShowInfoModal(false)
              setSelectedEntry(null)
            }}
          >
            <div
              className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-slate-100 bg-slate-900 px-5 py-4 text-white shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      Punch detail
                    </p>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight">
                      {selectedEntry.employee_name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-300">
                      {selectedEntry.clock_in_at_local ||
                        format(new Date(selectedEntry.clock_in_at), 'MMM d, yyyy · HH:mm')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowInfoModal(false)
                      setSelectedEntry(null)
                    }}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
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

              <div className="p-5 overflow-y-auto space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Status
                    </p>
                    <span
                      className={`mt-1.5 inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset capitalize ${statusStyles(
                        selectedEntry.status
                      )}`}
                    >
                      {selectedEntry.status
                        ? selectedEntry.status.charAt(0).toUpperCase() +
                          selectedEntry.status.slice(1).toLowerCase()
                        : '—'}
                    </span>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Hours
                    </p>
                    <p className="mt-1.5 text-sm font-semibold text-slate-900 tabular-nums">
                      {calculateHours(selectedEntry)} hrs
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Clock in
                    </p>
                    <p className="mt-1.5 text-sm text-slate-900">
                      {selectedEntry.clock_in_at_local ||
                        format(new Date(selectedEntry.clock_in_at), 'MMM d, yyyy HH:mm')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Clock out
                    </p>
                    <p className="mt-1.5 text-sm text-slate-900">
                      {selectedEntry.clock_out_at_local
                        ? selectedEntry.clock_out_at_local
                        : selectedEntry.clock_out_at
                          ? format(new Date(selectedEntry.clock_out_at), 'MMM d, yyyy HH:mm')
                          : 'Open'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Break
                    </p>
                    <p className="mt-1.5 text-sm text-slate-900">
                      {selectedEntry.break_minutes} min
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Source
                    </p>
                    <p className="mt-1.5 text-sm text-slate-900 capitalize">
                      {selectedEntry.source || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Clock in IP
                    </p>
                    <p className="mt-1.5 text-sm font-mono text-slate-900">
                      {selectedEntry.ip_address || 'N/A'}
                    </p>
                  </div>
                  {selectedEntry.clock_out_ip_address && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Clock out IP
                      </p>
                      <p className="mt-1.5 text-sm font-mono text-slate-900">
                        {selectedEntry.clock_out_ip_address}
                      </p>
                    </div>
                  )}
                  {selectedEntry.user_agent && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Clock in device
                      </p>
                      <p className="mt-1.5 text-sm text-slate-900">
                        {parseUserAgent(selectedEntry.user_agent)}
                      </p>
                    </div>
                  )}
                  {selectedEntry.clock_out_user_agent && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Clock out device
                      </p>
                      <p className="mt-1.5 text-sm text-slate-900">
                        {parseUserAgent(selectedEntry.clock_out_user_agent)}
                      </p>
                    </div>
                  )}
                  {formatLocation(
                    selectedEntry.clock_in_latitude,
                    selectedEntry.clock_in_longitude
                  ) && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Clock in location
                      </p>
                      <a
                        href={
                          getMapLink(
                            selectedEntry.clock_in_latitude,
                            selectedEntry.clock_in_longitude
                          ) || '#'
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-block text-sm font-medium text-slate-900 hover:underline"
                      >
                        {formatLocation(
                          selectedEntry.clock_in_latitude,
                          selectedEntry.clock_in_longitude
                        )}
                      </a>
                    </div>
                  )}
                  {formatLocation(
                    selectedEntry.clock_out_latitude,
                    selectedEntry.clock_out_longitude
                  ) && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Clock out location
                      </p>
                      <a
                        href={
                          getMapLink(
                            selectedEntry.clock_out_latitude,
                            selectedEntry.clock_out_longitude
                          ) || '#'
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-block text-sm font-medium text-slate-900 hover:underline"
                      >
                        {formatLocation(
                          selectedEntry.clock_out_latitude,
                          selectedEntry.clock_out_longitude
                        )}
                      </a>
                    </div>
                  )}
                  {selectedEntry.note && (
                    <div className="col-span-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Note
                      </p>
                      <p className="mt-1.5 text-sm text-slate-900">{selectedEntry.note}</p>
                    </div>
                  )}
                  {selectedEntry.edited_by_name && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Edited by
                      </p>
                      <p className="mt-1.5 text-sm text-slate-900">{selectedEntry.edited_by_name}</p>
                    </div>
                  )}
                  {selectedEntry.company_timezone && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Timezone
                      </p>
                      <p className="mt-1.5 text-sm text-slate-900">
                        {selectedEntry.company_timezone}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end border-t border-slate-100 px-5 py-4 bg-slate-50/80 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowInfoModal(false)
                    setSelectedEntry(null)
                  }}
                  className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
