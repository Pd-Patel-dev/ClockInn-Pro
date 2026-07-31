'use client'

import { DeveloperAuthLoading, useDeveloperAuth } from '@/components/developer/useDeveloperAuth'
import { LogsConsole } from '@/components/logs/LogsConsole'

export default function DeveloperLogsPage() {
  const { loading } = useDeveloperAuth()
  if (loading) return <DeveloperAuthLoading />
  return <LogsConsole />
}
