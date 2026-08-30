'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import logger from '@/lib/logger'
import { useToast } from '@/components/Toast'
import { deliverExportBlob, openPreviewTab } from '@/lib/deliverExportBlob'
import { format, parseISO } from 'date-fns'

interface SheetItem {
  id: string
  room_number: string
  room_type: string
  occupancy_status: string
  cleaning_status: string
}

interface Sheet {
  id: string
  housekeeper_name: string
  created_by_name: string | null
  notes: string | null
  created_at: string
  items: SheetItem[]
}

function sortRooms(items: SheetItem[]) {
  return [...items].sort((a, b) =>
    a.room_number.localeCompare(b.room_number, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  )
}

export default function HousekeepingSheetPrintPage() {
  const params = useParams()
  const toast = useToast()
  const sheetId = params?.id as string
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!sheetId) return
    ;(async () => {
      try {
        const res = await api.get(`/housekeeping/sheets/${sheetId}`)
        setSheet(res.data)
      } catch (err) {
        logger.error('Failed to load sheet', err as Error)
        setError('Assignment sheet not found')
      } finally {
        setLoading(false)
      }
    })()
  }, [sheetId])

  const checkoutRooms = useMemo(() => {
    const departing = sortRooms(
      (sheet?.items || []).filter(
        (i) => (i.occupancy_status || '').toLowerCase() === 'departing'
      )
    )
    const other = sortRooms(
      (sheet?.items || []).filter((i) => {
        const s = (i.occupancy_status || '').toLowerCase()
        return s !== 'departing' && s !== 'stayover'
      })
    )
    return [...departing, ...other]
  }, [sheet])

  const stayoverRooms = useMemo(
    () =>
      sortRooms(
        (sheet?.items || []).filter(
          (i) => (i.occupancy_status || '').toLowerCase() === 'stayover'
        )
      ),
    [sheet]
  )

  /** Checkout rows first, then stayover — matches Excel fill order */
  const orderedRows = useMemo(() => {
    const rows: { checkout?: string; stayover?: string }[] = []
    for (const r of checkoutRooms) {
      rows.push({ checkout: r.room_number })
    }
    for (const r of stayoverRooms) {
      rows.push({ stayover: r.room_number })
    }
    return rows.length ? rows : [{ checkout: '', stayover: '' }]
  }, [checkoutRooms, stayoverRooms])

  const openPdf = async () => {
    if (!sheetId || !sheet) return
    const previewWindow = openPreviewTab()
    setDownloading(true)
    try {
      const response = await api.get(`/housekeeping/sheets/${sheetId}/pdf`, {
        responseType: 'blob',
      })
      const day = format(parseISO(sheet.created_at), 'yyyyMMdd')
      const safe = sheet.housekeeper_name.replace(/[^\w\-]+/g, '_')
      const result = deliverExportBlob(response.data, `HK_${safe}_${day}.pdf`, {
        previewInBrowser: true,
        previewWindow,
        mimeType: 'application/pdf',
      })
      toast.success(
        result.mode === 'preview'
          ? 'PDF opened — use Chrome print (Ctrl+P)'
          : 'PDF ready to print'
      )
    } catch (err) {
      if (previewWindow && !previewWindow.closed) previewWindow.close()
      logger.error('Failed to open HK pdf', err as Error)
      toast.error('Failed to open PDF sheet')
    } finally {
      setDownloading(false)
    }
  }

  const created = sheet ? parseISO(sheet.created_at) : null

  return (
    <Layout>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 print:max-w-none print:px-0 print:py-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link
            href="/housekeeping"
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            ← Back to Housekeeping
          </Link>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={downloading || !sheet}
              onClick={() => void openPdf()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {downloading ? 'Opening…' : 'Open PDF / Print'}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : error || !sheet || !created ? (
          <p className="text-sm text-red-600">{error || 'Not found'}</p>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
            <header className="grid grid-cols-2 gap-3 border-b-2 border-slate-900 pb-3 text-sm font-bold uppercase tracking-wide text-slate-900">
              <div>
                <span className="text-slate-500">Date</span>
                <p className="mt-0.5 text-base normal-case tracking-normal">
                  {format(created, 'EEEE')}, {format(created, 'MM/dd/yyyy')}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Name</span>
                <p className="mt-0.5 text-base normal-case tracking-normal">
                  {sheet.housekeeper_name}
                </p>
              </div>
            </header>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-900 text-left text-xs font-semibold uppercase tracking-wide text-white">
                    <th className="border border-slate-700 px-3 py-2">Check out Room#</th>
                    <th className="border border-slate-700 px-3 py-2">Stay over Room#</th>
                    <th className="border border-slate-700 px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedRows.map((row, idx) => (
                    <tr key={idx}>
                      <td className="border border-slate-300 px-3 py-2 font-semibold tabular-nums text-slate-900">
                        {row.checkout ?? ''}
                      </td>
                      <td className="border border-slate-300 px-3 py-2 font-semibold tabular-nums text-slate-900">
                        {row.stayover ?? ''}
                      </td>
                      <td className="border border-slate-300 px-3 py-2 text-slate-500">
                        &nbsp;
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-slate-400 print:hidden">
              All check-out rooms are listed first, then stayover rooms. Use Open PDF / Print to
              view in Chrome and print.
            </p>
          </div>
        )}
      </div>
    </Layout>
  )
}
