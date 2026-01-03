'use client'

import { useState, useEffect } from 'react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import logger from '@/lib/logger'

interface Employee {
  id: string
  name: string
  email: string
}

export default function AdminReportsPage() {
  const toast = useToast()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [formData, setFormData] = useState({
    range_type: 'none',
    start_date: '',
    end_date: '',
    format: 'pdf',
    employee_ids: [] as string[],
  })

  useEffect(() => {
    fetchEmployees()
  }, [])

  // Calculate end date based on range type and start date
  useEffect(() => {
    if (formData.range_type !== 'none' && formData.start_date) {
      const startDate = new Date(formData.start_date)
      let endDate = new Date(startDate)

      switch (formData.range_type) {
        case 'weekly':
          endDate.setDate(startDate.getDate() + 6) // 7 days including start date
          break
        case 'biweekly':
          endDate.setDate(startDate.getDate() + 13) // 14 days including start date
          break
        case 'monthly':
          endDate.setMonth(startDate.getMonth() + 1)
          endDate.setDate(0) // Last day of the month
          break
        default:
          return
      }

      // Format as YYYY-MM-DD
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
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    if (!formData.start_date || !formData.end_date) {
      toast.warning('Please select start and end dates')
      return
    }
    
    setExporting(true)

    try {
      const payload = {
        ...formData,
        employee_ids: formData.employee_ids.length > 0 ? formData.employee_ids : undefined,
      }
      const response = await api.post('/reports/export', payload, {
        responseType: 'blob',
      })

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute(
        'download',
        `report_${formData.start_date}_${formData.end_date}.${formData.format === 'pdf' ? 'pdf' : 'xlsx'}`
      )
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (error: any) {
      alert(error.response?.data?.detail || 'Failed to generate report')
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

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <h1 className="text-2xl font-bold mb-6">Export Reports</h1>
        <div className="bg-white shadow rounded-lg p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Range Type</label>
              <select
                value={formData.range_type}
                onChange={(e) => {
                  const newRangeType = e.target.value
                  setFormData({ ...formData, range_type: newRangeType })
                  // Clear end date when switching to 'none' to allow manual entry
                  if (newRangeType === 'none') {
                    setFormData((prev) => ({ ...prev, end_date: '' }))
                  }
                }}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
              >
                <option value="none">None (Custom Range)</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Start Date</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">End Date</label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  disabled={formData.range_type !== 'none'}
                  className={`mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm ${
                    formData.range_type !== 'none' ? 'bg-gray-100 cursor-not-allowed' : ''
                  }`}
                />
                {formData.range_type !== 'none' && (
                  <p className="mt-1 text-xs text-gray-500">Automatically calculated based on range type</p>
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Format</label>
              <select
                value={formData.format}
                onChange={(e) => setFormData({ ...formData, format: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
              >
                <option value="pdf">PDF</option>
                <option value="xlsx">Excel</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Employees (leave empty for all)
              </label>
              <div className="max-h-48 overflow-y-auto border border-gray-300 rounded-md p-2">
                {employees.map((employee) => (
                  <label key={employee.id} className="flex items-center space-x-2 py-1">
                    <input
                      type="checkbox"
                      checked={formData.employee_ids.includes(employee.id)}
                      onChange={() => toggleEmployee(employee.id)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700">{employee.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <button
              onClick={handleExport}
              className="w-full px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              Generate Report
            </button>
          </div>
        </div>
      </div>
    </Layout>
  )
}

