'use client'

import { useEffect } from 'react'

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

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onCancel])

  if (!isOpen) return null

  const getTypeStyles = () => {
    switch (type) {
      case 'warning':
        return {
          iconBg: 'bg-amber-50',
          iconColor: 'text-amber-600',
          confirmBg: 'bg-amber-500 hover:bg-amber-600',
        }
      case 'error':
        return {
          iconBg: 'bg-red-50',
          iconColor: 'text-red-500',
          confirmBg: 'bg-red-500 hover:bg-red-600',
        }
      case 'alert':
        return {
          iconBg: 'bg-blue-50',
          iconColor: 'text-blue-600',
          confirmBg: 'bg-blue-600 hover:bg-blue-700',
        }
      default:
        return {
          iconBg: 'bg-blue-50',
          iconColor: 'text-blue-600',
          confirmBg: 'bg-blue-600 hover:bg-blue-700',
        }
    }
  }

  const styles = getTypeStyles()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      role="presentation"
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl p-6"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex justify-center mb-4">
          <div className={`flex items-center justify-center h-10 w-10 rounded-full ${styles.iconBg}`}>
            {type === 'warning' && (
              <svg className={`h-6 w-6 ${styles.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            )}
            {type === 'error' && (
              <svg className={`h-6 w-6 ${styles.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            {(type === 'confirm' || type === 'alert') && (
              <svg className={`h-6 w-6 ${styles.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
        </div>

        <h3 className="text-lg font-semibold text-slate-900 mb-2 text-center">{title}</h3>
        <p className="text-sm text-slate-600 mb-6 text-center whitespace-pre-line leading-relaxed">{message}</p>

        <div className={`flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 ${showCancel ? 'sm:justify-end' : 'sm:justify-center'}`}>
          {showCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="w-full sm:w-auto px-4 py-2 rounded-lg text-sm font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className={`w-full sm:w-auto px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${styles.confirmBg}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
