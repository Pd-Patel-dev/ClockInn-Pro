'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { DeveloperAuthLoading } from '@/components/developer/useDeveloperAuth'

/** Legacy route — System Health now lives at /developer (Overview). */
export default function DeveloperSystemRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/developer')
  }, [router])

  return <DeveloperAuthLoading />
}
