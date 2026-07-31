'use client'

import Layout from '@/components/Layout'

export default function ApiKeysSettingsPage() {
  return (
    <Layout>
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">API keys</h1>
        <p className="mt-2 text-sm text-foreground-muted">Create and manage developer API credentials.</p>
        <div className="mt-8 rounded-card border border-border bg-surface p-6 shadow-subtle">
          <p className="text-sm text-foreground-muted">Coming soon — generate and revoke API keys.</p>
        </div>
      </div>
    </Layout>
  )
}
