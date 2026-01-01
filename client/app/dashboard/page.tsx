'use client'

import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import { getCurrentUser, User } from '@/lib/auth'
import { useRouter } from 'next/navigation'

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const currentUser = await getCurrentUser()
        setUser(currentUser)
      } catch (error) {
        router.push('/login')
      } finally {
        setLoading(false)
      }
    }
    fetchUser()
  }, [router])

  if (loading) {
    return (
      <Layout>
        <div className="text-center">Loading...</div>
      </Layout>
    )
  }

  if (!user) {
    return null
  }

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <div className="border-4 border-dashed border-gray-200 rounded-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Welcome, {user.name}!
          </h1>
          <p className="text-lg text-gray-600 mb-6">
            You are logged in as <span className="font-semibold">{user.role}</span> at{' '}
            <span className="font-semibold">{user.company_name}</span>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
            {user.role === 'EMPLOYEE' && (
              <>
                <div className="bg-white p-6 rounded-lg shadow">
                  <h2 className="text-xl font-semibold mb-2">Quick Actions</h2>
                  <ul className="space-y-2">
                    <li>
                      <a
                        href="/punch"
                        className="text-primary-600 hover:text-primary-700"
                      >
                        Clock In/Out
                      </a>
                    </li>
                    <li>
                      <a
                        href="/my/logs"
                        className="text-primary-600 hover:text-primary-700"
                      >
                        View Time Logs
                      </a>
                    </li>
                    <li>
                      <a
                        href="/my/leave"
                        className="text-primary-600 hover:text-primary-700"
                      >
                        Request Leave
                      </a>
                    </li>
                  </ul>
                </div>
              </>
            )}
            {user.role === 'ADMIN' && (
              <>
                <div className="bg-white p-6 rounded-lg shadow">
                  <h2 className="text-xl font-semibold mb-2">Quick Actions</h2>
                  <ul className="space-y-2">
                    <li>
                      <a
                        href="/admin/employees"
                        className="text-primary-600 hover:text-primary-700"
                      >
                        Manage Employees
                      </a>
                    </li>
                    <li>
                      <a
                        href="/admin/time"
                        className="text-primary-600 hover:text-primary-700"
                      >
                        View Time Entries
                      </a>
                    </li>
                    <li>
                      <a
                        href="/admin/leave"
                        className="text-primary-600 hover:text-primary-700"
                      >
                        Review Leave Requests
                      </a>
                    </li>
                    <li>
                      <a
                        href="/admin/reports"
                        className="text-primary-600 hover:text-primary-700"
                      >
                        Generate Reports
                      </a>
                    </li>
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}

