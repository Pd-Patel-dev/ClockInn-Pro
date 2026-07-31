import {
  BarChart3,
  CalendarDays,
  Clock,
  KeyRound,
  Mail,
  Sparkles,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

/** Quiet icons for template cards — keyed by template machine key. */
export const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  // Auth / verification
  verify_email: KeyRound,
  email_verification: KeyRound,
  verification_reminder: KeyRound,
  password_setup: KeyRound,
  password_setup_invite: KeyRound,
  password_reset: KeyRound,
  password_reset_otp: KeyRound,
  // Leave
  leave_request_notification: CalendarDays,
  leave_request_admin: CalendarDays,
  leave_request_response: CalendarDays,
  // Onboarding
  welcome: Sparkles,
  invitation: Sparkles,
  // Schedule
  shift_assigned: Clock,
  shift_changed: Clock,
  shift_reminder: Clock,
  // Payroll
  payroll_ready: Wallet,
  paystub: Wallet,
  // Reports
  weekly_summary: BarChart3,
  report: BarChart3,
}

export function getTemplateIcon(key: string): LucideIcon {
  return TEMPLATE_ICONS[key] ?? Mail
}
