'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser, User } from '@/lib/auth'
import { format } from 'date-fns'
import logger from '@/lib/logger'
import { TableSkeleton } from '@/components/LoadingSkeleton'
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

  // Debounce date inputs
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
        setError('Access denied. Admin privileges required.')
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
        if (user.role !== 'ADMIN') {
          router.push('/dashboard')
          return
        }
        fetchEntries()
      } catch (err) {
        router.push('/login')
      }
    }
    checkAdmin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  useEffect(() => {
    if (debouncedFromDate || debouncedToDate) {
      setCurrentPage(1) // Reset to first page when filters change
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

  // Parse user agent to extract browser and OS info
  const parseUserAgent = (ua: string | null | undefined): string => {
    if (!ua) return 'N/A'
    
    let browser = 'Unknown Browser'
    let os = 'Unknown OS'
    
    // Detect OS
    if (ua.includes('Windows NT 10')) os = 'Windows 10/11'
    else if (ua.includes('Windows NT 6.3')) os = 'Windows 8.1'
    else if (ua.includes('Windows NT 6.2')) os = 'Windows 8'
    else if (ua.includes('Windows NT 6.1')) os = 'Windows 7'
    else if (ua.includes('Mac OS X')) os = 'macOS'
    else if (ua.includes('Linux')) os = 'Linux'
    else if (ua.includes('Android')) os = 'Android'
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'
    
    // Detect Browser
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

  // Format location for display
  const formatLocation = (lat: string | null | undefined, lng: string | null | undefined): string | null => {
    if (!lat || !lng) return null
    return `${parseFloat(lat).toFixed(6)}, ${parseFloat(lng).toFixed(6)}`
  }

  // Get Google Maps link for coordinates
  const getMapLink = (lat: string | null | undefined, lng: string | null | undefined): string | null => {
    if (!lat || !lng) return null
    return `https://www.google.com/maps?q=${lat},${lng}`
  }

  const getStatusBadge = (status: string) => {
    const statusMap: { [key: string]: { color: string; bg: string } } = {
      'closed': { color: 'text-green-800', bg: 'bg-green-100' },
      'open': { color: 'text-yellow-800', bg: 'bg-yellow-100' },
      'approved': { color: 'text-blue-800', bg: 'bg-blue-100' },
      'edited': { color: 'text-purple-800', bg: 'bg-purple-100' },
    }
    const style = statusMap[status.toLowerCase()] || { color: 'text-gray-800', bg: 'bg-gray-100' }
    const capitalizedStatus = status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : status
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${style.bg} ${style.color}`}>
        {capitalizedStatus}
      </span>
    )
  }

  const totalPages = Math.ceil(total / pageSize)
  const startEntry = total === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const endEntry = Math.min(currentPage * pageSize, total)

  return (
    <Layout>
      <div className="px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900 mb-1">Time Entries</h1>
          <p className="text-sm text-gray-600">View and manage all employee time entries</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-6">
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Filters Card */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <h2 className="text-sm font-medium text-gray-900 mb-3">Filter by Date Range</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">From Date</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">To Date</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
          </div>
        </div>

        {/* Table Card */}
        {loading ? (
          <TableSkeleton rows={10} columns={6} />
        ) : (
          <>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-4">
              <div className="overflow-x-auto">
                <table className="w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Employee
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Clock In
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Clock Out
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Hours
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {entries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center">
                          <div className="flex flex-col items-center">
                            <p className="text-gray-500 text-lg font-medium">No entries found</p>
                            <p className="text-gray-400 text-sm mt-1">Try adjusting your date filters</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      entries.map((entry) => (
                        <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="flex-shrink-0 h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold">
                                {entry.employee_name.charAt(0).toUpperCase()}
                              </div>
                              <div className="ml-4">
                                <div className="text-sm font-medium text-gray-900">{entry.employee_name}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {entry.clock_in_at_local
                              ? entry.clock_in_at_local.split(' ')[0]
                              : format(new Date(entry.clock_in_at), 'MMM dd, yyyy')}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                            {entry.clock_in_at_local
                              ? entry.clock_in_at_local.split(' ')[1]?.substring(0, 5)
                              : format(new Date(entry.clock_in_at), 'HH:mm')}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                            {entry.clock_out_at_local ? (
                              entry.clock_out_at_local.split(' ')[1]?.substring(0, 5)
                            ) : entry.clock_out_at ? (
                              format(new Date(entry.clock_out_at), 'HH:mm')
                            ) : (
                              <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold">Open</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                            {calculateHours(entry)} hrs
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            {getStatusBadge(entry.status)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <button
                              onClick={() => {
                                setSelectedEntry(entry)
                                setShowInfoModal(true)
                              }}
                              className="inline-flex items-center px-2 py-1 text-sm font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors"
                              title="View details"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Info Modal */}
            {showInfoModal && selectedEntry && (
              <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
                <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl">
                  <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                    <h3 className="text-xl font-bold text-gray-900">Time Entry Details</h3>
                    <button
                      onClick={() => {
                        setShowInfoModal(false)
                        setSelectedEntry(null)
                      }}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-gray-500">Employee</label>
                        <p className="mt-1 text-sm text-gray-900">{selectedEntry.employee_name}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-500">Status</label>
                        <div className="mt-1">{getStatusBadge(selectedEntry.status)}</div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-500">Clock In</label>
                        <p className="mt-1 text-sm text-gray-900">
                          {selectedEntry.clock_in_at_local || format(new Date(selectedEntry.clock_in_at), 'MMM dd, yyyy HH:mm')}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-500">Clock Out</label>
                        <p className="mt-1 text-sm text-gray-900">
                          {selectedEntry.clock_out_at_local 
                            ? selectedEntry.clock_out_at_local
                            : selectedEntry.clock_out_at 
                            ? format(new Date(selectedEntry.clock_out_at), 'MMM dd, yyyy HH:mm')
                            : 'Open'}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-500">Total Hours</label>
                        <p className="mt-1 text-sm text-gray-900">{calculateHours(selectedEntry)} hrs</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-500">Break Minutes</label>
                        <p className="mt-1 text-sm text-gray-900">{selectedEntry.break_minutes} min</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-500">Source</label>
                        <p className="mt-1 text-sm text-gray-900 capitalize">{selectedEntry.source || 'N/A'}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-500">Clock In IP</label>
                        <p className="mt-1 text-sm text-gray-900 font-mono">{selectedEntry.ip_address || 'N/A'}</p>
                      </div>
                      {selectedEntry.clock_out_ip_address && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Clock Out IP</label>
                          <p className="mt-1 text-sm text-gray-900 font-mono">{selectedEntry.clock_out_ip_address}</p>
                        </div>
                      )}
                      {selectedEntry.user_agent && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Clock In Device</label>
                          <p className="mt-1 text-sm text-gray-900">{parseUserAgent(selectedEntry.user_agent)}</p>
                        </div>
                      )}
                      {selectedEntry.clock_out_user_agent && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Clock Out Device</label>
                          <p className="mt-1 text-sm text-gray-900">{parseUserAgent(selectedEntry.clock_out_user_agent)}</p>
                        </div>
                      )}
                      {formatLocation(selectedEntry.clock_in_latitude, selectedEntry.clock_in_longitude) && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Clock In Location</label>
                          <p className="mt-1 text-sm text-gray-900">
                            <a 
                              href={getMapLink(selectedEntry.clock_in_latitude, selectedEntry.clock_in_longitude) || '#'} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              {formatLocation(selectedEntry.clock_in_latitude, selectedEntry.clock_in_longitude)}
                              <svg className="w-3 h-3 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          </p>
                        </div>
                      )}
                      {formatLocation(selectedEntry.clock_out_latitude, selectedEntry.clock_out_longitude) && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Clock Out Location</label>
                          <p className="mt-1 text-sm text-gray-900">
                            <a 
                              href={getMapLink(selectedEntry.clock_out_latitude, selectedEntry.clock_out_longitude) || '#'} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              {formatLocation(selectedEntry.clock_out_latitude, selectedEntry.clock_out_longitude)}
                              <svg className="w-3 h-3 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          </p>
                        </div>
                      )}
                      {selectedEntry.note && (
                        <div className="col-span-2">
                          <label className="text-sm font-medium text-gray-500">Note</label>
                          <p className="mt-1 text-sm text-gray-900">{selectedEntry.note}</p>
                        </div>
                      )}
                      {selectedEntry.edited_by_name && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Edited By</label>
                          <p className="mt-1 text-sm text-gray-900">{selectedEntry.edited_by_name}</p>
                        </div>
                      )}
                      {selectedEntry.created_at && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Created At</label>
                          <p className="mt-1 text-sm text-gray-900">
                            {format(new Date(selectedEntry.created_at), 'MMM dd, yyyy HH:mm:ss')}
                          </p>
                        </div>
                      )}
                      {selectedEntry.updated_at && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Last Updated</label>
                          <p className="mt-1 text-sm text-gray-900">
                            {format(new Date(selectedEntry.updated_at), 'MMM dd, yyyy HH:mm:ss')}
                          </p>
                        </div>
                      )}
                      {selectedEntry.company_timezone && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Timezone</label>
                          <p className="mt-1 text-sm text-gray-900">{selectedEntry.company_timezone}</p>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
                    <button
                      onClick={() => {
                        setShowInfoModal(false)
                        setSelectedEntry(null)
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Pagination */}
            {total > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  {/* Page Info */}
                  <div className="text-sm text-gray-700">
                    Showing <span className="font-medium">{startEntry}</span> to <span className="font-medium">{endEntry}</span> of{' '}
                    <span className="font-medium">{total}</span> entries
                  </div>

                  {/* Page Size Selector */}
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-700">Show:</label>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value))
                        setCurrentPage(1)
                      }}
                      className="px-3 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    >
                      <option value="10">10</option>
                      <option value="20">20</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                    </select>
                  </div>

                  {/* Pagination Controls */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                      className="px-3 py-1 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      First
                    </button>
                    <button
                      onClick={() => setCurrentPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="px-3 py-1 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="px-3 py-1 text-sm text-gray-700">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                    <button
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Last
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  )
}
