'use client'

import { useCallback, useState } from 'react'
import api from '@/lib/api'
import type { User } from '@/lib/auth'
import { useProfile } from '@/components/profile/ProfileContext'
import { apiErrorMessage } from '@/components/profile/profileUtils'
import { useAutosaveField } from '@/components/profile/useAutosaveField'
import { SaveIndicator } from '@/components/profile/SaveIndicator'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

export default function ProfileContactPage() {
  const { user, loading, patchUser, refresh } = useProfile()
  const toast = useToast()
  const [emailOpen, setEmailOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)

  const onSaved = useCallback(
    (u: User) => {
      patchUser(u)
    },
    [patchUser]
  )

  const phoneField = useAutosaveField('phone', user?.phone ?? '', onSaved)

  const handlePhoneBlur = async () => {
    try {
      await phoneField.save()
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save phone'))
    }
  }

  const submitEmailChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailBusy(true)
    try {
      const res = await api.post<{ message: string }>('/me/change-email', {
        new_email: newEmail.trim(),
        current_password: emailPassword,
      })
      toast.success(res.data.message || 'Check your inbox to verify the new email.')
      setEmailOpen(false)
      setNewEmail('')
      setEmailPassword('')
      await refresh()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not change email'))
    } finally {
      setEmailBusy(false)
    }
  }

  if (loading || !user) return null

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Contact</CardTitle>
        </CardHeader>
        <CardBody className="space-y-6">
          <FormField label="Email">
            <div className="flex flex-wrap items-center gap-3">
              <Input readOnly value={user.email} className="max-w-md bg-border-subtle/40" />
              <Button type="button" variant="secondary" size="sm" onClick={() => setEmailOpen(true)}>
                Change email
              </Button>
            </div>
          </FormField>

          <FormField label="Phone" htmlFor="profile-phone">
            <div className="flex max-w-md items-center gap-2">
              <Input
                id="profile-phone"
                type="tel"
                value={phoneField.value}
                placeholder="Optional"
                onChange={(e) => phoneField.setValue(e.target.value)}
                onBlur={() => void handlePhoneBlur()}
              />
              <SaveIndicator state={phoneField.saveState} />
            </div>
          </FormField>
        </CardBody>
      </Card>

      <Modal
        open={emailOpen}
        onClose={() => !emailBusy && setEmailOpen(false)}
        title="Change email"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={emailBusy} onClick={() => setEmailOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="change-email-form" loading={emailBusy}>
              Send verification
            </Button>
          </div>
        }
      >
        <form id="change-email-form" className="space-y-4" onSubmit={(e) => void submitEmailChange(e)}>
          <FormField label="New email" htmlFor="new-email" required>
            <Input
              id="new-email"
              type="email"
              autoComplete="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </FormField>
          <FormField label="Current password" htmlFor="email-current-password" required>
            <Input
              id="email-current-password"
              type="password"
              autoComplete="current-password"
              required
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
            />
          </FormField>
        </form>
      </Modal>
    </>
  )
}
