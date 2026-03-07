"""enable_rls_on_public_tables

Enable Row Level Security (RLS) on all public tables exposed to PostgREST
to fix Supabase linter: rls_disabled_in_public (SECURITY).

Current policies are permissive (authenticated/service_role can access all rows).
Company isolation is enforced in the application layer: all queries are scoped by
company_id via services and current_user.company_id. If you later add RLS policies
that filter by company, the app uses a single DB user so policies would need to
use current_setting('app.current_company_id') or similar, set per-request by the
app — and must match application rules (e.g. users see only their company's data).

Revision ID: 025_enable_rls
Revises: 022_add_location
Create Date: 2026-02-19 12:00:00.000000

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "025_enable_rls"
down_revision = "024_drop_amount"
branch_labels = None
depends_on = None

# All public tables reported by Supabase linter (RLS disabled).
PUBLIC_TABLES = [
    "companies",
    "sessions",
    "leave_requests",
    "audit_logs",
    "payroll_runs",
    "payroll_line_items",
    "payroll_adjustments",
    "permissions",
    "role_permissions",
    "schedule_swaps",
    "shifts",
    "time_entries",
    "cash_drawer_sessions",
    "shift_templates",
    "cash_drawer_audit",
]


def upgrade() -> None:
    # Ensure Supabase-style roles exist (for local Docker Postgres; no-op on Supabase).
    op.execute(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            CREATE ROLE authenticated;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
            CREATE ROLE service_role;
          END IF;
        END
        $$;
        """
    )
    for table in PUBLIC_TABLES:
        # Enable RLS on the table.
        op.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')

        # Policy: allow all operations for authenticated role (Supabase).
        op.execute(
            f'''CREATE POLICY "rls_authenticated_all" ON public."{table}"
            FOR ALL TO authenticated
            USING (true)
            WITH CHECK (true)'''
        )
        # Policy: allow all operations for service_role (Supabase backend).
        op.execute(
            f'''CREATE POLICY "rls_service_role_all" ON public."{table}"
            FOR ALL TO service_role
            USING (true)
            WITH CHECK (true)''')


def downgrade() -> None:
    for table in reversed(PUBLIC_TABLES):
        op.execute(f'DROP POLICY IF EXISTS "rls_service_role_all" ON public."{table}"')
        op.execute(f'DROP POLICY IF EXISTS "rls_authenticated_all" ON public."{table}"')
        op.execute(f'ALTER TABLE public."{table}" DISABLE ROW LEVEL SECURITY')
