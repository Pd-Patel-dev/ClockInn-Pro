'use client'

import { ConfirmModal } from '@/components/ui'

interface ResetFactoryModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  loading?: boolean
  templateName?: string
}

export function ResetFactoryModal({
  open,
  onClose,
  onConfirm,
  loading,
  templateName,
}: ResetFactoryModalProps) {
  return (
    <ConfirmModal
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      loading={loading}
      title={templateName ? `Reset “${templateName}” to factory?` : 'Reset to factory defaults?'}
      message="This will create a new draft from the factory default. Your current draft (if any) will be discarded. The currently published version remains unchanged until you publish the new draft."
      confirmLabel="Reset draft to factory"
      variant="danger"
    />
  )
}
