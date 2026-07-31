'use client'

import { ChevronDown, ChevronUp, Copy } from 'lucide-react'
import { Badge, Button, Checkbox, Input } from '@/components/ui'
import { copyText, suggestVariableName } from '@/lib/email-templates/utils'
import type { VariablesSchema } from '@/lib/email-templates/types'
import { useToast } from '@/components/Toast'
import { cn } from '@/lib/cn'

interface VariablesPanelProps {
  open: boolean
  onToggle: () => void
  schema: VariablesSchema
  previewData: Record<string, unknown>
  onPreviewDataChange: (next: Record<string, unknown>) => void
  onResetDefaults: () => void
  undefinedVars: string[]
}

export function VariablesPanel({
  open,
  onToggle,
  schema,
  previewData,
  onPreviewDataChange,
  onResetDefaults,
  undefinedVars,
}: VariablesPanelProps) {
  const toast = useToast()
  const entries = Object.entries(schema || {})
  const schemaKeys = Object.keys(schema || {})

  const setField = (name: string, value: unknown) => {
    onPreviewDataChange({ ...previewData, [name]: value })
  }

  const handleCopyVar = async (name: string) => {
    const ok = await copyText(`{{${name}}}`)
    if (ok) toast.success('Copied')
    else toast.error('Could not copy')
  }

  const handleCopyJson = async () => {
    const ok = await copyText(JSON.stringify(previewData, null, 2))
    if (ok) toast.success('Copied JSON')
    else toast.error('Could not copy')
  }

  return (
    <div className="shrink-0 border-t border-border bg-surface">
      {undefinedVars.length > 0 && (
        <div className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs text-amber-900 dark:text-amber-100">
          {undefinedVars.map((name) => {
            const suggestion = suggestVariableName(name, schemaKeys)
            return (
              <p key={name}>
                Template references <code className="font-mono">{`{{${name}}}`}</code> but it&apos;s not
                defined.
                {suggestion ? ` Did you mean \`${suggestion}\`?` : ''}
              </p>
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onToggle}
        className="flex h-9 w-full items-center justify-between px-4 text-sm font-medium text-foreground-muted hover:bg-border-subtle/50"
      >
        <span>Variables</span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>

      <div
        className={cn(
          'overflow-hidden transition-[height] duration-200',
          open ? 'h-[200px]' : 'h-0'
        )}
      >
        <div className="grid h-[200px] gap-4 overflow-hidden border-t border-border px-4 py-3 md:grid-cols-2">
          <div className="min-h-0 overflow-y-auto">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-foreground-subtle">
              Available variables
            </p>
            {entries.length === 0 && (
              <p className="text-xs text-foreground-muted">No variables defined for this template.</p>
            )}
            <ul className="space-y-2">
              {entries.map(([name, meta]) => (
                <li
                  key={name}
                  className="flex items-start justify-between gap-2 rounded-control border border-border-subtle px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <code className="font-mono text-xs text-foreground">{name}</code>
                      {meta?.type && <Badge variant="neutral">{meta.type}</Badge>}
                      {meta?.required && <Badge variant="warning">required</Badge>}
                    </div>
                    {meta?.example !== undefined && (
                      <p className="mt-0.5 truncate text-2xs text-foreground-subtle">
                        e.g. {String(meta.example)}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="rounded-control p-1 text-foreground-subtle hover:bg-border-subtle hover:text-foreground"
                    aria-label={`Copy {{${name}}}`}
                    onClick={() => handleCopyVar(name)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-2xs font-semibold uppercase tracking-wide text-foreground-subtle">
                Preview data
              </p>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={onResetDefaults}>
                  Reset to defaults
                </Button>
                <Button size="sm" variant="ghost" onClick={handleCopyJson}>
                  Copy as JSON
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {entries.map(([name, meta]) => {
                const type = (meta?.type || 'string').toLowerCase()
                const raw = previewData[name]
                if (type === 'boolean') {
                  return (
                    <Checkbox
                      key={name}
                      checked={Boolean(raw)}
                      onChange={(e) => setField(name, e.target.checked)}
                      label={name}
                    />
                  )
                }
                return (
                  <div key={name}>
                    <label className="mb-0.5 block font-mono text-2xs text-foreground-muted">{name}</label>
                    <Input
                      type={
                        type === 'number'
                          ? 'number'
                          : type === 'datetime' || type === 'date'
                            ? 'datetime-local'
                            : 'text'
                      }
                      className="h-8 text-xs"
                      value={raw == null ? '' : String(raw)}
                      onChange={(e) => {
                        const v = e.target.value
                        setField(name, type === 'number' ? (v === '' ? '' : Number(v)) : v)
                      }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
