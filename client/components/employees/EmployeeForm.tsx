'use client'

import { ReactNode } from 'react'
import { FieldErrors, UseFormRegister } from 'react-hook-form'
import { z } from 'zod'
import { FormField, Input, Select } from '@/components/FormField'
import { ButtonSpinner } from '@/components/LoadingSpinner'

export const EMPLOYEE_ROLE_OPTIONS = [
  { value: 'FRONTDESK', label: 'Front Desk' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'HOUSEKEEPING', label: 'Housekeeping' },
  { value: 'RESTAURANT', label: 'Restaurant' },
  { value: 'SECURITY', label: 'Security' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ADMIN', label: 'Administrator' },
] as const

const roleEnum = z.enum([
  'MAINTENANCE',
  'FRONTDESK',
  'HOUSEKEEPING',
  'RESTAURANT',
  'SECURITY',
  'MANAGER',
  'ADMIN',
])

const optionalPin = z
  .string()
  .optional()
  .refine((val) => !val || val.length === 0 || /^\d{4}$/.test(val), {
    message: 'PIN must be 4 digits',
  })

const optionalPayRate = z
  .string()
  .optional()
  .or(z.literal(''))
  .refine(
    (val) => {
      if (!val || val === '') return true
      const num = parseFloat(val)
      return !isNaN(num) && num >= 0
    },
    { message: 'Pay rate must be a valid non-negative number' }
  )

export const createEmployeeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  preferred_name: z.string().max(100).optional().or(z.literal('')),
  email: z.string().email('Invalid email address'),
  phone: z.string().max(30).optional().or(z.literal('')),
  role: roleEnum.default('FRONTDESK'),
  pin: optionalPin,
  job_role: z.string().max(255).optional().or(z.literal('')),
  pay_rate: optionalPayRate,
})

export const editEmployeeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  preferred_name: z.string().max(100).optional().or(z.literal('')),
  phone: z.string().max(30).optional().or(z.literal('')),
  status: z.enum(['active', 'inactive']),
  role: roleEnum.optional(),
  pin: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((val) => !val || val === '' || /^\d{4}$/.test(val), {
      message: 'PIN must be 4 digits',
    }),
  job_role: z.string().max(255).optional().or(z.literal('')),
  pay_rate: z.string().optional(),
})

export type CreateEmployeeFormValues = z.infer<typeof createEmployeeSchema>
export type EditEmployeeFormValues = z.infer<typeof editEmployeeSchema>

type FormValues = CreateEmployeeFormValues | EditEmployeeFormValues

interface EmployeeFormProps {
  mode: 'create' | 'edit'
  register: UseFormRegister<any>
  errors: FieldErrors<FormValues>
  emailReadOnly?: string
  hasPin?: boolean
  submitting?: boolean
  onCancel?: () => void
  submitLabel?: string
  cancelLabel?: string
  showActions?: boolean
}

function Section({
  title,
  description,
  step,
  children,
}: {
  title: string
  description?: string
  step?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-sm">
      <div className="mb-5 flex items-start gap-3">
        {step ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-[11px] font-semibold tabular-nums text-white">
            {step}
          </span>
        ) : (
          <div className="mt-0.5 h-8 w-1 rounded-full bg-slate-900 shrink-0" aria-hidden />
        )}
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">{children}</div>
    </section>
  )
}

export default function EmployeeForm({
  mode,
  register,
  errors,
  emailReadOnly,
  hasPin,
  submitting = false,
  onCancel,
  submitLabel,
  cancelLabel = 'Cancel',
  showActions = true,
}: EmployeeFormProps) {
  const isCreate = mode === 'create'
  const createErrors = errors as FieldErrors<CreateEmployeeFormValues>
  const editErrors = errors as FieldErrors<EditEmployeeFormValues>

  return (
    <div className="space-y-5">
      <Section
        step={isCreate ? '01' : undefined}
        title="Identity"
        description="Legal name and how they appear to the team."
      >
        <FormField
          label="Full name"
          required
          error={isCreate ? createErrors.name?.message : editErrors.name?.message}
        >
          <Input {...register('name')} error={!!(isCreate ? createErrors.name : editErrors.name)} />
        </FormField>

        <FormField
          label="Preferred name"
          hint="Optional display name"
          error={
            isCreate ? createErrors.preferred_name?.message : editErrors.preferred_name?.message
          }
        >
          <Input
            {...register('preferred_name')}
            error={!!(isCreate ? createErrors.preferred_name : editErrors.preferred_name)}
            placeholder="Optional"
          />
        </FormField>

        <FormField
          label="Email"
          required={isCreate}
          hint={isCreate ? 'Must be unique' : 'Email cannot be changed'}
          error={isCreate ? createErrors.email?.message : undefined}
          className="sm:col-span-2"
        >
          {isCreate ? (
            <Input {...register('email')} type="email" error={!!createErrors.email} />
          ) : (
            <Input
              type="email"
              value={emailReadOnly || ''}
              disabled
              className="bg-slate-50 text-slate-500 cursor-not-allowed"
            />
          )}
        </FormField>

        <FormField
          label="Phone"
          error={isCreate ? createErrors.phone?.message : editErrors.phone?.message}
        >
          <Input
            {...register('phone')}
            type="tel"
            error={!!(isCreate ? createErrors.phone : editErrors.phone)}
            placeholder="Optional"
          />
        </FormField>
      </Section>

      <Section
        step={isCreate ? '02' : undefined}
        title="Role & access"
        description="What they can do in ClockInn and at the kiosk."
      >
        <FormField
          label="Role"
          required={isCreate}
          error={isCreate ? createErrors.role?.message : editErrors.role?.message}
        >
          <Select {...register('role')} error={!!(isCreate ? createErrors.role : editErrors.role)}>
            {EMPLOYEE_ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </FormField>

        {!isCreate && (
          <FormField label="Status" required error={editErrors.status?.message}>
            <Select {...register('status')} error={!!editErrors.status}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </FormField>
        )}

        <FormField
          label="PIN"
          hint={
            isCreate
              ? '4-digit PIN for kiosk access (optional)'
              : hasPin
                ? 'Leave empty to keep current PIN, or enter a new 4-digit PIN'
                : 'Enter a 4-digit PIN or leave empty'
          }
          error={isCreate ? createErrors.pin?.message : editErrors.pin?.message}
        >
          <Input
            {...register('pin')}
            type="text"
            inputMode="numeric"
            maxLength={4}
            error={!!(isCreate ? createErrors.pin : editErrors.pin)}
            placeholder={isCreate ? 'Optional' : '••••'}
          />
        </FormField>
      </Section>

      <Section
        step={isCreate ? '03' : undefined}
        title="Job & pay"
        description={isCreate ? 'Optional employment details.' : undefined}
      >
        <FormField
          label="Job title"
          error={isCreate ? createErrors.job_role?.message : editErrors.job_role?.message}
        >
          <Input
            {...register('job_role')}
            error={!!(isCreate ? createErrors.job_role : editErrors.job_role)}
            placeholder="e.g. Front desk lead"
          />
        </FormField>

        <FormField
          label="Hourly pay rate"
          hint="Dollars per hour (optional)"
          error={isCreate ? createErrors.pay_rate?.message : editErrors.pay_rate?.message}
        >
          <Input
            {...register('pay_rate')}
            type="number"
            step="0.01"
            min="0"
            error={!!(isCreate ? createErrors.pay_rate : editErrors.pay_rate)}
            placeholder="0.00"
          />
        </FormField>
      </Section>

      {isCreate && (
        <div className="rounded-2xl border border-slate-800/10 bg-slate-900 px-5 py-4 text-sm text-slate-200 shadow-sm relative overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'radial-gradient(circle at 90% 0%, rgba(45,212,191,0.25), transparent 45%)',
            }}
          />
          <div className="relative flex gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[11px] font-semibold tabular-nums text-teal-200">
              04
            </span>
            <div>
              <p className="font-semibold text-white">Password invite</p>
              <p className="mt-1 text-slate-300 leading-relaxed">
                After you create this employee, they receive an email with a link to set their
                password. No temporary password is shown here.
              </p>
            </div>
          </div>
        </div>
      )}

      {showActions && (
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-1 sticky bottom-3 z-10">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="px-4 py-2.5 bg-white/95 backdrop-blur border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-xl transition-colors disabled:opacity-50 shadow-sm"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20"
          >
            {submitting && <ButtonSpinner />}
            {submitting
              ? isCreate
                ? 'Creating…'
                : 'Saving…'
              : submitLabel || (isCreate ? 'Create employee' : 'Save changes')}
          </button>
        </div>
      )}
    </div>
  )
}

/** Build API payload from create form values. */
export function toCreatePayload(data: CreateEmployeeFormValues) {
  const payload: Record<string, unknown> = {
    name: data.name.trim(),
    email: data.email.trim(),
    role: data.role,
    pin: data.pin || undefined,
    preferred_name: data.preferred_name?.trim() || undefined,
    phone: data.phone?.trim() || undefined,
    job_role: data.job_role?.trim() || undefined,
  }
  if (data.pay_rate !== undefined && data.pay_rate !== '') {
    const num = parseFloat(data.pay_rate)
    if (!isNaN(num)) payload.pay_rate = num
  }
  return payload
}

/** Build API payload from edit form values. */
export function toUpdatePayload(data: EditEmployeeFormValues) {
  const payload: Record<string, unknown> = {
    name: data.name.trim(),
    status: data.status,
    role: data.role,
    preferred_name: data.preferred_name?.trim() ?? '',
    phone: data.phone?.trim() ?? '',
    job_role: data.job_role?.trim() ?? '',
  }
  if (data.pin !== undefined && data.pin !== '') {
    payload.pin = data.pin
  }
  if (data.pay_rate !== undefined && data.pay_rate !== '') {
    const num = parseFloat(data.pay_rate)
    if (!isNaN(num)) payload.pay_rate = num
  }
  return payload
}
