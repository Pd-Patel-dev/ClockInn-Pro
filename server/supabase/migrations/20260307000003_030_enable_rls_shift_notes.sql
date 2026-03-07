-- Migration: Enable RLS on shift_notes and shift_note_comments
-- Corresponds to Alembic 029_enable_rls_shift_notes (idempotent)

ALTER TABLE public.shift_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_authenticated_all" ON public.shift_notes;
DROP POLICY IF EXISTS "rls_service_role_all" ON public.shift_notes;
CREATE POLICY "rls_authenticated_all" ON public.shift_notes
FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.shift_notes
FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.shift_note_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_authenticated_all" ON public.shift_note_comments;
DROP POLICY IF EXISTS "rls_service_role_all" ON public.shift_note_comments;
CREATE POLICY "rls_authenticated_all" ON public.shift_note_comments
FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_service_role_all" ON public.shift_note_comments
FOR ALL TO service_role USING (true) WITH CHECK (true);
