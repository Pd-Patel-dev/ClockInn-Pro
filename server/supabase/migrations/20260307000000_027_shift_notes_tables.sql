-- Migration: Add shift_notes and shift_note_comments tables
-- Corresponds to Alembic 026_add_shift_notes_tables

DO $$ BEGIN
    CREATE TYPE shiftnotestatus AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS shift_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    time_entry_id UUID NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    status shiftnotestatus NOT NULL DEFAULT 'DRAFT',
    last_edited_at TIMESTAMPTZ,
    last_edited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_shift_notes_time_entry_id ON shift_notes(time_entry_id);
CREATE INDEX IF NOT EXISTS ix_shift_notes_company_id ON shift_notes(company_id);
CREATE INDEX IF NOT EXISTS ix_shift_notes_employee_id ON shift_notes(employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_notes_company_updated ON shift_notes(company_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_shift_notes_company_employee_updated ON shift_notes(company_id, employee_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_shift_notes_company_time_entry ON shift_notes(company_id, time_entry_id);

CREATE TABLE IF NOT EXISTS shift_note_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    shift_note_id UUID NOT NULL REFERENCES shift_notes(id) ON DELETE CASCADE,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_shift_note_comments_company_id ON shift_note_comments(company_id);
CREATE INDEX IF NOT EXISTS ix_shift_note_comments_shift_note_id ON shift_note_comments(shift_note_id);
CREATE INDEX IF NOT EXISTS ix_shift_note_comments_actor_user_id ON shift_note_comments(actor_user_id);
