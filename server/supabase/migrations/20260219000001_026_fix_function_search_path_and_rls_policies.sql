-- Fix Supabase linter:
-- 1) Function Search Path Mutable: set search_path on trigger functions
-- 2) RLS Policy Always True: replace permissive FOR ALL with SELECT-only for authenticated

-- ---- 1. Set search_path on functions ----
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.update_cash_drawer_sessions_updated_at() SET search_path = public;

-- ---- 2. Replace rls_authenticated_all with SELECT-only (fixes permissive policy warning) ----
-- service_role keeps full access; authenticated gets read-only so linter is satisfied.

DROP POLICY IF EXISTS "rls_authenticated_all" ON public.companies;
CREATE POLICY "rls_authenticated_select" ON public.companies FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rls_authenticated_all" ON public.sessions;
CREATE POLICY "rls_authenticated_select" ON public.sessions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rls_authenticated_all" ON public.leave_requests;
CREATE POLICY "rls_authenticated_select" ON public.leave_requests FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rls_authenticated_all" ON public.audit_logs;
CREATE POLICY "rls_authenticated_select" ON public.audit_logs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rls_authenticated_all" ON public.payroll_runs;
CREATE POLICY "rls_authenticated_select" ON public.payroll_runs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rls_authenticated_all" ON public.payroll_line_items;
CREATE POLICY "rls_authenticated_select" ON public.payroll_line_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rls_authenticated_all" ON public.payroll_adjustments;
CREATE POLICY "rls_authenticated_select" ON public.payroll_adjustments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rls_authenticated_all" ON public.permissions;
CREATE POLICY "rls_authenticated_select" ON public.permissions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rls_authenticated_all" ON public.role_permissions;
CREATE POLICY "rls_authenticated_select" ON public.role_permissions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rls_authenticated_all" ON public.schedule_swaps;
CREATE POLICY "rls_authenticated_select" ON public.schedule_swaps FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rls_authenticated_all" ON public.shifts;
CREATE POLICY "rls_authenticated_select" ON public.shifts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rls_authenticated_all" ON public.time_entries;
CREATE POLICY "rls_authenticated_select" ON public.time_entries FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rls_authenticated_all" ON public.cash_drawer_sessions;
CREATE POLICY "rls_authenticated_select" ON public.cash_drawer_sessions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rls_authenticated_all" ON public.shift_templates;
CREATE POLICY "rls_authenticated_select" ON public.shift_templates FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rls_authenticated_all" ON public.cash_drawer_audit;
CREATE POLICY "rls_authenticated_select" ON public.cash_drawer_audit FOR SELECT TO authenticated USING (true);
