"""enable_rls_on_shift_notes_tables

Enable RLS on shift_notes and shift_note_comments (created after 025).
Uses same permissive policies as 025 for authenticated/service_role.

Revision ID: 029_rls_shift_notes
Revises: 028_beverage_sold
Create Date: 2026-03-07

"""
from alembic import op

revision = "029_rls_shift_notes"
down_revision = "028_beverage_sold"
branch_labels = None
depends_on = None

TABLES = ["shift_notes", "shift_note_comments"]


def upgrade() -> None:
    for table in TABLES:
        op.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')
        op.execute(
            f'''CREATE POLICY "rls_authenticated_all" ON public."{table}"
            FOR ALL TO authenticated
            USING (true)
            WITH CHECK (true)'''
        )
        op.execute(
            f'''CREATE POLICY "rls_service_role_all" ON public."{table}"
            FOR ALL TO service_role
            USING (true)
            WITH CHECK (true)'''
        )


def downgrade() -> None:
    for table in reversed(TABLES):
        op.execute(f'DROP POLICY IF EXISTS "rls_service_role_all" ON public."{table}"')
        op.execute(f'DROP POLICY IF EXISTS "rls_authenticated_all" ON public."{table}"')
        op.execute(f'ALTER TABLE public."{table}" DISABLE ROW LEVEL SECURITY')
