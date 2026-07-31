'use client'

import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { WrapText } from 'lucide-react'
import { useTheme } from '@/components/ui'
import { Button, Tabs } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { EditorBodyTab, VariablesSchema } from '@/lib/email-templates/types'

interface MonacoTemplateEditorProps {
  bodyTab: EditorBodyTab
  onBodyTabChange: (tab: EditorBodyTab) => void
  html: string
  text: string
  onHtmlChange: (value: string) => void
  onTextChange: (value: string) => void
  wordWrap: boolean
  onWordWrapChange: (wrap: boolean) => void
  readOnly?: boolean
  variablesSchema?: VariablesSchema
  className?: string
  dirtyHtml?: boolean
  dirtyText?: boolean
  onBlurSave?: () => void
}

export function MonacoTemplateEditor({
  bodyTab,
  onBodyTabChange,
  html,
  text,
  onHtmlChange,
  onTextChange,
  wordWrap,
  onWordWrapChange,
  readOnly,
  variablesSchema,
  className,
  dirtyHtml,
  dirtyText,
  onBlurSave,
}: MonacoTemplateEditorProps) {
  const { resolvedTheme } = useTheme()
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null)
  const providerRef = useRef<{ dispose: () => void } | null>(null)
  const onBlurSaveRef = useRef(onBlurSave)
  onBlurSaveRef.current = onBlurSave

  const value = bodyTab === 'html' ? html : text
  const language = bodyTab === 'html' ? 'html' : 'plaintext'

  useEffect(() => {
    return () => {
      providerRef.current?.dispose()
    }
  }, [])

  const handleMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco
    providerRef.current?.dispose()

    const schema = variablesSchema || {}
    const keys = Object.keys(schema)

    providerRef.current = monaco.languages.registerCompletionItemProvider(['html', 'plaintext'], {
      triggerCharacters: ['{'],
      provideCompletionItems: (model: { getValueInRange: (r: object) => string; getWordUntilPosition: (p: object) => { startColumn: number; endColumn: number } }, position: { lineNumber: number; column: number }) => {
        const textUntil = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: Math.max(1, position.column - 2),
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        })
        if (!textUntil.endsWith('{{') && !textUntil.endsWith('{')) {
          return { suggestions: [] }
        }
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }
        return {
          suggestions: keys.map((name) => {
            const meta = schema[name]
            const example =
              meta && typeof meta === 'object' && 'example' in meta
                ? String(meta.example ?? '')
                : ''
            const type = meta?.type || 'string'
            return {
              label: name,
              kind: monaco.languages.CompletionItemKind.Variable,
              insertText: textUntil.endsWith('{{') ? `${name}}}` : `{${name}}}`,
              detail: type,
              documentation: example ? `Example: ${example}` : undefined,
              range,
            }
          }),
        }
      },
    })

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, () => {
      editor.trigger('keyboard', 'editor.action.triggerSuggest', {})
    })

    editor.onDidBlurEditorWidget(() => {
      onBlurSaveRef.current?.()
    })
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col border-r border-border', className)}>
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <Tabs
          variant="pills"
          tabs={[
            {
              id: 'html',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  HTML
                  {dirtyHtml && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />}
                </span>
              ),
            },
            {
              id: 'text',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  Plain text
                  {dirtyText && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />}
                </span>
              ),
            },
          ]}
          value={bodyTab}
          onChange={(id) => onBodyTabChange(id as EditorBodyTab)}
        />
        <Button
          size="sm"
          variant={wordWrap ? 'secondary' : 'ghost'}
          leftIcon={<WrapText className="h-3.5 w-3.5" />}
          onClick={() => onWordWrapChange(!wordWrap)}
          aria-pressed={wordWrap}
        >
          Wrap
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          language={language}
          theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
          value={value}
          onChange={(v) => {
            if (readOnly) return
            if (bodyTab === 'html') onHtmlChange(v ?? '')
            else onTextChange(v ?? '')
          }}
          onMount={handleMount}
          options={{
            readOnly: !!readOnly,
            wordWrap: wordWrap ? 'on' : 'off',
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            padding: { top: 8 },
          }}
        />
      </div>
    </div>
  )
}
