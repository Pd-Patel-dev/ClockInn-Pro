-- Enable RLS on all public tables (fix Supabase linter: rls_disabled_in_public)
-- Tables: companies, sessions, leave_requests, audit_logs, payroll_*, permissions, role_permissions,
--        schedule_swaps, shifts, time_entries, cash_drawer_*, shift_templates

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_authenticated_all" ON public.companies FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.companies FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_authenticated_all" ON public.sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_authenticated_all" ON public.leave_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.leave_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_authenticated_all" ON public.audit_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_authenticated_all" ON public.payroll_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.payroll_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.payroll_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_authenticated_all" ON public.payroll_line_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.payroll_line_items FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.payroll_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_authenticated_all" ON public.payroll_adjustments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.payroll_adjustments FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_authenticated_all" ON public.permissions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.permissions FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_authenticated_all" ON public.role_permissions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.role_permissions FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.schedule_swaps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_authenticated_all" ON public.schedule_swaps FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.schedule_swaps FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_authenticated_all" ON public.shifts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.shifts FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_authenticated_all" ON public.time_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.time_entries FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.cash_drawer_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_authenticated_all" ON public.cash_drawer_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.cash_drawer_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.shift_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_authenticated_all" ON public.shift_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.shift_templates FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.cash_drawer_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_authenticated_all" ON public.cash_drawer_audit FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.cash_drawer_audit FOR ALL TO service_role USING (true) WITH CHECK (true);
