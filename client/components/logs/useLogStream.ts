'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from '@/lib/api'

export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'

export type LogLine = {
  timestamp: string
  level: string
  logger: string
  message: string
  raw: string
  seq?: number
}

export type ConnectionStatus = 'connecting' | 'live' | 'paused' | 'disconnected'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const MAX_LINES = 5000
const SHRINK_BY = 500
const PAUSE_BUFFER_MAX = 500

function lineKey(line: LogLine): string {
  return `${line.seq ?? ''}|${line.timestamp}|${line.raw}`
}

function levelsQuery(levels: Set<LogLevel>): string {
  if (levels.size === 0) return ''
  return Array.from(levels).join(',')
}

export function useLogStream(opts: {
  levels: Set<LogLevel>
  query: string
  paused: boolean
}) {
  const { levels, query, paused } = opts
  const [lines, setLines] = useState<LogLine[]>([])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [pendingCount, setPendingCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [reconnectTick, setReconnectTick] = useState(0)

  const pausedRef = useRef(paused)
  const pendingRef = useRef<LogLine[]>([])
  const seenRef = useRef<Set<string>>(new Set())
  const levelsRef = useRef(levels)
  const queryRef = useRef(query)
  const backoffRef = useRef(1000)

  useEffect(() => {
    levelsRef.current = levels
    queryRef.current = query
  }, [levels, query])

  useEffect(() => {
    pausedRef.current = paused
    if (!paused && pendingRef.current.length > 0) {
      const flush = pendingRef.current
      pendingRef.current = []
      setPendingCount(0)
      setLines((prev) => {
        const next = [...prev, ...flush]
        return next.length > MAX_LINES ? next.slice(SHRINK_BY) : next
      })
      setStatus('live')
    } else if (paused) {
      setStatus((s) => (s === 'disconnected' || s === 'connecting' ? s : 'paused'))
    }
  }, [paused])

  const appendLines = useCallback((incoming: LogLine[]) => {
    const fresh: LogLine[] = []
    for (const line of incoming) {
      const key = lineKey(line)
      if (seenRef.current.has(key)) continue
      seenRef.current.add(key)
      fresh.push(line)
    }
    if (fresh.length === 0) return

    if (pausedRef.current) {
      pendingRef.current = [...pendingRef.current, ...fresh].slice(-PAUSE_BUFFER_MAX)
      setPendingCount(pendingRef.current.length)
      return
    }

    setLines((prev) => {
      const next = [...prev, ...fresh]
      if (next.length > MAX_LINES) {
        const trimmed = next.slice(SHRINK_BY)
        seenRef.current = new Set(trimmed.map(lineKey))
        return trimmed
      }
      return next
    })
  }, [])

  const clear = useCallback(() => {
    setLines([])
    seenRef.current.clear()
    pendingRef.current = []
    setPendingCount(0)
  }, [])

  const reconnect = useCallback(() => {
    backoffRef.current = 1000
    setReconnectTick((n) => n + 1)
  }, [])

  const download = useCallback(async () => {
    const token = getAccessToken()
    if (!token) return
    const params = new URLSearchParams({ lines: '2000' })
    const lv = levelsQuery(levelsRef.current)
    if (lv) params.set('level', lv)
    if (queryRef.current.trim()) params.set('q', queryRef.current.trim())
    const res = await fetch(`${API_URL}/api/v1/developer/logs/download?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
    if (!res.ok) throw new Error('Download failed')
    const blob = await res.blob()
    const cd = res.headers.get('Content-Disposition') || ''
    const match = /filename="?([^"]+)"?/.exec(cd)
    const name = match?.[1] || `clockinn-logs-${Date.now()}.log`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  useEffect(() => {
    let cancelled = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    const ac = new AbortController()

    const fetchTail = async () => {
      const token = getAccessToken()
      if (!token) throw new Error('Not authenticated')
      const params = new URLSearchParams({ lines: '500' })
      const lv = levelsQuery(levelsRef.current)
      if (lv) params.set('level', lv)
      if (queryRef.current.trim()) params.set('q', queryRef.current.trim())
      const res = await fetch(`${API_URL}/api/v1/developer/logs/tail?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
        signal: ac.signal,
      })
      if (!res.ok) throw new Error(`Tail failed (${res.status})`)
      const data = await res.json()
      appendLines(Array.isArray(data?.lines) ? data.lines : [])
    }

    const connect = async () => {
      try {
        setStatus(pausedRef.current ? 'paused' : 'connecting')
        setError(null)
        seenRef.current.clear()
        setLines([])
        await fetchTail()
        if (cancelled || ac.signal.aborted) return

        const token = getAccessToken()
        if (!token) throw new Error('Not authenticated')

        const params = new URLSearchParams()
        const lv = levelsQuery(levelsRef.current)
        if (lv) params.set('level', lv)
        if (queryRef.current.trim()) params.set('q', queryRef.current.trim())

        const res = await fetch(`${API_URL}/api/v1/developer/logs/stream?${params}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
          },
          credentials: 'include',
          signal: ac.signal,
        })
        if (!res.ok || !res.body) throw new Error(`Stream failed (${res.status})`)

        if (!pausedRef.current) setStatus('live')
        backoffRef.current = 1000

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (!cancelled) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() || ''
          for (const chunk of parts) {
            for (const rawLine of chunk.split('\n')) {
              if (!rawLine.startsWith('data:')) continue
              const json = rawLine.slice(5).trim()
              if (!json) continue
              try {
                appendLines([JSON.parse(json) as LogLine])
              } catch {
                /* ignore */
              }
            }
          }
        }
        if (!cancelled && !ac.signal.aborted) throw new Error('Stream closed')
      } catch (e) {
        if (cancelled || (e as Error)?.name === 'AbortError') return
        setStatus('disconnected')
        setError((e as Error)?.message || 'Disconnected')
        const delay = backoffRef.current
        backoffRef.current = Math.min(delay * 2, 30000)
        reconnectTimer = setTimeout(() => {
          if (!cancelled) setReconnectTick((n) => n + 1)
        }, delay)
      }
    }

    const debounceMs = query.trim() ? 200 : 0
    const startTimer = setTimeout(() => {
      void connect()
    }, debounceMs)

    return () => {
      cancelled = true
      clearTimeout(startTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ac.abort()
    }
  }, [appendLines, levels, query, reconnectTick])

  return {
    lines,
    status,
    error,
    pendingCount,
    clear,
    download,
    reconnect,
  }
}
