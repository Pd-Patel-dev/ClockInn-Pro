'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { Camera, Trash2 } from 'lucide-react'
import type { User } from '@/lib/auth'
import { useProfile } from '@/components/profile/ProfileContext'
import { ProfileAvatar } from '@/components/profile/ProfileAvatar'
import { apiErrorMessage, formatMemberSince } from '@/components/profile/profileUtils'
import { roleBadgeLabel } from '@/components/profile/RoleBadge'
import { removeAvatar, uploadAvatar } from '@/components/profile/useProfileAvatar'
import { useAutosaveField } from '@/components/profile/useAutosaveField'
import { SaveIndicator } from '@/components/profile/SaveIndicator'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

export default function ProfileOverviewPage() {
  const { user, loading, patchUser } = useProfile()
  const toast = useToast()
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const onSaved = useCallback(
    (u: User) => {
      patchUser(u)
    },
    [patchUser]
  )

  const nameField = useAutosaveField('name', user?.name, onSaved)
  const preferredField = useAutosaveField('preferred_name', user?.preferred_name ?? '', onSaved)

  const handleNameBlur = async () => {
    if (!nameField.value.trim()) {
      nameField.setValue(user?.name ?? '')
      return
    }
    try {
      await nameField.save()
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save name'))
    }
  }

  const handlePreferredBlur = async () => {
    try {
      await preferredField.save()
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save preferred name'))
    }
  }

  const onPickFile = async (file: File | undefined) => {
    if (!file) return
    setAvatarBusy(true)
    try {
      const url = await uploadAvatar(file)
      patchUser({ avatar_url: url })
      toast.success('Photo updated')
      setAvatarOpen(false)
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Upload failed'))
    } finally {
      setAvatarBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onRemoveAvatar = async () => {
    setAvatarBusy(true)
    try {
      await removeAvatar()
      patchUser({ avatar_url: null })
      toast.success('Photo removed')
      setAvatarOpen(false)
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not remove photo'))
    } finally {
      setAvatarBusy(false)
    }
  }

  if (loading || !user) {
    return null
  }

  const isDeveloper = user.role === 'DEVELOPER'

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardBody className="space-y-6">
          <div className="flex flex-wrap items-center gap-4">
            <ProfileAvatar userId={user.id} name={user.name} avatarUrl={user.avatar_url} size="lg" />
            <Button type="button" variant="secondary" size="sm" leftIcon={<Camera className="h-4 w-4" />} onClick={() => setAvatarOpen(true)}>
              Change photo
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Full name" htmlFor="profile-name">
              <div className="flex items-center gap-2">
                <Input
                  id="profile-name"
                  value={nameField.value}
                  onChange={(e) => nameField.setValue(e.target.value)}
                  onBlur={() => void handleNameBlur()}
                />
                <SaveIndicator state={nameField.saveState} />
              </div>
            </FormField>
            <FormField label="Preferred name" htmlFor="profile-preferred">
              <div className="flex items-center gap-2">
                <Input
                  id="profile-preferred"
                  value={preferredField.value}
                  placeholder="Optional"
                  onChange={(e) => preferredField.setValue(e.target.value)}
                  onBlur={() => void handlePreferredBlur()}
                />
                <SaveIndicator state={preferredField.saveState} />
              </div>
            </FormField>
          </div>

          <FormField label="Email">
            <div className="flex flex-wrap items-center gap-2">
              <Input readOnly value={user.email} className="max-w-md bg-border-subtle/40" />
              <Link href="/profile/contact" className="text-sm text-accent hover:underline">
                Change email
              </Link>
            </div>
          </FormField>

          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-foreground-muted">Role</p>
              <div className="mt-1">{roleBadgeLabel(user)}</div>
            </div>
            <div>
              <p className="text-foreground-muted">Company</p>
              <p className="mt-1 text-foreground">{isDeveloper ? '—' : user.company_name || '—'}</p>
            </div>
            <div>
              <p className="text-foreground-muted">Member since</p>
              <p className="mt-1 text-foreground">{formatMemberSince(user.created_at)}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      <Modal
        open={avatarOpen}
        onClose={() => !avatarBusy && setAvatarOpen(false)}
        title="Profile photo"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            {user.avatar_url && (
              <Button type="button" variant="ghost" loading={avatarBusy} leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => void onRemoveAvatar()}>
                Remove
              </Button>
            )}
            <Button type="button" variant="secondary" disabled={avatarBusy} onClick={() => setAvatarOpen(false)}>
              Close
            </Button>
          </div>
        }
      >
        <p className="mb-4 text-sm text-foreground-muted">JPG, PNG, or WebP. Max 2 MB.</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="block w-full text-sm"
          disabled={avatarBusy}
          onChange={(e) => void onPickFile(e.target.files?.[0])}
        />
      </Modal>
    </>
  )
}
