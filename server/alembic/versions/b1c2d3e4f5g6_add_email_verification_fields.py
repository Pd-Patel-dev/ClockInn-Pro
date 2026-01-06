"""add_email_verification_fields

Revision ID: b1c2d3e4f5g6
Revises: a46a244b4aad
Create Date: 2026-01-10 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'b1c2d3e4f5g6'
down_revision = 'a46a244b4aad'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add email verification fields to users table
    op.add_column('users', sa.Column('email_verified', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('users', sa.Column('last_verified_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('verification_pin_hash', sa.String(255), nullable=True))
    op.add_column('users', sa.Column('verification_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('verification_attempts', sa.Integer(), nullable=False, server_default=sa.text('0')))
    op.add_column('users', sa.Column('last_verification_sent_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('verification_required', sa.Boolean(), nullable=False, server_default=sa.text('true')))


def downgrade() -> None:
    op.drop_column('users', 'verification_required')
    op.drop_column('users', 'last_verification_sent_at')
    op.drop_column('users', 'verification_attempts')
    op.drop_column('users', 'verification_expires_at')
    op.drop_column('users', 'verification_pin_hash')
    op.drop_column('users', 'last_verified_at')
    op.drop_column('users', 'email_verified')

