'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { getCurrentUser, User } from '@/lib/auth'
import { useToast } from '@/components/Toast'
import { Modal, ConfirmModal } from '@/components/ui/Modal'
import logger from '@/lib/logger'
import { format, parseISO } from 'date-fns'
import { deliverExportBlob, openPreviewTab } from '@/lib/deliverExportBlob'

type Tab = 'board' | 'assign' | 'sheets' | 'rooms'

interface Room {
  id: string
  number: string
  room_type: string
  occupancy_status: 'departing' | 'stayover' | string
  cleaning_status: 'clean' | 'dirty' | string
  assigned_housekeeper_id?: string | null
  is_active: boolean
  updated_at: string
}

interface Housekeeper {
  id: string
  name: string
  email: string
}

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

/** e.g. 103 → 104, 010 → 011, Suite-12 → Suite-13 */
function nextRoomNumber(current: string): string {
  const trimmed = current.trim()
  const match = trimmed.match(/^(.*?)(\d+)$/)
  if (!match) return ''
  const [, prefix, digits] = match
  const next = String(parseInt(digits, 10) + 1).padStart(digits.length, '0')
  return `${prefix}${next}`
}

function canManageRooms(role: string | undefined) {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'DEVELOPER'
}

function StatCard({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'warning' | 'success' | 'danger'
}) {
  const valueClass =
    tone === 'warning'
      ? 'text-amber-600'
      : tone === 'success'
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
    </div>
  )
}

function roomBoardTone(room: Room): 'green' | 'yellow' {
  return room.occupancy_status === 'stayover' ? 'yellow' : 'green'
}

function roomBoardToneLabel(tone: 'green' | 'yellow'): string {
  return tone === 'yellow' ? 'Stayover' : 'Departing'
}

function roomBoardToneClass(tone: 'green' | 'yellow'): string {
  if (tone === 'yellow') return 'bg-amber-300 text-slate-900'
  return 'bg-emerald-400 text-slate-900'
}

function roomTypeCode(roomType: string): string {
  const t = (roomType || '').trim()
  if (!t) return '—'
  // Prefer short codes; otherwise compress to an uppercase abbreviation
  if (t.length <= 8) return t.toUpperCase()
  return t
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 6)
}

function RoomStatusRows({
  rooms: columnRooms,
  onRoomClick,
  selectMode = false,
  selectedIds,
  onToggleSelect,
}: {
  rooms: Room[]
  onRoomClick: (room: Room) => void
  selectMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (room: Room) => void
}) {
  return (
    <>
      {columnRooms.map((room) => {
        const tone = roomBoardTone(room)
        const clean = room.cleaning_status === 'clean'
        const selected = selectMode && selectedIds?.has(room.id)
        return (
          <tr key={room.id} className="border-t border-slate-200">
            <td className="p-0">
              <button
                type="button"
                title={
                  selectMode
                    ? selected
                      ? `Deselect room ${room.number}`
                      : `Select room ${room.number}`
                    : `Room ${room.number} — ${roomBoardToneLabel(tone)}`
                }
                onClick={() =>
                  selectMode && onToggleSelect
                    ? onToggleSelect(room)
                    : onRoomClick(room)
                }
                className={`relative flex w-full items-center justify-center gap-1.5 px-2 py-1.5 text-center text-sm font-bold tabular-nums leading-none ${roomBoardToneClass(tone)} hover:brightness-95 ${
                  selected ? 'ring-2 ring-inset ring-slate-900' : ''
                }`}
              >
                {selectMode && (
                  <span
                    className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[10px] leading-none ${
                      selected
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-700/50 bg-white/80 text-transparent'
                    }`}
                    aria-hidden
                  >
                    ✓
                  </span>
                )}
                {room.number}
              </button>
            </td>
            <td className="bg-white px-1 py-1.5 text-center">
              <span
                className={`text-sm font-bold ${clean ? 'text-emerald-600' : 'text-red-500'}`}
                title={clean ? 'Clean' : 'Dirty'}
              >
                ✓
              </span>
            </td>
            <td
              className="truncate bg-white px-1.5 py-1.5 font-medium uppercase tracking-tight text-slate-700"
              title={room.room_type}
            >
              {roomTypeCode(room.room_type)}
            </td>
          </tr>
        )
      })}
    </>
  )
}

function RoomColumnTable({
  children,
  toolbar,
  embedded = false,
}: {
  children: ReactNode
  toolbar?: ReactNode
  embedded?: boolean
}) {
  if (embedded) {
    return (
      <div className="w-[15rem] shrink-0 overflow-hidden rounded-none border border-slate-200/90 bg-white p-2 shadow-sm ring-1 ring-slate-900/5 sm:w-[17rem]">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-gradient-to-b from-slate-800 to-slate-900 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-100">
              <th className="min-w-[4.5rem] border-b border-white/10 px-2 py-2.5 text-center sm:min-w-[5.5rem]">
                Status
              </th>
              <th className="w-9 border-b border-white/10 px-1 py-2.5 text-center">Cond</th>
              <th className="border-b border-white/10 px-1.5 py-2.5 text-left">Type</th>
            </tr>
          </thead>
          <tbody className="bg-white">{children}</tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="w-[15rem] shrink-0 overflow-hidden rounded-none border border-slate-200/90 bg-white p-2 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.35)] ring-1 ring-slate-900/5 sm:w-[17rem]">
      {toolbar}
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-gradient-to-b from-slate-800 to-slate-900 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-100">
            <th className="min-w-[4.5rem] border-b border-white/10 px-2 py-2.5 text-center sm:min-w-[5.5rem]">
              Status
            </th>
            <th className="w-9 border-b border-white/10 px-1 py-2.5 text-center">Cond</th>
            <th className="border-b border-white/10 px-1.5 py-2.5 text-left">Type</th>
          </tr>
        </thead>
        <tbody className="bg-white">{children}</tbody>
      </table>
    </div>
  )
}

function chunkRooms(list: Room[], size = 20): Room[][] {
  const chunks: Room[][] = []
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size))
  }
  return chunks.length ? chunks : [[]]
}

export default function HousekeepingPage() {
  const toast = useToast()
  const [user, setUser] = useState<User | null>(null)
  const [tab, setTab] = useState<Tab>('board')
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'dirty' | 'stayover' | 'departing'>('all')
  const [dialogRoomId, setDialogRoomId] = useState<string | null>(null)
  const [bulkEdit, setBulkEdit] = useState(false)
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set())
  const [bulkPendingStatus, setBulkPendingStatus] = useState<'departing' | 'stayover' | null>(
    null
  )
  const [bulkUpdating, setBulkUpdating] = useState(false)

  const [housekeepers, setHousekeepers] = useState<Housekeeper[]>([])
  const [assignHkFilter, setAssignHkFilter] = useState<string | null>(null)
  const [assignDialogHkId, setAssignDialogHkId] = useState<string | null>(null)
  const [pickRoomIds, setPickRoomIds] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState(false)
  const [printingHkId, setPrintingHkId] = useState<string | null>(null)
  const [assignSelect, setAssignSelect] = useState(false)
  const [assignSelectedIds, setAssignSelectedIds] = useState<Set<string>>(new Set())
  const [unassigning, setUnassigning] = useState(false)
  const [finalizeConfirmOpen, setFinalizeConfirmOpen] = useState(false)
  const [finalizing, setFinalizing] = useState(false)

  const [sheets, setSheets] = useState<Sheet[]>([])
  const [sheetsLoading, setSheetsLoading] = useState(false)
  const [sheetsTotalRooms, setSheetsTotalRooms] = useState(0)
  const [sheetFilters, setSheetFilters] = useState({
    housekeeper_id: '',
    start_date: '',
    end_date: '',
  })
  const [viewingSheetId, setViewingSheetId] = useState<string | null>(null)

  const [newNumber, setNewNumber] = useState('')
  const [newType, setNewType] = useState('Standard')
  const [savingRoom, setSavingRoom] = useState(false)
  const roomNumberRef = useRef<HTMLInputElement>(null)

  const roomAdmin = canManageRooms(user?.role)
  // Grant via role default or employee Permissions override
  const statusEditor = Boolean(user?.permissions?.includes('housekeeping'))

  const loadRooms = useCallback(async () => {
    try {
      const res = await api.get('/housekeeping/rooms')
      setRooms(res.data || [])
    } catch (error) {
      logger.error('Failed to load rooms', error as Error)
      toast.error('Failed to load rooms')
    }
  }, [toast])

  const loadSheets = useCallback(async () => {
    setSheetsLoading(true)
    try {
      const params: Record<string, string | number> = { limit: 200 }
      if (sheetFilters.housekeeper_id) params.housekeeper_id = sheetFilters.housekeeper_id
      if (sheetFilters.start_date) params.start_date = sheetFilters.start_date
      if (sheetFilters.end_date) params.end_date = sheetFilters.end_date
      const res = await api.get('/housekeeping/sheets', { params })
      setSheets(res.data?.sheets || [])
      setSheetsTotalRooms(Number(res.data?.total_rooms || 0))
    } catch (error) {
      logger.error('Failed to load sheets', error as Error)
      toast.error('Failed to load assignment sheets')
    } finally {
      setSheetsLoading(false)
    }
  }, [toast, sheetFilters])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const me = await getCurrentUser()
        if (!mounted) return
        setUser(me)
        await loadRooms()
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [loadRooms])

  useEffect(() => {
    if (tab === 'assign' || tab === 'sheets') {
      api
        .get('/housekeeping/housekeepers')
        .then((res) => {
          const list: Housekeeper[] = res.data || []
          setHousekeepers(list)
          if (tab === 'assign') {
            setAssignHkFilter((prev) => {
              if (prev && list.some((h) => h.id === prev)) return prev
              return list[0]?.id ?? null
            })
          }
        })
        .catch((error) => {
          logger.error('Failed to load housekeepers', error as Error)
          toast.error('Failed to load housekeepers')
        })
    }
    if (tab === 'sheets') {
      loadSheets()
    }
  }, [tab, loadSheets, toast])

  const stats = useMemo(() => {
    const dirty = rooms.filter((r) => r.cleaning_status === 'dirty').length
    const stayover = rooms.filter((r) => r.occupancy_status === 'stayover').length
    const departing = rooms.filter((r) => r.occupancy_status === 'departing').length
    return { total: rooms.length, dirty, stayover, departing }
  }, [rooms])

  const filteredRooms = useMemo(() => {
    return rooms.filter((r) => {
      if (filter === 'dirty') return r.cleaning_status === 'dirty'
      if (filter === 'stayover') return r.occupancy_status === 'stayover'
      if (filter === 'departing') return r.occupancy_status === 'departing'
      return true
    })
  }, [rooms, filter])

  const roomColumns = useMemo(() => {
    const sorted = [...filteredRooms].sort((a, b) =>
      a.number.localeCompare(b.number, undefined, { numeric: true, sensitivity: 'base' })
    )
    return chunkRooms(sorted, 20)
  }, [filteredRooms])

  const dialogRoom = useMemo(
    () => (dialogRoomId ? rooms.find((r) => r.id === dialogRoomId) ?? null : null),
    [dialogRoomId, rooms]
  )

  const patchRoom = async (roomId: string, patch: Partial<Room>) => {
    if (!statusEditor && ('occupancy_status' in patch || 'cleaning_status' in patch)) {
      toast.error('You do not have permission to update room status')
      return
    }
    setUpdatingId(roomId)
    try {
      const res = await api.patch(`/housekeeping/rooms/${roomId}`, patch)
      setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, ...res.data } : r)))
      if (
        patch.occupancy_status === 'departing' &&
        res.data.cleaning_status === 'dirty' &&
        !('cleaning_status' in patch)
      ) {
        toast.success('Marked departing — room set dirty')
      }
    } catch (error: any) {
      logger.error('Failed to update room', error as Error)
      toast.error(error?.response?.data?.detail || 'Failed to update room')
    } finally {
      setUpdatingId(null)
    }
  }

  const toggleBulkSelect = (room: Room) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(room.id)) next.delete(room.id)
      else next.add(room.id)
      return next
    })
  }

  const exitBulkEdit = () => {
    setBulkEdit(false)
    setBulkSelectedIds(new Set())
    setBulkPendingStatus(null)
  }

  const applyBulkStatus = async (occupancy_status: 'departing' | 'stayover') => {
    if (!statusEditor) {
      toast.error('You do not have permission to update room status')
      return
    }
    if (bulkSelectedIds.size === 0) {
      toast.error('Select at least one room')
      return
    }
    setBulkUpdating(true)
    try {
      const res = await api.post('/housekeeping/rooms/bulk', {
        room_ids: Array.from(bulkSelectedIds),
        occupancy_status,
      })
      const updated: Room[] = res.data || []
      const byId = new Map(updated.map((r) => [r.id, r]))
      setRooms((prev) => prev.map((r) => byId.get(r.id) ?? r))
      toast.success(
        `Updated ${updated.length} room${updated.length === 1 ? '' : 's'} to ${occupancy_status}`
      )
      exitBulkEdit()
    } catch (error: any) {
      logger.error('Failed to bulk update rooms', error as Error)
      toast.error(error?.response?.data?.detail || 'Failed to update rooms')
    } finally {
      setBulkUpdating(false)
    }
  }

  const saveBulkEdit = () => {
    if (!bulkPendingStatus) {
      toast.error('Choose Departing or Stayover')
      return
    }
    void applyBulkStatus(bulkPendingStatus)
  }

  const unassignedRooms = useMemo(
    () =>
      rooms
        .filter((r) => !r.assigned_housekeeper_id)
        .sort((a, b) =>
          a.number.localeCompare(b.number, undefined, { numeric: true, sensitivity: 'base' })
        ),
    [rooms]
  )

  const assignDialogHk = useMemo(
    () => housekeepers.find((h) => h.id === assignDialogHkId) ?? null,
    [housekeepers, assignDialogHkId]
  )

  const selectedHousekeeper = useMemo(() => {
    if (!housekeepers.length) return null
    return housekeepers.find((h) => h.id === assignHkFilter) ?? housekeepers[0]
  }, [housekeepers, assignHkFilter])

  const selectedHkRooms = useMemo(() => {
    if (!selectedHousekeeper) return []
    return rooms
      .filter((r) => r.assigned_housekeeper_id === selectedHousekeeper.id)
      .sort((a, b) =>
        a.number.localeCompare(b.number, undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      )
  }, [rooms, selectedHousekeeper])

  const selectedHkDirtyCount = useMemo(
    () => selectedHkRooms.filter((r) => r.cleaning_status === 'dirty').length,
    [selectedHkRooms]
  )

  const housekeeperRoomCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const hk of housekeepers) counts.set(hk.id, 0)
    for (const room of rooms) {
      const id = room.assigned_housekeeper_id
      if (id && counts.has(id)) counts.set(id, (counts.get(id) || 0) + 1)
    }
    return counts
  }, [rooms, housekeepers])

  const toggleSelect = (id: string) => {
    setPickRoomIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openAssignDialog = (housekeeperId: string) => {
    setAssignDialogHkId(housekeeperId)
    setPickRoomIds(new Set())
  }

  const confirmAssignRooms = async () => {
    if (!assignDialogHkId) return
    if (pickRoomIds.size === 0) {
      toast.error('Select at least one room')
      return
    }
    setAssigning(true)
    try {
      const res = await api.post('/housekeeping/rooms/assign', {
        housekeeper_id: assignDialogHkId,
        room_ids: Array.from(pickRoomIds),
      })
      const updated: Room[] = res.data || []
      const byId = new Map(updated.map((r) => [r.id, r]))
      setRooms((prev) => prev.map((r) => (byId.has(r.id) ? { ...r, ...byId.get(r.id)! } : r)))
      toast.success(`Assigned ${updated.length} room(s)`)
      setAssignDialogHkId(null)
      setPickRoomIds(new Set())
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to assign rooms')
    } finally {
      setAssigning(false)
    }
  }

  const unassignRoom = async (room: Room) => {
    try {
      const res = await api.post('/housekeeping/rooms/unassign', { room_ids: [room.id] })
      const updated: Room = (res.data || [])[0]
      if (updated) {
        setRooms((prev) => prev.map((r) => (r.id === room.id ? { ...r, ...updated } : r)))
      }
      toast.success(`Room ${room.number} unassigned`)
      setDialogRoomId(null)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to unassign room')
    }
  }

  const exitAssignSelect = () => {
    setAssignSelect(false)
    setAssignSelectedIds(new Set())
  }

  const toggleAssignSelect = (room: Room) => {
    setAssignSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(room.id)) next.delete(room.id)
      else next.add(room.id)
      return next
    })
  }

  const unassignSelectedRooms = async () => {
    if (assignSelectedIds.size === 0) {
      toast.error('Select at least one room')
      return
    }
    setUnassigning(true)
    try {
      const res = await api.post('/housekeeping/rooms/unassign', {
        room_ids: Array.from(assignSelectedIds),
      })
      const updated: Room[] = res.data || []
      const byId = new Map(updated.map((r) => [r.id, r]))
      setRooms((prev) => prev.map((r) => byId.get(r.id) ?? r))
      toast.success(
        `Unassigned ${updated.length} room${updated.length === 1 ? '' : 's'}`
      )
      exitAssignSelect()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to unassign rooms')
    } finally {
      setUnassigning(false)
    }
  }

  const printSheetPdf = async (housekeeperId: string) => {
    const roomIds = rooms
      .filter((r) => r.assigned_housekeeper_id === housekeeperId)
      .map((r) => r.id)
    if (roomIds.length === 0) {
      toast.error('Assign at least one room before printing')
      return
    }
    const previewWindow = openPreviewTab()
    setPrintingHkId(housekeeperId)
    try {
      const pdf = await api.get(`/housekeeping/housekeepers/${housekeeperId}/pdf`, {
        responseType: 'blob',
      })
      const hkName =
        housekeepers.find((h) => h.id === housekeeperId)?.name || 'housekeeper'
      const safe = hkName.replace(/[^\w\-]+/g, '_')
      const result = deliverExportBlob(
        pdf.data,
        `HK_${safe}_${new Date().toISOString().slice(0, 10)}.pdf`,
        {
          previewInBrowser: true,
          previewWindow,
          mimeType: 'application/pdf',
        }
      )
      toast.success(
        result.mode === 'preview'
          ? 'PDF opened — use Chrome print (Ctrl+P)'
          : 'PDF ready to print'
      )
    } catch (error: any) {
      if (previewWindow && !previewWindow.closed) previewWindow.close()
      logger.error('Failed to print HK pdf', error as Error)
      toast.error(error?.response?.data?.detail || 'Failed to open PDF')
    } finally {
      setPrintingHkId(null)
    }
  }

  const viewPastSheetPdf = async (sheet: Sheet) => {
    const previewWindow = openPreviewTab()
    setViewingSheetId(sheet.id)
    try {
      const pdf = await api.get(`/housekeeping/sheets/${sheet.id}/pdf`, {
        responseType: 'blob',
      })
      const day = format(parseISO(sheet.created_at), 'yyyy-MM-dd')
      const safe = (sheet.housekeeper_name || 'housekeeper').replace(/[^\w\-]+/g, '_')
      const result = deliverExportBlob(pdf.data, `HK_${safe}_${day}.pdf`, {
        previewInBrowser: true,
        previewWindow,
        mimeType: 'application/pdf',
      })
      toast.success(
        result.mode === 'preview'
          ? 'PDF opened — use Chrome print (Ctrl+P)'
          : 'PDF ready to print'
      )
    } catch (error: any) {
      if (previewWindow && !previewWindow.closed) previewWindow.close()
      logger.error('Failed to view past HK pdf', error as Error)
      toast.error(error?.response?.data?.detail || 'Failed to open PDF')
    } finally {
      setViewingSheetId(null)
    }
  }

  const finalizeCleaning = async () => {
    if (!selectedHousekeeper) return
    setFinalizing(true)
    try {
      const res = await api.post('/housekeeping/sheets/finalize', {
        housekeeper_id: selectedHousekeeper.id,
      })
      const sheet = res.data
      const count = sheet?.items?.length ?? 0
      // Mark those rooms clean + unassigned in local state immediately
      const finalizedIds = new Set(
        (sheet?.items || [])
          .map((item: { room_id?: string | null }) => item.room_id)
          .filter(Boolean) as string[]
      )
      setRooms((prev) =>
        prev.map((r) =>
          finalizedIds.has(r.id) || r.assigned_housekeeper_id === selectedHousekeeper.id
            ? {
                ...r,
                cleaning_status: 'clean',
                assigned_housekeeper_id: null,
              }
            : r
        )
      )
      await loadRooms()
      exitAssignSelect()
      setFinalizeConfirmOpen(false)
      toast.success(
        `Cleaning done — ${count} room(s) cleaned, unassigned, and saved to Past sheets`
      )
    } catch (error: any) {
      logger.error('Failed to finalize cleaning', error as Error)
      toast.error(error?.response?.data?.detail || 'Failed to finalize board')
    } finally {
      setFinalizing(false)
    }
  }

  const selectDirty = () => {
    setPickRoomIds(
      new Set(unassignedRooms.filter((r) => r.cleaning_status === 'dirty').map((r) => r.id))
    )
  }

  const createRoom = async () => {
    const number = newNumber.trim()
    if (!number) {
      toast.error('Room number is required')
      return
    }
    setSavingRoom(true)
    try {
      await api.post('/housekeeping/rooms', {
        number,
        room_type: newType.trim() || 'Standard',
      })
      toast.success(`Room ${number} added`)
      setNewNumber(nextRoomNumber(number))
      await loadRooms()
      requestAnimationFrame(() => {
        roomNumberRef.current?.focus()
        roomNumberRef.current?.select()
      })
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to add room')
    } finally {
      setSavingRoom(false)
    }
  }

  const removeRoom = async (room: Room) => {
    if (!window.confirm(`Remove room ${room.number}? This cannot be undone.`)) return
    try {
      await api.delete(`/housekeeping/rooms/${room.id}`)
      toast.success(`Room ${room.number} removed`)
      await loadRooms()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to remove room')
    }
  }

  const tabs: { id: Tab; label: string; show?: boolean }[] = [
    { id: 'board', label: 'Board' },
    { id: 'assign', label: 'Assign & print', show: statusEditor },
    { id: 'sheets', label: 'Past sheets' },
    { id: 'rooms', label: 'Room setup', show: roomAdmin },
  ]

  return (
    <Layout>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Housekeeping</h1>
          <p className="mt-1 text-sm text-slate-500">
            Board status is Departing (green) or Stayover (yellow). Stayover → Departing
            auto-marks dirty. Assign/print is available to anyone with the Housekeeping
            permission (grant it on the employee Permissions tab). Room setup stays Admin /
            Manager only.
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Rooms" value={stats.total} />
          <StatCard label="Dirty" value={stats.dirty} tone="warning" />
          <StatCard label="Stayover" value={stats.stayover} tone="warning" />
          <StatCard label="Departing" value={stats.departing} tone="success" />
        </div>

        <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
          {tabs
            .filter((t) => t.show !== false)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id)
                  if (t.id !== 'board') exitBulkEdit()
                  if (t.id !== 'assign') exitAssignSelect()
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  tab === t.id
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:!bg-transparent dark:text-foreground-muted dark:ring-1 dark:ring-inset dark:ring-white/10 dark:hover:!bg-white/[0.04] dark:hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : tab === 'board' ? (
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {(['all', 'dirty', 'stayover', 'departing'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                    filter === f
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/80 dark:!bg-transparent dark:text-foreground-muted dark:ring-white/10 dark:hover:!bg-white/[0.04]'
                  }`}
                >
                  {f}
                </button>
              ))}
              {statusEditor && !bulkEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setBulkEdit(true)
                    setBulkSelectedIds(new Set())
                    setBulkPendingStatus(null)
                    setDialogRoomId(null)
                  }}
                  className="ml-auto rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200/80 hover:bg-slate-200 dark:!bg-transparent dark:text-foreground-muted dark:ring-white/10 dark:hover:!bg-white/[0.04]"
                >
                  Select
                </button>
              )}
            </div>

            {filteredRooms.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
                <p className="text-sm text-slate-600">
                  {rooms.length === 0
                    ? roomAdmin
                      ? 'No rooms yet. Add rooms under Room setup.'
                      : 'No rooms configured yet. Ask an Admin or Manager to add rooms.'
                    : 'No rooms match this filter.'}
                </p>
              </div>
            ) : (
              <div>
                <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600">
                  {bulkEdit ? (
                    <span className="font-medium text-slate-700">
                      Tap rooms to select, choose Departing or Stayover, then Save.
                    </span>
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-3 w-3 rounded-sm bg-emerald-400" /> Departing
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-3 w-3 rounded-sm bg-amber-300" /> Stayover
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-semibold text-emerald-600">✓</span> Clean
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-semibold text-red-500">✓</span> Dirty
                      </span>
                    </>
                  )}
                </div>
                <div className="inline-flex max-w-full flex-col">
                  <div className="flex gap-3 overflow-x-auto">
                    {roomColumns.map((columnRooms, idx) => (
                      <RoomColumnTable key={`board-col-${idx}`}>
                        <RoomStatusRows
                          rooms={columnRooms}
                          onRoomClick={(room) => setDialogRoomId(room.id)}
                          selectMode={bulkEdit}
                          selectedIds={bulkSelectedIds}
                          onToggleSelect={toggleBulkSelect}
                        />
                      </RoomColumnTable>
                    ))}
                  </div>

                  {bulkEdit && statusEditor && (
                    <div className="mt-2 flex w-full flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={bulkUpdating}
                        onClick={exitBulkEdit}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                      >
                        Cancel
                      </button>
                      <span className="text-sm text-slate-500">
                        <span className="font-semibold tabular-nums text-slate-800">
                          {bulkSelectedIds.size}
                        </span>{' '}
                        selected
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setBulkSelectedIds(new Set(filteredRooms.map((r) => r.id)))
                        }
                        className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        disabled={bulkSelectedIds.size === 0}
                        onClick={() => setBulkSelectedIds(new Set())}
                        className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                      >
                        Unselect all
                      </button>
                      <div className="flex flex-wrap gap-2 sm:ml-auto">
                        <button
                          type="button"
                          onClick={() => setBulkPendingStatus('departing')}
                          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                            bulkPendingStatus === 'departing'
                              ? 'bg-emerald-400 text-slate-900 ring-2 ring-slate-900/15'
                              : 'bg-emerald-400/70 text-slate-900 hover:bg-emerald-400'
                          }`}
                        >
                          Departing
                        </button>
                        <button
                          type="button"
                          onClick={() => setBulkPendingStatus('stayover')}
                          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                            bulkPendingStatus === 'stayover'
                              ? 'bg-amber-300 text-slate-900 ring-2 ring-slate-900/15'
                              : 'bg-amber-300/70 text-slate-900 hover:bg-amber-300'
                          }`}
                        >
                          Stayover
                        </button>
                        <button
                          type="button"
                          disabled={
                            bulkUpdating ||
                            bulkSelectedIds.size === 0 ||
                            !bulkPendingStatus
                          }
                          onClick={saveBulkEdit}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
                        >
                          {bulkUpdating ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : tab === 'assign' ? (
          <div className="space-y-4">
            {housekeepers.length === 0 || !selectedHousekeeper ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-600">
                No active housekeeping employees. Add one under Employees.
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_8px_24px_-12px_rgba(15,23,42,0.35)] ring-1 ring-slate-900/5 dark:border-white/10 dark:bg-surface dark:shadow-none dark:ring-0">
                <div className="space-y-3 border-b border-slate-200/80 bg-slate-50/90 px-4 py-4 sm:px-5 dark:border-white/10 dark:bg-transparent">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                        Housekeeper
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {housekeepers.map((hk) => {
                          const count = housekeeperRoomCounts.get(hk.id) ?? 0
                          const active = selectedHousekeeper.id === hk.id
                          return (
                            <button
                              key={hk.id}
                              type="button"
                              onClick={() => {
                                setAssignHkFilter(hk.id)
                                exitAssignSelect()
                              }}
                              className={`inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition ${
                                active
                                  ? 'bg-slate-900 text-white shadow-sm'
                                  : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200/80 hover:bg-slate-200 dark:!bg-transparent dark:text-foreground-muted dark:ring-white/10 dark:hover:!bg-white/[0.04]'
                              }`}
                            >
                              <span>{hk.name}</span>
                              <span
                                className={`rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                                  active
                                    ? 'bg-white/15 text-slate-100'
                                    : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-foreground-subtle'
                                }`}
                              >
                                {count}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                      {!assignSelect && (
                        <button
                          type="button"
                          disabled={selectedHkRooms.length === 0}
                          onClick={() => {
                            setAssignSelect(true)
                            setAssignSelectedIds(new Set())
                            setDialogRoomId(null)
                          }}
                          className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-slate-100 px-3.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-200 disabled:opacity-40 dark:border-white/10 dark:!bg-transparent dark:text-foreground-muted dark:shadow-none dark:hover:!bg-white/[0.04]"
                        >
                          Select
                        </button>
                      )}
                      <button
                        type="button"
                        title="Assign rooms"
                        disabled={assignSelect}
                        onClick={() => openAssignDialog(selectedHousekeeper.id)}
                        className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-40 dark:bg-accent dark:hover:bg-accent-hover"
                      >
                        <span className="text-base leading-none">+</span>
                        Assign rooms
                      </button>
                      <button
                        type="button"
                        disabled={
                          assignSelect ||
                          printingHkId === selectedHousekeeper.id ||
                          selectedHkRooms.length === 0
                        }
                        onClick={() => void printSheetPdf(selectedHousekeeper.id)}
                        className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-slate-100 px-3.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-200 disabled:opacity-40 dark:border-white/10 dark:!bg-transparent dark:text-foreground-muted dark:shadow-none dark:hover:!bg-white/[0.04]"
                      >
                        {printingHkId === selectedHousekeeper.id ? 'Printing…' : 'Print sheet'}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
                    <span className="tabular-nums">
                      <span className="font-semibold text-slate-700">{selectedHkRooms.length}</span>{' '}
                      room{selectedHkRooms.length === 1 ? '' : 's'} assigned
                    </span>
                    {selectedHkDirtyCount > 0 && (
                      <span className="tabular-nums">
                        <span className="font-semibold text-red-600">{selectedHkDirtyCount}</span>{' '}
                        dirty
                      </span>
                    )}
                    <span className="hidden text-slate-300 sm:inline">·</span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Departing
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-amber-300" /> Stayover
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-semibold text-emerald-600">✓</span> Clean
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-semibold text-red-500">✓</span> Dirty
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto bg-slate-50/40 px-4 py-4 sm:px-5 dark:bg-transparent">
                  <div className="inline-flex max-w-full flex-col">
                    <div className="flex min-w-min gap-3">
                      {chunkRooms(selectedHkRooms, 20).map((columnRooms, chunkIdx) => (
                        <RoomColumnTable key={`${selectedHousekeeper.id}-${chunkIdx}`} embedded>
                          {columnRooms.length === 0 ? (
                            <tr>
                              <td
                                colSpan={3}
                                className="px-3 py-10 text-center text-sm text-slate-400"
                              >
                                No rooms yet — tap Assign rooms
                              </td>
                            </tr>
                          ) : (
                            <RoomStatusRows
                              rooms={columnRooms}
                              onRoomClick={(room) => setDialogRoomId(room.id)}
                              selectMode={assignSelect}
                              selectedIds={assignSelectedIds}
                              onToggleSelect={toggleAssignSelect}
                            />
                          )}
                        </RoomColumnTable>
                      ))}
                    </div>

                    {assignSelect && (
                      <div className="mt-3 flex w-full flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={unassigning}
                          onClick={exitAssignSelect}
                          className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                        >
                          Cancel
                        </button>
                        <span className="text-sm text-slate-500">
                          <span className="font-semibold tabular-nums text-slate-800">
                            {assignSelectedIds.size}
                          </span>{' '}
                          selected
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setAssignSelectedIds(new Set(selectedHkRooms.map((r) => r.id)))
                          }
                          className="inline-flex h-9 items-center rounded-lg px-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          disabled={assignSelectedIds.size === 0}
                          onClick={() => setAssignSelectedIds(new Set())}
                          className="inline-flex h-9 items-center rounded-lg px-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                        >
                          Unselect all
                        </button>
                        <button
                          type="button"
                          disabled={unassigning || assignSelectedIds.size === 0}
                          onClick={() => void unassignSelectedRooms()}
                          className="ml-auto inline-flex h-9 items-center rounded-lg bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40"
                        >
                          {unassigning ? 'Unassigning…' : 'Unassign'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {!assignSelect && selectedHkRooms.length > 0 && (
                  <div className="flex items-center justify-end border-t border-slate-200/80 bg-white px-4 py-3 sm:px-5">
                    <button
                      type="button"
                      disabled={finalizing}
                      onClick={() => setFinalizeConfirmOpen(true)}
                      className="inline-flex h-10 items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-40"
                    >
                      Cleaning Done
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : tab === 'sheets' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4 items-end">
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Housekeeper
                    </label>
                    <select
                      value={sheetFilters.housekeeper_id}
                      onChange={(e) =>
                        setSheetFilters((prev) => ({
                          ...prev,
                          housekeeper_id: e.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    >
                      <option value="">All housekeepers</option>
                      {housekeepers.map((hk) => (
                        <option key={hk.id} value={hk.id}>
                          {hk.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Start date
                    </label>
                    <input
                      type="date"
                      value={sheetFilters.start_date}
                      onChange={(e) =>
                        setSheetFilters((prev) => ({
                          ...prev,
                          start_date: e.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      End date
                    </label>
                    <input
                      type="date"
                      value={sheetFilters.end_date}
                      min={sheetFilters.start_date || undefined}
                      onChange={(e) =>
                        setSheetFilters((prev) => ({
                          ...prev,
                          end_date: e.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSheetFilters({
                          housekeeper_id: '',
                          start_date: '',
                          end_date: '',
                        })
                      }
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm sm:min-w-[10rem]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Total rooms
                </p>
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
                  {sheetsTotalRooms}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">Matching filters</p>
              </div>
            </div>

            {sheetsLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : sheets.length === 0 ? (
              <p className="text-sm text-slate-500">
                {sheetFilters.housekeeper_id ||
                sheetFilters.start_date ||
                sheetFilters.end_date
                  ? 'No sheets match these filters.'
                  : 'No assignment sheets yet.'}
              </p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">Housekeeper</th>
                      <th className="px-4 py-3">Rooms</th>
                      <th className="px-4 py-3">By</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sheets.map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-3 text-slate-700">
                          {format(parseISO(s.created_at), 'MMM d, yyyy h:mm a')}
                        </td>
                        <td className="px-4 py-3 font-medium">{s.housekeeper_name}</td>
                        <td className="px-4 py-3">{s.items?.length ?? 0}</td>
                        <td className="px-4 py-3 text-slate-500">{s.created_by_name || '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            disabled={viewingSheetId === s.id}
                            onClick={() => void viewPastSheetPdf(s)}
                            className="text-sm font-medium text-slate-900 underline-offset-2 hover:underline disabled:opacity-40"
                          >
                            {viewingSheetId === s.id ? 'Opening…' : 'View'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Add room</h2>
              <p className="mt-1 text-xs text-slate-500">
                Only number and type are stored. Press Enter to add — next number is filled in
                automatically.
              </p>
              <form
                className="mt-4 flex flex-wrap gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!savingRoom) void createRoom()
                }}
              >
                <input
                  ref={roomNumberRef}
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  placeholder="Room number"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  autoFocus
                />
                <input
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  placeholder="Type (e.g. King)"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={savingRoom}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Add
                </button>
              </form>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Number</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rooms.map((room) => (
                    <tr key={room.id}>
                      <td className="px-4 py-3 font-medium">{room.number}</td>
                      <td className="px-4 py-3">{room.room_type}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => removeRoom(room)}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={finalizeConfirmOpen}
        onClose={() => {
          if (!finalizing) setFinalizeConfirmOpen(false)
        }}
        onConfirm={() => void finalizeCleaning()}
        title="Finalize cleaning board?"
        message={
          selectedHousekeeper
            ? `This saves ${selectedHousekeeper.name}'s board (${selectedHkRooms.length} room${selectedHkRooms.length === 1 ? '' : 's'}) to Past sheets permanently. Those rooms will be marked clean and removed from this housekeeper's assignments. You will not be able to change the saved sheet.`
            : 'This will save the board to Past sheets, mark rooms clean, and clear assignments.'
        }
        confirmLabel="Cleaning Done"
        cancelLabel="Cancel"
        variant="danger"
        loading={finalizing}
      />

      <Modal
        open={!!dialogRoom}
        onClose={() => setDialogRoomId(null)}
        title={dialogRoom ? `Room ${dialogRoom.number}` : 'Room'}
        description={
          dialogRoom
            ? `${dialogRoom.room_type} · ${roomBoardToneLabel(roomBoardTone(dialogRoom))}`
            : undefined
        }
        size="sm"
        hideClose
      >
        {dialogRoom && (
          <div className="space-y-3">
            <div
              className={`flex h-12 items-center justify-center rounded-md text-xl font-bold tabular-nums ${roomBoardToneClass(roomBoardTone(dialogRoom))}`}
            >
              {dialogRoom.number}
            </div>
            {statusEditor ? (
              <div className="overflow-hidden rounded-md border border-slate-200">
                {(
                  tab === 'board'
                    ? ([
                        {
                          label: 'Set Departing',
                          run: () =>
                            patchRoom(dialogRoom.id, { occupancy_status: 'departing' }),
                          disabled: dialogRoom.occupancy_status === 'departing',
                        },
                        {
                          label: 'Set Stayover',
                          run: () =>
                            patchRoom(dialogRoom.id, { occupancy_status: 'stayover' }),
                          disabled: dialogRoom.occupancy_status === 'stayover',
                        },
                      ] as const)
                    : ([
                        {
                          label: 'Set Departing',
                          run: () =>
                            patchRoom(dialogRoom.id, { occupancy_status: 'departing' }),
                          disabled: dialogRoom.occupancy_status === 'departing',
                        },
                        {
                          label: 'Set Stayover',
                          run: () =>
                            patchRoom(dialogRoom.id, { occupancy_status: 'stayover' }),
                          disabled: dialogRoom.occupancy_status === 'stayover',
                        },
                        {
                          label: 'Set Room Clean',
                          run: () =>
                            patchRoom(dialogRoom.id, { cleaning_status: 'clean' }),
                          disabled: dialogRoom.cleaning_status === 'clean',
                        },
                        {
                          label: 'Set Room Dirty',
                          run: () =>
                            patchRoom(dialogRoom.id, { cleaning_status: 'dirty' }),
                          disabled: dialogRoom.cleaning_status === 'dirty',
                        },
                      ] as const)
                ).map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    disabled={action.disabled || updatingId === dialogRoom.id}
                    onClick={() => void action.run()}
                    className="block w-full border-b border-slate-100 px-3 py-2.5 text-left text-sm text-slate-800 last:border-b-0 hover:bg-slate-50 disabled:cursor-default disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    {action.label}
                  </button>
                ))}
                {tab === 'assign' && dialogRoom.assigned_housekeeper_id && (
                  <button
                    type="button"
                    onClick={() => void unassignRoom(dialogRoom)}
                    className="block w-full border-t border-slate-200 px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    Unassign from housekeeper
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                {roomBoardToneLabel(roomBoardTone(dialogRoom))}
              </p>
            )}
            <button
              type="button"
              onClick={() => setDialogRoomId(null)}
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        )}
      </Modal>

      <Modal
        open={!!assignDialogHk}
        onClose={() => {
          if (!assigning) {
            setAssignDialogHkId(null)
            setPickRoomIds(new Set())
          }
        }}
        title={assignDialogHk ? `Assign to ${assignDialogHk.name}` : 'Assign rooms'}
        description="Tap rooms to select. Columns hold up to 20 rooms."
        size="2xl"
        footer={
          assignDialogHk ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-400">
                Selected rooms join this housekeeper’s column.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={assigning}
                  onClick={() => {
                    setAssignDialogHkId(null)
                    setPickRoomIds(new Set())
                  }}
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={assigning || pickRoomIds.size === 0}
                  onClick={() => void confirmAssignRooms()}
                  className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-40"
                >
                  {assigning
                    ? 'Assigning…'
                    : pickRoomIds.size > 0
                      ? `Assign ${pickRoomIds.size}`
                      : 'Assign'}
                </button>
              </div>
            </div>
          ) : undefined
        }
      >
        {assignDialogHk && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={selectDirty}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white hover:shadow-sm"
                >
                  Dirty
                </button>
                <button
                  type="button"
                  onClick={() => setPickRoomIds(new Set(unassignedRooms.map((r) => r.id)))}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white hover:shadow-sm"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setPickRoomIds(new Set())}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white hover:shadow-sm"
                >
                  Clear
                </button>
              </div>
              <p className="text-sm font-medium tabular-nums text-slate-600">
                <span className="text-slate-900">{pickRoomIds.size}</span>
                <span className="text-slate-400"> / {unassignedRooms.length}</span>
                <span className="ml-1 text-slate-400">selected</span>
              </p>
            </div>

            {unassignedRooms.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
                No unassigned rooms available.
              </div>
            ) : (
              <div className="max-h-[min(55vh,32rem)] overflow-auto pb-4">
                <div className="flex gap-3">
                  {chunkRooms(unassignedRooms, 20).map((columnRooms, idx) => (
                    <RoomColumnTable key={`pick-${idx}`}>
                      {columnRooms.map((room) => {
                        const tone = roomBoardTone(room)
                        const clean = room.cleaning_status === 'clean'
                        const selected = pickRoomIds.has(room.id)
                        return (
                          <tr
                            key={room.id}
                            className={`border-t border-slate-200 ${
                              selected ? 'bg-slate-900/[0.04]' : ''
                            }`}
                          >
                            <td className="p-0">
                              <button
                                type="button"
                                title={`${selected ? 'Deselect' : 'Select'} room ${room.number}`}
                                onClick={() => toggleSelect(room.id)}
                                className={`relative flex w-full items-center justify-center px-2 py-1.5 text-center text-sm font-bold tabular-nums leading-none ${roomBoardToneClass(tone)} hover:brightness-95 ${
                                  selected
                                    ? 'ring-2 ring-inset ring-slate-900'
                                    : ''
                                }`}
                              >
                                {room.number}
                              </button>
                            </td>
                            <td className="bg-transparent px-1 py-1.5 text-center">
                              <span
                                className={`text-sm font-bold ${
                                  clean ? 'text-emerald-600' : 'text-red-500'
                                }`}
                              >
                                ✓
                              </span>
                            </td>
                            <td
                              className="cursor-pointer truncate bg-transparent px-1.5 py-1.5 font-medium uppercase tracking-tight text-slate-700"
                              title={room.room_type}
                              onClick={() => toggleSelect(room.id)}
                            >
                              {roomTypeCode(room.room_type)}
                            </td>
                          </tr>
                        )
                      })}
                    </RoomColumnTable>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </Layout>
  )
}
