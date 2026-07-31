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

export function FeedbackModal({ open, onClose, kind, initialMessage }: FeedbackModalProps) {
  const [message, setMessage] = useState(initialMessage ?? '')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  React.useEffect(() => {
    if (open) {
      setMessage(initialMessage ?? '')
      setSent(false)
    }
  }, [open, initialMessage])

  const title = kind === 'bug' ? 'Report a bug' : 'Send feedback'

  const submit = async () => {
    if (!message.trim()) return
    setSending(true)
    try {
      await api.post('/feedback', { message: message.trim(), type: kind })
      setSent(true)
    } catch {
      setSent(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={sent ? 'Thanks — your message was received.' : 'Share details so we can improve ClockInn Pro.'}
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
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          placeholder={kind === 'bug' ? 'What happened? Steps to reproduce…' : 'Tell us what you think…'}
          aria-label="Message"
        />
      )}
    </Modal>
  )
}
