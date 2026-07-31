import { formatDistanceToNow } from 'date-fns'
import type { VariablesSchema } from './types'

const VAR_RE = /\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g

export const CATEGORY_LABELS: Record<string, string> = {
  TRANSACTIONAL: 'Transactional',
  NOTIFICATION: 'Notification',
  SUMMARY: 'Summary',
  MARKETING: 'Marketing',
}

export function sampleVariablesFromSchema(schema: VariablesSchema | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, meta] of Object.entries(schema || {})) {
    if (meta && typeof meta === 'object' && 'example' in meta && meta.example !== undefined) {
      out[name] = meta.example
    } else {
      out[name] = `[${name}]`
    }
  }
  return out
}

export function extractReferencedVariables(...sources: (string | null | undefined)[]): string[] {
  const names = new Set<string>()
  for (const source of sources) {
    if (!source) continue
    VAR_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = VAR_RE.exec(source)) !== null) {
      names.add(match[1])
    }
  }
  return Array.from(names).sort()
}

export function findUndefinedVariables(
  schema: VariablesSchema | null | undefined,
  ...sources: (string | null | undefined)[]
): string[] {
  const known = new Set(Object.keys(schema || {}))
  return extractReferencedVariables(...sources).filter((name) => !known.has(name))
}

/** Naive suggestion: shortest Levenshtein among schema keys, if close enough. */
export function suggestVariableName(typo: string, schemaKeys: string[]): string | null {
  if (!schemaKeys.length) return null
  let best: string | null = null
  let bestDist = Infinity
  for (const key of schemaKeys) {
    const d = levenshtein(typo, key)
    if (d < bestDist) {
      bestDist = d
      best = key
    }
  }
  if (best && bestDist <= Math.max(2, Math.floor(typo.length / 3))) return best
  return null
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return '—'
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return '—'
  }
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return '—'
  }
}

export function renderSubjectWithVars(subject: string | null | undefined): { parts: { text: string; isVar: boolean }[] } {
  if (!subject) return { parts: [{ text: '(no subject)', isVar: false }] }
  const parts: { text: string; isVar: boolean }[] = []
  let last = 0
  VAR_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = VAR_RE.exec(subject)) !== null) {
    if (match.index > last) {
      parts.push({ text: subject.slice(last, match.index), isVar: false })
    }
    parts.push({ text: match[0], isVar: true })
    last = match.index + match[0].length
  }
  if (last < subject.length) parts.push({ text: subject.slice(last), isVar: false })
  if (!parts.length) parts.push({ text: subject, isVar: false })
  return { parts }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
