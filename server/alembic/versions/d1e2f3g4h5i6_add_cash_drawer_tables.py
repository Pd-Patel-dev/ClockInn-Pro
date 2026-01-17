"""Add cash drawer tables

Revision ID: d1e2f3g4h5i6
Revises: c1d2e3f4g5h6
Create Date: 2024-01-15 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'd1e2f3g4h5i6'
down_revision = 'c1d2e3f4g5h6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    
    # Create enum types
    conn.execute(sa.text("DROP TYPE IF EXISTS cashcountsource CASCADE"))
    conn.execute(sa.text("DROP TYPE IF EXISTS cashdrawerstatus CASCADE"))
    conn.execute(sa.text("DROP TYPE IF EXISTS cashdrawerauditaction CASCADE"))
    
    conn.execute(sa.text("CREATE TYPE cashcountsource AS ENUM ('kiosk', 'web')"))
    conn.execute(sa.text("CREATE TYPE cashdrawerstatus AS ENUM ('OPEN', 'CLOSED', 'REVIEW_NEEDED')"))
    conn.execute(sa.text("CREATE TYPE cashdrawerauditaction AS ENUM ('CREATE_START', 'SET_END', 'EDIT_START', 'EDIT_END', 'REVIEW', 'VOID')"))
    
    # Create cash_drawer_sessions table
    op.create_table(
        'cash_drawer_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('companies.id'), nullable=False),
        sa.Column('time_entry_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('time_entries.id'), nullable=False, unique=True),
        sa.Column('employee_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('start_cash_cents', sa.BigInteger(), nullable=False),
        sa.Column('start_counted_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('start_count_source', postgresql.ENUM('kiosk', 'web', name='cashcountsource', create_type=False), nullable=False, server_default='kiosk'),
        sa.Column('end_cash_cents', sa.BigInteger(), nullable=True),
        sa.Column('end_counted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('end_count_source', postgresql.ENUM('kiosk', 'web', name='cashcountsource', create_type=False), nullable=True),
        sa.Column('delta_cents', sa.BigInteger(), nullable=True),
        sa.Column('status', postgresql.ENUM('OPEN', 'CLOSED', 'REVIEW_NEEDED', name='cashdrawerstatus', create_type=False), nullable=False, server_default='OPEN'),
        sa.Column('reviewed_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('review_note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    
    # Create indexes
    op.create_index('idx_cash_drawer_sessions_company_employee_date', 'cash_drawer_sessions', ['company_id', 'employee_id', 'start_counted_at'])
    op.create_index('idx_cash_drawer_sessions_company_status', 'cash_drawer_sessions', ['company_id', 'status'])
    op.create_index('idx_cash_drawer_sessions_time_entry', 'cash_drawer_sessions', ['time_entry_id'])
    
    # Create cash_drawer_audit table
    op.create_table(
        'cash_drawer_audit',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('companies.id'), nullable=False),
        sa.Column('cash_drawer_session_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('cash_drawer_sessions.id'), nullable=False),
        sa.Column('actor_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('action', postgresql.ENUM('CREATE_START', 'SET_END', 'EDIT_START', 'EDIT_END', 'REVIEW', 'VOID', name='cashdrawerauditaction', create_type=False), nullable=False),
        sa.Column('old_values_json', postgresql.JSONB(), nullable=True),
        sa.Column('new_values_json', postgresql.JSONB(), nullable=True),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    
    # Create indexes
    op.create_index('idx_cash_drawer_audit_session', 'cash_drawer_audit', ['cash_drawer_session_id'])
    op.create_index('idx_cash_drawer_audit_actor', 'cash_drawer_audit', ['actor_user_id'])
    op.create_index('idx_cash_drawer_audit_created', 'cash_drawer_audit', ['created_at'])


def downgrade() -> None:
    op.drop_index('idx_cash_drawer_audit_created', table_name='cash_drawer_audit')
    op.drop_index('idx_cash_drawer_audit_actor', table_name='cash_drawer_audit')
    op.drop_index('idx_cash_drawer_audit_session', table_name='cash_drawer_audit')
    op.drop_table('cash_drawer_audit')
    
    op.drop_index('idx_cash_drawer_sessions_time_entry', table_name='cash_drawer_sessions')
    op.drop_index('idx_cash_drawer_sessions_company_status', table_name='cash_drawer_sessions')
    op.drop_index('idx_cash_drawer_sessions_company_employee_date', table_name='cash_drawer_sessions')
    op.drop_table('cash_drawer_sessions')
    
    conn = op.get_bind()
    conn.execute(sa.text("DROP TYPE IF EXISTS cashdrawerauditaction CASCADE"))
    conn.execute(sa.text("DROP TYPE IF EXISTS cashdrawerstatus CASCADE"))
    conn.execute(sa.text("DROP TYPE IF EXISTS cashcountsource CASCADE"))
