/**
 * Open a blank tab synchronously (must run in the click handler before any await).
 * After the PDF blob is ready, pass this window into deliverExportBlob.
 */
export function openPreviewTab(): Window | null {
  const win = window.open('about:blank', '_blank')
  if (win) {
    try {
      win.document.write(
        '<!doctype html><title>Preparing PDF…</title><body style="font-family:system-ui;padding:24px;color:#334155">Preparing PDF…</body>'
      )
      win.document.close()
    } catch {
      // Cross-origin / opaque — still usable via location assignment
    }
  }
  return win
}

/**
 * Open a PDF in a new tab for preview, or force-download other file types.
 * For PDFs: pass `previewWindow` from openPreviewTab() called before await.
 */
export function deliverExportBlob(
  data: BlobPart,
  filename: string,
  options?: {
    mimeType?: string
    previewInBrowser?: boolean
    previewWindow?: Window | null
  }
) {
  const previewInBrowser = options?.previewInBrowser ?? false
  const mimeType =
    options?.mimeType ||
    (previewInBrowser ? 'application/pdf' : 'application/octet-stream')

  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType })
  const typedBlob =
    previewInBrowser && blob.type !== 'application/pdf'
      ? new Blob([blob], { type: 'application/pdf' })
      : blob

  const url = window.URL.createObjectURL(typedBlob)

  if (previewInBrowser) {
    const previewWindow = options?.previewWindow
    if (previewWindow && !previewWindow.closed) {
      try {
        previewWindow.location.href = url
        previewWindow.focus()
      } catch {
        previewWindow.location.replace(url)
      }
      window.setTimeout(() => window.URL.revokeObjectURL(url), 120_000)
      return { mode: 'preview' as const }
    }

    // Fallback if no pre-opened tab (may still be blocked after async work)
    const opened = window.open(url, '_blank')
    if (opened) {
      window.setTimeout(() => window.URL.revokeObjectURL(url), 120_000)
      return { mode: 'preview' as const }
    }

    // Last resort: navigate current tab (better than silent download)
    const link = document.createElement('a')
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => window.URL.revokeObjectURL(url), 120_000)
    return { mode: 'preview' as const }
  }

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
  return { mode: 'download' as const }
}
