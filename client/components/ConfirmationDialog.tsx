'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface ConfirmationDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: 'confirm' | 'alert' | 'warning' | 'error'
  onConfirm: () => void
  onCancel?: () => void
  showCancel?: boolean
}

export default function ConfirmationDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'confirm',
  onConfirm,
  onCancel,
  showCancel = true,
}: ConfirmationDialogProps) {
  useEffect(() => {
    if (!isOpen) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onCancel) {
        onCancel()
      }
    }

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onCancel])

  if (!isOpen || typeof document === 'undefined') return null

  const confirmClass =
    type === 'warning'
      ? 'bg-amber-500 hover:bg-amber-600'
      : type === 'error'
        ? 'bg-red-500 hover:bg-red-600'
        : 'bg-slate-900 hover:bg-slate-800'

  const showIcon = type === 'warning' || type === 'error'

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[280px] rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        {showIcon && (
          <div className="mb-2.5 flex justify-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full ${
                type === 'warning' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-500'
              }`}
            >
              {type === 'warning' ? (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>
          </div>
        )}

        <h3
          id="confirm-dialog-title"
          className={`text-sm font-semibold text-slate-900 ${showIcon ? 'text-center' : ''}`}
        >
          {title}
        </h3>
        <p
          className={`mt-1 text-xs leading-relaxed text-slate-500 whitespace-pre-line ${
            showIcon ? 'text-center' : ''
          }`}
        >
          {message}
        </p>

        <div className={`mt-4 flex gap-2 ${showCancel ? '' : 'justify-end'}`}>
          {showCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium text-white transition-colors ${confirmClass}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
