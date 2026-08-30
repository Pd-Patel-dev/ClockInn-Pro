"""056: housekeeping sheet kind (assignment vs finalize/cleaned)."""
from alembic import op


revision = "056_housekeeping_sheet_kind"
down_revision = "055_support_tickets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE housekeeping_sheets
        ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'assignment'
        """
    )
    op.execute(
        """
        UPDATE housekeeping_sheets
        SET kind = 'finalize'
        WHERE notes ILIKE '%finalized board%'
           OR notes ILIKE '%cleaning done%'
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE housekeeping_sheets DROP COLUMN IF EXISTS kind")
