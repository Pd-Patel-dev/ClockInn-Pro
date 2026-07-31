'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import logger from '@/lib/logger'
import { useToast } from '@/components/Toast'
import { DeveloperAuthLoading, useDeveloperAuth } from '@/components/developer/useDeveloperAuth'
import { CreateCompanyDialog } from '@/components/developer/CreateCompanyDialog'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'

const systemDefaultCompanyId = '00000000-0000-0000-0000-000000000000'

type CompanyRow = {
  id: string
  name: string
  slug: string
  created_at: string | null
  user_count: number
}

export default function DeveloperCompaniesPageWrapper() {
  return (
    <Suspense fallback={<DeveloperAuthLoading />}>
      <DeveloperCompaniesPage />
    </Suspense>
  )
}

function DeveloperCompaniesPage() {
  const { user, loading: authLoading } = useDeveloperAuth()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deletingCompanyId, setDeletingCompanyId] = useState<string | null>(null)

  useEffect(() => {
    if (searchParams.get('create') === '1') setDialogOpen(true)
  }, [searchParams])

  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const params: Record<string, string> = {}
        if (search.trim()) params.q = search.trim()
        const res = await api.get('/developer/companies', { params })
        if (!cancelled) setCompanies(Array.isArray(res.data) ? res.data : [])
      } catch (e) {
        if (!cancelled) {
          setCompanies([])
          logger.error('Failed to load companies', e as Error)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    const t = setTimeout(load, search ? 250 : 0)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [authLoading, user, search, refreshKey])

  const handleDeleteCompany = async (c: CompanyRow) => {
    if (!user) return
    if (c.id === systemDefaultCompanyId) {
      toast.error('The system default company cannot be deleted.')
      return
    }
    if (
      !window.confirm(
        `Permanently delete “${c.name}” and all of its users, time entries, payroll, and other data? This cannot be undone.`,
      )
    ) {
      return
    }
    setDeletingCompanyId(c.id)
    try {
      await api.delete(`/developer/companies/${c.id}`)
      setCompanies((prev) => prev.filter((x) => x.id !== c.id))
      toast.success('Company deleted.')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      const msg = err.response?.data?.detail
      toast.error(typeof msg === 'string' ? msg : 'Failed to delete company')
      logger.error('Developer delete company failed', e as Error, { companyId: c.id })
    } finally {
      setDeletingCompanyId(null)
    }
  }

  if (authLoading) return <DeveloperAuthLoading />

  return (
    <div className="mx-auto max-w-6xl">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>All Companies</CardTitle>
            <CardDescription>
              Click a company name to view full info and manage users. Deletion is permanent.
            </CardDescription>
          </div>
          <Button
            className="shrink-0"
            onClick={() => setDialogOpen(true)}
          >
            Create company
          </Button>
        </CardHeader>
        <CardBody>
          <div className="mb-4">
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or slug…"
              className="max-w-md"
            />
          </div>
          {loading ? (
            <p className="text-sm text-foreground-muted">Loading companies…</p>
          ) : companies.length === 0 ? (
            <p className="text-sm text-foreground-muted">No companies found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-border-subtle/50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-foreground-muted">Name</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-foreground-muted">Slug</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-foreground-muted">Users</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-foreground-muted">Created</th>
                    <th className="px-4 py-2 text-right text-xs font-medium uppercase text-foreground-muted">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {companies.map((c) => (
                    <tr key={c.id} className="hover:bg-border-subtle/40">
                      <td className="px-4 py-3">
                        <Link href={`/developer/companies/${c.id}`} className="font-medium text-accent hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground-muted">{c.slug}</td>
                      <td className="px-4 py-3 text-sm text-foreground-muted">{c.user_count}</td>
                      <td className="px-4 py-3 text-sm text-foreground-subtle">
                        {c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={deletingCompanyId === c.id || c.id === systemDefaultCompanyId}
                          onClick={() => handleDeleteCompany(c)}
                          className="text-sm font-medium text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400"
                        >
                          {deletingCompanyId === c.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-foreground-subtle">{companies.length} company(ies)</p>
            </div>
          )}
        </CardBody>
      </Card>

      <CreateCompanyDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  )
}
