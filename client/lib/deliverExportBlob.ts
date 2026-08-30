function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function titleFromFilename(filename: string) {
  return filename.replace(/\.[^.]+$/, '') || 'PDF'
}

function writePdfPreviewDocument(win: Window, blobUrl: string, title: string) {
  const safeTitle = escapeHtml(title)
  win.document.open()
  win.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: #0f172a; }
      iframe { border: 0; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <iframe src="${blobUrl}" title="${safeTitle}"></iframe>
  </body>
</html>`)
  win.document.close()
  try {
    win.document.title = title
  } catch {
    // Title already set in markup
  }
}

/**
 * Open a blank tab synchronously (must run in the click handler before any await).
 * After the PDF blob is ready, pass this window into deliverExportBlob.
 */
export function openPreviewTab(title = 'Preparing PDF…'): Window | null {
  const win = window.open('about:blank', '_blank')
  if (win) {
    try {
      win.document.write(
        `<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui;padding:24px;color:#334155">Preparing PDF…</body></html>`
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
 * Direct blob URLs show as "anonymous" in Chrome; wrap in HTML so the tab title is set.
 */
export function deliverExportBlob(
  data: BlobPart,
  filename: string,
  options?: {
    mimeType?: string
    previewInBrowser?: boolean
    previewWindow?: Window | null
    title?: string
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
  const tabTitle = options?.title?.trim() || titleFromFilename(filename)

  if (previewInBrowser) {
    const previewWindow = options?.previewWindow
    if (previewWindow && !previewWindow.closed) {
      try {
        writePdfPreviewDocument(previewWindow, url, tabTitle)
        previewWindow.focus()
      } catch {
        try {
          previewWindow.location.href = url
        } catch {
          previewWindow.location.replace(url)
        }
      }
      window.setTimeout(() => window.URL.revokeObjectURL(url), 120_000)
      return { mode: 'preview' as const }
    }

    // Fallback if no pre-opened tab (may still be blocked after async work)
    const opened = window.open('about:blank', '_blank')
    if (opened) {
      try {
        writePdfPreviewDocument(opened, url, tabTitle)
      } catch {
        opened.location.href = url
      }
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
