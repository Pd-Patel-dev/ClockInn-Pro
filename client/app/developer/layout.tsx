import Layout from '@/components/Layout'
import DeveloperShell from '@/components/DeveloperShell'
import DeveloperTabRedirect from './DeveloperTabRedirect'
import { Suspense } from 'react'

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  return (
    <Layout>
      <Suspense fallback={null}>
        <DeveloperTabRedirect />
      </Suspense>
      <DeveloperShell>{children}</DeveloperShell>
    </Layout>
  )
}
