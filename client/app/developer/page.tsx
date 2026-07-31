'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import logger from '@/lib/logger'
import { DeveloperAuthLoading, useDeveloperAuth } from '@/components/developer/useDeveloperAuth'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'

interface SystemStats {
  total_users: number
  active_users: number
  total_companies: number
  active_sessions: number
  today_time_entries: number
  verified_users: number
}

type CompanyRow = {
  id: string
  name: string
  slug: string
  created_at: string | null
  user_count: number
}

function greetingForHour(hour: number) {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function DeveloperOverviewPage() {
  const { user, loading: authLoading } = useDeveloperAuth()
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [loadingData, setLoadingData] = useState(true)

  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false
    ;(async () => {
      setLoadingData(true)
      try {
        const [statsRes, companiesRes] = await Promise.all([
          api.get('/developer/stats').catch(() => null),
          api.get('/developer/companies').catch(() => null),
        ])
        if (cancelled) return
        if (statsRes?.data) setStats(statsRes.data)
        const allCompanies = Array.isArray(companiesRes?.data) ? companiesRes.data : []
        setCompanies(allCompanies.slice(0, 5))
      } catch (e) {
        logger.error('Failed to load developer overview', e as Error)
      } finally {
        if (!cancelled) setLoadingData(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authLoading, user])

  if (authLoading) return <DeveloperAuthLoading />

  const hour = new Date().getHours()
  const firstName = user?.name?.split(/\s+/)[0] ?? 'Developer'

  const kpis = stats
    ? [
        { label: 'Companies', value: stats.total_companies },
        { label: 'Total users', value: stats.total_users },
        { label: 'Active users', value: stats.active_users },
        { label: 'Active sessions', value: stats.active_sessions },
      ]
    : []

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {greetingForHour(hour)}, {firstName}
      </h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loadingData && !stats
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardBody>
                  <div className="h-4 w-24 rounded bg-border-subtle" />
                  <div className="mt-3 h-8 w-16 rounded bg-border-subtle" />
                </CardBody>
              </Card>
            ))
          : kpis.map((kpi) => (
              <Card key={kpi.label}>
                <CardBody>
                  <p className="text-sm font-medium text-foreground-muted">{kpi.label}</p>
                  <p className="mt-2 text-3xl font-bold text-foreground">{kpi.value}</p>
                </CardBody>
              </Card>
            ))}
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3">
          <h2 className="text-sm font-semibold text-foreground">Recent companies</h2>
          <Link
            href="/developer/companies"
            className="text-xs font-medium text-foreground-muted hover:text-foreground"
          >
            View all
          </Link>
        </div>
        <CardBody>
          {loadingData ? (
            <p className="text-sm text-foreground-muted">Loading…</p>
          ) : companies.length === 0 ? (
            <p className="text-sm text-foreground-muted">No companies yet.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {companies.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div>
                    <Link href={`/developer/companies/${c.id}`} className="font-medium text-accent hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-foreground-subtle">{c.slug}</p>
                  </div>
                  <Badge variant="neutral">{c.user_count} users</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
