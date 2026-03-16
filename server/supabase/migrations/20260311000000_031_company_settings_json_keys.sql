-- Migration: Document company settings_json keys used by the app
-- No schema change: all new features use existing companies.settings_json JSONB column.
-- This migration adds a comment for documentation and migration history.

COMMENT ON COLUMN public.companies.settings_json IS 'JSONB company settings. Keys used by app: timezone, payroll_week_start_day, biweekly_anchor_date, overtime_enabled, overtime_threshold_hours_per_week, overtime_multiplier_default, rounding_policy, breaks_paid, cash_drawer_*, schedule_day_start_hour, schedule_day_end_hour, shift_notes_*, email_verification_required, geofence_enabled, office_latitude, office_longitude, geofence_radius_meters, kiosk_network_restriction_enabled, kiosk_allowed_ips.';
