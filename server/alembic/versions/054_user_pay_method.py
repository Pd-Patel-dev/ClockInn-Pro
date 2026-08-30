"""054: employee pay_method (hourly / per room)."""
from alembic import op


revision = "054_user_pay_method"
down_revision = "053_room_departing_stayover"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE paymethod AS ENUM ('HOURLY', 'PER_ROOM');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
        """
    )
    op.execute(
        """
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS pay_method paymethod NOT NULL DEFAULT 'HOURLY'
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS pay_method")
    op.execute("DROP TYPE IF EXISTS paymethod")
