'use client'

import Layout from '@/components/Layout'
import { ProfileShell } from '@/components/profile/ProfileShell'

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return (
    <Layout>
      <ProfileShell>{children}</ProfileShell>
    </Layout>
  )
}
