"""055: support_tickets for contact support / feedback / bug reports."""
from alembic import op


revision = "055_support_tickets"
down_revision = "054_user_pay_method"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS support_tickets (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
            type VARCHAR(32) NOT NULL DEFAULT 'support',
            status VARCHAR(20) NOT NULL DEFAULT 'open',
            message TEXT NOT NULL,
            user_name VARCHAR(255) NOT NULL,
            user_email VARCHAR(255) NOT NULL,
            user_role VARCHAR(64),
            company_name VARCHAR(255),
            page_path VARCHAR(500),
            user_agent VARCHAR(500),
            ip_address VARCHAR(64),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            resolved_at TIMESTAMPTZ,
            resolved_by_id UUID REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_support_tickets_user_id ON support_tickets (user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_support_tickets_company_id ON support_tickets (company_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_support_tickets_type ON support_tickets (type)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_support_tickets_status ON support_tickets (status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_support_tickets_user_email ON support_tickets (user_email)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_support_tickets_created_at ON support_tickets (created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_support_tickets_status_created ON support_tickets (status, created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_support_tickets_type_created ON support_tickets (type, created_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS support_tickets")
