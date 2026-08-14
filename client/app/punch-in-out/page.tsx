'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'

/** Punch in/out moved to the dashboard — keep this route as a redirect. */
export default function PunchInOutPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/dashboard')
  }, [router])

  return (
    <Layout>
      <div className="min-h-[40vh] flex items-center justify-center px-4">
        <p className="text-sm text-slate-500">Redirecting to dashboard…</p>
      </div>
    </Layout>
  )
}
