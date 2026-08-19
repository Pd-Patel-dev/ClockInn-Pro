'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser, User } from '@/lib/auth'
import { useToast } from '@/components/Toast'
import ConfirmationDialog from '@/components/ConfirmationDialog'
import { format } from 'date-fns'

type Period = 'weekly' | 'monthly' | 'yearly'
type ViewMode = 'all' | 'marketplace'

interface BreakdownItem {
  key: string
  label: string
  amount_cents: number
}

interface MarketplacePL {
  income_cents: number
  expense_cents: number
  profit_cents: number
  cash_income_cents?: number
  card_income_cents?: number
}

interface Summary {
  period: Period
  as_of: string
  period_start: string
  period_end: string
  income_cents: number
  expense_cents: number
  net_cents: number
  income_breakdown: BreakdownItem[]
  expense_breakdown: BreakdownItem[]
  marketplace_pl: MarketplacePL
  transaction_count: number
}

interface CashTransaction {
  id: string
  kind: 'INCOME' | 'EXPENSE'
  source: string
  category: string
  amount_cents: number
  occurred_on: string
  note: string | null
  created_by_name: string | null
  cash_drawer_session_id: string | null
}

const EXPENSE_CATEGORIES = [
  { value: 'operations', label: 'Operations' },
  { value: 'marketplace', label: 'Marketplace' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'other', label: 'Other' },
]

function centsToMoney(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function categoryLabel(key: string): string {
  const found = EXPENSE_CATEGORIES.find((c) => c.value === key)
  if (found) return found.label
  if (key === 'drop') return 'Room Sale'
  if (key === 'marketplace_sale') return 'Marketplace sales'
  return key.replace(/_/g, ' ')
}

function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'success' | 'danger'
}) {
  const valueClass =
    tone === 'success'
      ? 'text-emerald-600'
      : tone === 'danger'
        ? 'text-red-600'
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

export default function AdminCashManagementPage() {
  const router = useRouter()
  const toast = useToast()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [period, setPeriod] = useState<Period>('monthly')
  const [asOf, setAsOf] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [transactions, setTransactions] = useState<CashTransaction[]>([])
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [savingExpense, setSavingExpense] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [expenseForm, setExpenseForm] = useState({
    amount: '',
    occurred_on: format(new Date(), 'yyyy-MM-dd'),
    category: 'operations',
    note: '',
  })

  useEffect(() => {
    const init = async () => {
      try {
        const currentUser = await getCurrentUser()
        if (currentUser.role !== 'ADMIN') {
          router.push('/dashboard')
          return
        }
        try {
          const info = await api.get('/company/info')
          if (info.data?.settings?.cash_drawer_enabled !== true) {
            router.replace('/dashboard')
            return
          }
        } catch {
          /* ignore */
        }
        setUser(currentUser)
      } catch {
        router.push('/login')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [router])

  const loadData = useCallback(async () => {
    setLoadingData(true)
    try {
      const params = new URLSearchParams({ period, as_of: asOf })
      const [summaryRes, txRes] = await Promise.all([
        api.get(`/admin/cash-management/summary?${params}`),
        api.get(`/admin/cash-management/transactions?${params}&limit=100`),
      ])
      setSummary(summaryRes.data)
      setTransactions(txRes.data || [])
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load cash management'
      toast.error(typeof msg === 'string' ? msg : 'Failed to load')
    } finally {
      setLoadingData(false)
    }
  }, [period, asOf, toast])

  useEffect(() => {
    if (user) loadData()
  }, [user, loadData])

  const expenses = transactions.filter((t) => t.kind === 'EXPENSE')
  const displayIncome =
    viewMode === 'marketplace'
      ? summary?.marketplace_pl.income_cents ?? 0
      : summary?.income_cents ?? 0
  const displayExpense =
    viewMode === 'marketplace'
      ? summary?.marketplace_pl.expense_cents ?? 0
      : summary?.expense_cents ?? 0
  const displayNet =
    viewMode === 'marketplace'
      ? summary?.marketplace_pl.profit_cents ?? 0
      : summary?.net_cents ?? 0

  const filteredTx =
    viewMode === 'marketplace'
      ? transactions.filter(
          (t) =>
            t.category === 'marketplace' ||
            t.category === 'marketplace_sale' ||
            t.source === 'MARKETPLACE_SALE'
        )
      : transactions

  const handleCreateExpense = async () => {
    const dollars = parseFloat(expenseForm.amount)
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    setSavingExpense(true)
    try {
      await api.post('/admin/cash-management/expenses', {
        amount_cents: Math.round(dollars * 100),
        occurred_on: expenseForm.occurred_on,
        category: expenseForm.category,
        note: expenseForm.note.trim() || null,
      })
      toast.success('Expense added')
      setShowExpenseModal(false)
      setExpenseForm({
        amount: '',
        occurred_on: format(new Date(), 'yyyy-MM-dd'),
        category: 'operations',
        note: '',
      })
      await loadData()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to add expense'
      toast.error(typeof msg === 'string' ? msg : 'Failed to add expense')
    } finally {
      setSavingExpense(false)
    }
  }

  const handleDeleteExpense = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      await api.delete(`/admin/cash-management/expenses/${deleteId}`)
      toast.success('Expense deleted')
      setDeleteId(null)
      await loadData()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to delete'
      toast.error(typeof msg === 'string' ? msg : 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  if (loading || !user) {
    return (
      <Layout>
        <div className="flex min-h-[40vh] items-center justify-center text-slate-500">
          Loading…
        </div>
      </Layout>
    )
  }

  const periodLabel = summary
    ? `${format(new Date(summary.period_start + 'T12:00:00'), 'MMM d, yyyy')} – ${format(
        new Date(summary.period_end + 'T12:00:00'),
        'MMM d, yyyy'
      )}`
    : ''

  return (
    <Layout>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Cash Management
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Income from room sales and marketplace sales, plus operational expenses.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowExpenseModal(true)}
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
          >
            Add expense
          </button>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {(['weekly', 'monthly', 'yearly'] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition ${
                  period === p
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            As of
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900"
            />
          </label>
          <div className="inline-flex rounded-xl bg-slate-100 p-1 sm:ml-auto">
            <button
              type="button"
              onClick={() => setViewMode('all')}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                viewMode === 'all'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All cash
            </button>
            <button
              type="button"
              onClick={() => setViewMode('marketplace')}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                viewMode === 'marketplace'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Marketplace P&L
            </button>
          </div>
        </div>

        {periodLabel && (
          <p className="text-sm text-slate-500">
            Period: <span className="font-medium text-slate-700">{periodLabel}</span>
            {loadingData && <span className="ml-2 text-slate-400">Updating…</span>}
          </p>
        )}

        {viewMode === 'marketplace' && summary && (
          <div className="flex flex-wrap gap-4 rounded-2xl border border-slate-200/80 bg-white px-5 py-3 text-sm shadow-sm">
            <div>
              <span className="text-slate-500">Cash sales </span>
              <span className="font-medium tabular-nums text-emerald-700">
                {centsToMoney(summary.marketplace_pl.cash_income_cents ?? 0)}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Card sales </span>
              <span className="font-medium tabular-nums text-sky-700">
                {centsToMoney(summary.marketplace_pl.card_income_cents ?? 0)}
              </span>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label={viewMode === 'marketplace' ? 'Marketplace sales' : 'Total income'}
            value={centsToMoney(displayIncome)}
            tone="success"
          />
          <StatCard
            label={viewMode === 'marketplace' ? 'Marketplace costs' : 'Total expense'}
            value={centsToMoney(displayExpense)}
            tone="danger"
          />
          <StatCard
            label={viewMode === 'marketplace' ? 'Marketplace profit' : 'Net'}
            value={centsToMoney(displayNet)}
            tone={displayNet >= 0 ? 'success' : 'danger'}
          />
        </div>

        {viewMode === 'all' && summary && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Income breakdown</h2>
              <ul className="mt-3 space-y-2">
                {(summary.income_breakdown.length
                  ? summary.income_breakdown
                  : [{ key: 'none', label: 'No income', amount_cents: 0 }]
                ).map((item) => (
                  <li
                    key={item.key}
                    className="flex items-center justify-between text-sm text-slate-700"
                  >
                    <span>{item.label}</span>
                    <span className="tabular-nums font-medium text-emerald-700">
                      {centsToMoney(item.amount_cents)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Expense breakdown</h2>
              <ul className="mt-3 space-y-2">
                {(summary.expense_breakdown.length
                  ? summary.expense_breakdown
                  : [{ key: 'none', label: 'No expenses', amount_cents: 0 }]
                ).map((item) => (
                  <li
                    key={item.key}
                    className="flex items-center justify-between text-sm text-slate-700"
                  >
                    <span>{item.label}</span>
                    <span className="tabular-nums font-medium text-red-600">
                      {centsToMoney(item.amount_cents)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">
              {viewMode === 'marketplace' ? 'Marketplace transactions' : 'Expenses'}
            </h2>
            <span className="text-xs text-slate-400">
              {viewMode === 'all' ? `${expenses.length} expense(s)` : `${filteredTx.length} row(s)`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-5 py-3 font-semibold">Date</th>
                  <th className="px-5 py-3 font-semibold">Type</th>
                  <th className="px-5 py-3 font-semibold">Category</th>
                  <th className="px-5 py-3 font-semibold">Note</th>
                  <th className="px-5 py-3 font-semibold text-right">Amount</th>
                  <th className="px-5 py-3 font-semibold text-right"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(viewMode === 'all' ? expenses : filteredTx).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                      No transactions in this period
                    </td>
                  </tr>
                ) : (
                  (viewMode === 'all' ? expenses : filteredTx).map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-5 py-3 text-slate-700">
                        {format(new Date(tx.occurred_on + 'T12:00:00'), 'MMM d, yyyy')}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                            tx.kind === 'INCOME'
                              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                              : 'bg-red-50 text-red-700 ring-red-200'
                          }`}
                        >
                          {tx.kind === 'INCOME' ? 'Income' : 'Expense'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-700">
                        {categoryLabel(tx.category)}
                      </td>
                      <td className="max-w-xs truncate px-5 py-3 text-slate-500">
                        {tx.note || '—'}
                      </td>
                      <td
                        className={`whitespace-nowrap px-5 py-3 text-right tabular-nums font-medium ${
                          tx.kind === 'INCOME' ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {tx.kind === 'INCOME' ? '+' : '−'}
                        {centsToMoney(tx.amount_cents)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {tx.kind === 'EXPENSE' && tx.source === 'MANUAL' && (
                          <button
                            type="button"
                            onClick={() => setDeleteId(tx.id)}
                            className="text-xs font-medium text-slate-400 hover:text-red-600"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {viewMode === 'all' && (
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Recent transactions</h2>
            </div>
            <ul className="divide-y divide-slate-100">
              {transactions.slice(0, 20).length === 0 ? (
                <li className="px-5 py-8 text-center text-sm text-slate-400">
                  No transactions yet
                </li>
              ) : (
                transactions.slice(0, 20).map((tx) => (
                  <li
                    key={tx.id}
                    className="flex items-center justify-between gap-4 px-5 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800">
                        {tx.kind === 'INCOME' ? 'Income' : 'Expense'} ·{' '}
                        {categoryLabel(tx.category)}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {format(new Date(tx.occurred_on + 'T12:00:00'), 'MMM d, yyyy')}
                        {tx.note ? ` · ${tx.note}` : ''}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 tabular-nums font-medium ${
                        tx.kind === 'INCOME' ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {tx.kind === 'INCOME' ? '+' : '−'}
                      {centsToMoney(tx.amount_cents)}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>

      {showExpenseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Add expense</h3>
            <p className="mt-1 text-sm text-slate-500">
              Use Marketplace for inventory/COGS; other categories for operations.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="text-slate-600">Amount ($)</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={expenseForm.amount}
                  onChange={(e) =>
                    setExpenseForm((f) => ({ ...f, amount: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  placeholder="0.00"
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Date</span>
                <input
                  type="date"
                  value={expenseForm.occurred_on}
                  onChange={(e) =>
                    setExpenseForm((f) => ({ ...f, occurred_on: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Category</span>
                <select
                  value={expenseForm.category}
                  onChange={(e) =>
                    setExpenseForm((f) => ({ ...f, category: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Note</span>
                <textarea
                  value={expenseForm.note}
                  onChange={(e) =>
                    setExpenseForm((f) => ({ ...f, note: e.target.value }))
                  }
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  placeholder="Optional"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowExpenseModal(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingExpense}
                onClick={handleCreateExpense}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {savingExpense ? 'Saving…' : 'Save expense'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationDialog
        isOpen={Boolean(deleteId)}
        title="Delete expense?"
        message="This removes the manual expense from the ledger. This cannot be undone."
        confirmText="Delete"
        type="error"
        onConfirm={handleDeleteExpense}
        onCancel={() => setDeleteId(null)}
      />
    </Layout>
  )
}
