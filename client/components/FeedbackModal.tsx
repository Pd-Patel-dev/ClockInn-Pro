'use client'

import React, { useState } from 'react'
import api from '@/lib/api'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import type { FeedbackKind } from '@/components/DeveloperChromeContext'

export interface FeedbackModalProps {
  open: boolean
  onClose: () => void
  kind: FeedbackKind
  initialMessage?: string
}

const TITLES: Record<FeedbackKind, string> = {
  support: 'Contact support',
  feedback: 'Send feedback',
  bug: 'Report a bug',
}

const DESCRIPTIONS: Record<FeedbackKind, string> = {
  support: 'Describe your issue. We’ll include your account and company details automatically.',
  feedback: 'Share details so we can improve ClockInn Pro.',
  bug: 'What happened? Include steps to reproduce if you can.',
}

const PLACEHOLDERS: Record<FeedbackKind, string> = {
  support: 'How can we help?',
  feedback: 'Tell us what you think…',
  bug: 'What happened? Steps to reproduce…',
}

export function FeedbackModal({ open, onClose, kind, initialMessage }: FeedbackModalProps) {
  const [message, setMessage] = useState(initialMessage ?? '')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setMessage(initialMessage ?? '')
      setSent(false)
      setError(null)
    }
  }, [open, initialMessage])

  const submit = async () => {
    if (!message.trim()) return
    setSending(true)
    setError(null)
    try {
      await api.post('/feedback', {
        message: message.trim(),
        type: kind,
        page_path: typeof window !== 'undefined' ? window.location.pathname : undefined,
      })
      setSent(true)
    } catch {
      setError('Could not send your message. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={TITLES[kind]}
      description={
        sent
          ? 'Thanks — your message was received. Our team can see it in the developer portal.'
          : DESCRIPTIONS[kind]
      }
      footer={
        sent ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={sending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={sending} disabled={!message.trim()}>
              Submit
            </Button>
          </>
        )
      }
    >
      {!sent && (
        <div className="space-y-3">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder={PLACEHOLDERS[kind]}
            aria-label="Message"
          />
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
