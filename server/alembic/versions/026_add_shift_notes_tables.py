"""add_shift_notes_tables

Revision ID: 026_shift_notes
Revises: 025_enable_rls
Create Date: 2026-02-19

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ENUM

revision = "026_shift_notes"
down_revision = "025_enable_rls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create enum for shift note status (idempotent for partial runs).
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE shiftnotestatus AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
        """
    )
    shift_note_status = ENUM("DRAFT", "SUBMITTED", "REVIEWED", name="shiftnotestatus", create_type=False)

    op.create_table(
        "shift_notes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("time_entry_id", UUID(as_uuid=True), sa.ForeignKey("time_entries.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", shift_note_status, nullable=False, server_default=sa.text("'DRAFT'")),
        sa.Column("last_edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_edited_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_shift_notes_company_id", "shift_notes", ["company_id"])
    op.create_index("ix_shift_notes_time_entry_id", "shift_notes", ["time_entry_id"], unique=True)
    op.create_index("ix_shift_notes_employee_id", "shift_notes", ["employee_id"])
    op.create_index("idx_shift_notes_company_updated", "shift_notes", ["company_id", "updated_at"])
    op.create_index("idx_shift_notes_company_employee_updated", "shift_notes", ["company_id", "employee_id", "updated_at"])
    op.create_index("idx_shift_notes_company_time_entry", "shift_notes", ["company_id", "time_entry_id"])

    op.create_table(
        "shift_note_comments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shift_note_id", UUID(as_uuid=True), sa.ForeignKey("shift_notes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_shift_note_comments_company_id", "shift_note_comments", ["company_id"])
    op.create_index("ix_shift_note_comments_shift_note_id", "shift_note_comments", ["shift_note_id"])
    op.create_index("ix_shift_note_comments_actor_user_id", "shift_note_comments", ["actor_user_id"])


def downgrade() -> None:
    op.drop_table("shift_note_comments")
    op.drop_table("shift_notes")
    sa.Enum(name="shiftnotestatus").drop(op.get_bind(), checkfirst=True)
