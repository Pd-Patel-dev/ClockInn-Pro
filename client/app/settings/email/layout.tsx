import Layout from '@/components/Layout'
import DeveloperShell from '@/components/DeveloperShell'

export default function EmailSettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Layout>
      <DeveloperShell>{children}</DeveloperShell>
    </Layout>
  )
}
