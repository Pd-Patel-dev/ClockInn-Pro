"""add_password_reset_otp_columns

Revision ID: 023_password_reset_otp
Revises: 022_add_location
Create Date: 2026-02-19

"""
from alembic import op
import sqlalchemy as sa

revision = '023_password_reset_otp'
down_revision = '022_add_location'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('password_reset_otp_hash', sa.String(255), nullable=True))
    op.add_column('users', sa.Column('password_reset_otp_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('password_reset_attempts', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('last_password_reset_sent_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'last_password_reset_sent_at')
    op.drop_column('users', 'password_reset_attempts')
    op.drop_column('users', 'password_reset_otp_expires_at')
    op.drop_column('users', 'password_reset_otp_hash')
