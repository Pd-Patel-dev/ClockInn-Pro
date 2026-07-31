'use client'

import { useCallback, useEffect, useState } from 'react'
import api, { setTokens } from '@/lib/api'
import { useProfile } from '@/components/profile/ProfileContext'
import { apiErrorMessage } from '@/components/profile/profileUtils'
import { useToast } from '@/components/Toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

interface SessionRow {
  id: string
  device_label?: string | null
  ip_address?: string | null
  created_at: string
  last_used_at?: string | null
  is_current: boolean
}

function formatSessionTime(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso
  }
}

export default function ProfileSecurityPage() {
  const { user, loading, refresh } = useProfile()
  const toast = useToast()

  const [passwordOpen, setPasswordOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)

  const [pinOpen, setPinOpen] = useState(false)
  const [pinMode, setPinMode] = useState<'set' | 'change' | 'remove'>('set')
  const [pinPassword, setPinPassword] = useState('')
  const [newPin, setNewPin] = useState('')
  const [pinBusy, setPinBusy] = useState(false)

  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [revokePassword, setRevokePassword] = useState('')
  const [revokeBusy, setRevokeBusy] = useState(false)

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const res = await api.get<SessionRow[]>('/me/sessions')
      setSessions(res.data)
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not load sessions'))
    } finally {
      setSessionsLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (!loading && user) void loadSessions()
  }, [loading, user, loadSessions])

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    setPasswordBusy(true)
    try {
      const res = await api.post<{ message: string; access_token?: string }>('/me/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      })
      if (res.data.access_token) setTokens(res.data.access_token)
      toast.success(res.data.message || 'Password updated')
      setPasswordOpen(false)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      await loadSessions()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not change password'))
    } finally {
      setPasswordBusy(false)
    }
  }

  const openPin = (mode: 'set' | 'change' | 'remove') => {
    setPinMode(mode)
    setPinPassword('')
    setNewPin('')
    setPinOpen(true)
  }

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault()
    setPinBusy(true)
    try {
      if (pinMode === 'remove') {
        await api.delete('/me/pin', { data: { current_password: pinPassword } })
        toast.success('PIN removed')
      } else {
        await api.post('/me/change-pin', {
          current_password: pinPassword,
          new_pin: newPin,
        })
        toast.success('PIN updated')
      }
      setPinOpen(false)
      await refresh()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'PIN update failed'))
    } finally {
      setPinBusy(false)
    }
  }

  const revokeSession = async (id: string) => {
    try {
      await api.delete(`/me/sessions/${id}`)
      toast.success('Session signed out')
      await loadSessions()
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not sign out session'))
    }
  }

  const submitRevokeOthers = async (e: React.FormEvent) => {
    e.preventDefault()
    setRevokeBusy(true)
    try {
      const res = await api.post<{ revoked: number }>('/me/sessions/revoke-others', {
        password: revokePassword,
      })
      toast.success(`Signed out ${res.data.revoked} other session(s)`)
      setRevokeOpen(false)
      setRevokePassword('')
      await loadSessions()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not revoke sessions'))
    } finally {
      setRevokeBusy(false)
    }
  }

  if (loading || !user) return null

  const showPin = user.role !== 'DEVELOPER'

  return (
    <>
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle>Password</CardTitle>
            <Button type="button" variant="secondary" size="sm" onClick={() => setPasswordOpen(true)}>
              Change password
            </Button>
          </CardHeader>
        </Card>

        {showPin && (
          <Card>
            <CardHeader>
              <CardTitle>Kiosk PIN</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-wrap gap-2">
              {user.has_pin ? (
                <>
                  <Button type="button" variant="secondary" size="sm" onClick={() => openPin('change')}>
                    Change PIN
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => openPin('remove')}>
                    Remove PIN
                  </Button>
                </>
              ) : (
                <Button type="button" variant="secondary" size="sm" onClick={() => openPin('set')}>
                  Set PIN
                </Button>
              )}
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Active sessions</CardTitle>
            <Button type="button" variant="secondary" size="sm" onClick={() => setRevokeOpen(true)}>
              Sign out other devices
            </Button>
          </CardHeader>
          <CardBody className="divide-y divide-border p-0">
            {sessionsLoading ? (
              <p className="px-6 py-4 text-sm text-foreground-muted">Loading…</p>
            ) : sessions.length === 0 ? (
              <p className="px-6 py-4 text-sm text-foreground-muted">No active sessions.</p>
            ) : (
              sessions.map((s) => (
                <div key={s.id} className="flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {s.device_label || 'Unknown device'}
                      {s.is_current && (
                        <Badge variant="info" className="ml-2">
                          This device
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-foreground-muted">
                      {s.ip_address ? `${s.ip_address} · ` : ''}
                      Last active {formatSessionTime(s.last_used_at || s.created_at)}
                    </p>
                  </div>
                  {!s.is_current && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => void revokeSession(s.id)}>
                      Sign out
                    </Button>
                  )}
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <Modal
        open={passwordOpen}
        onClose={() => !passwordBusy && setPasswordOpen(false)}
        title="Change password"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={passwordBusy} onClick={() => setPasswordOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="change-password-form" loading={passwordBusy}>
              Update
            </Button>
          </div>
        }
      >
        <form id="change-password-form" className="space-y-4" onSubmit={(e) => void submitPassword(e)}>
          <FormField label="Current password" htmlFor="pw-current" required>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </FormField>
          <FormField label="New password" htmlFor="pw-new" required>
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </FormField>
          <FormField label="Confirm new password" htmlFor="pw-confirm" required>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={pinOpen}
        onClose={() => !pinBusy && setPinOpen(false)}
        title={pinMode === 'remove' ? 'Remove PIN' : pinMode === 'set' ? 'Set PIN' : 'Change PIN'}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={pinBusy} onClick={() => setPinOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="pin-form" loading={pinBusy} variant={pinMode === 'remove' ? 'danger' : 'primary'}>
              {pinMode === 'remove' ? 'Remove' : 'Save'}
            </Button>
          </div>
        }
      >
        <form id="pin-form" className="space-y-4" onSubmit={(e) => void submitPin(e)}>
          <FormField label="Current password" htmlFor="pin-password" required>
            <Input
              id="pin-password"
              type="password"
              autoComplete="current-password"
              required
              value={pinPassword}
              onChange={(e) => setPinPassword(e.target.value)}
            />
          </FormField>
          {pinMode !== 'remove' && (
            <FormField label="4-digit PIN" htmlFor="pin-new" required>
              <Input
                id="pin-new"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                required
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </FormField>
          )}
        </form>
      </Modal>

      <Modal
        open={revokeOpen}
        onClose={() => !revokeBusy && setRevokeOpen(false)}
        title="Sign out other devices"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={revokeBusy} onClick={() => setRevokeOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="revoke-others-form" loading={revokeBusy}>
              Confirm
            </Button>
          </div>
        }
      >
        <form id="revoke-others-form" className="space-y-4" onSubmit={(e) => void submitRevokeOthers(e)}>
          <p className="text-sm text-foreground-muted">Enter your password to sign out all sessions except this one.</p>
          <FormField label="Password" htmlFor="revoke-password" required>
            <Input
              id="revoke-password"
              type="password"
              autoComplete="current-password"
              required
              value={revokePassword}
              onChange={(e) => setRevokePassword(e.target.value)}
            />
          </FormField>
        </form>
      </Modal>
    </>
  )
}
