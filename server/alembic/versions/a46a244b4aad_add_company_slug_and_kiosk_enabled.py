"""add_company_slug_and_kiosk_enabled

Revision ID: a46a244b4aad
Revises: 008
Create Date: 2026-01-05 12:22:14.185064

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import re
import secrets


# revision identifiers, used by Alembic.
revision = 'a46a244b4aad'
down_revision = '008'
branch_labels = None
depends_on = None


def slugify(text: str, max_length: int = 40) -> str:
    """Convert text to URL-safe slug."""
    slug = text.lower().strip()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    slug = slug.strip('-')
    if len(slug) > max_length:
        slug = slug[:max_length].rstrip('-')
    return slug or 'company'


def generate_short_id() -> str:
    """Generate a short random ID for slug collision handling."""
    return secrets.token_urlsafe(4).lower()[:6]


def upgrade() -> None:
    connection = op.get_bind()
    
    # Check if columns already exist (for idempotency)
    result = connection.execute(sa.text("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'companies' 
        AND column_name IN ('slug', 'kiosk_enabled')
    """))
    existing_columns = {row[0] for row in result.fetchall()}
    
    # Add kiosk_enabled column if it doesn't exist
    if 'kiosk_enabled' not in existing_columns:
        op.add_column('companies', sa.Column('kiosk_enabled', sa.Boolean(), nullable=False, server_default=sa.text('true')))
    
    # Add slug column if it doesn't exist
    if 'slug' not in existing_columns:
        op.add_column('companies', sa.Column('slug', sa.String(length=50), nullable=True))
    
    # Generate slugs for existing companies that don't have one
    result = connection.execute(sa.text("SELECT id, name FROM companies WHERE slug IS NULL"))
    companies = result.fetchall()
    
    if companies:
        # Get existing slugs to avoid collisions
        existing_slugs_result = connection.execute(sa.text("SELECT slug FROM companies WHERE slug IS NOT NULL"))
        used_slugs = {row[0] for row in existing_slugs_result.fetchall()}
        
        for company_id, company_name in companies:
            base_slug = slugify(company_name)
            slug = base_slug
            attempts = 0
            while slug in used_slugs and attempts < 10:
                slug = f"{base_slug}-{generate_short_id()}"
                attempts += 1
            used_slugs.add(slug)
            # Use op.execute for data migrations - it handles transactions properly
            op.execute(
                sa.text("UPDATE companies SET slug = :slug WHERE id = :id"),
                {"slug": slug, "id": company_id}
            )
    
    # Make slug NOT NULL if there are no NULL values
    result = connection.execute(sa.text("SELECT COUNT(*) FROM companies WHERE slug IS NULL"))
    null_count = result.scalar()
    if null_count == 0:
        op.alter_column('companies', 'slug', nullable=False)
    
    # Create index if it doesn't exist
    result = connection.execute(sa.text("""
        SELECT indexname 
        FROM pg_indexes 
        WHERE tablename = 'companies' 
        AND indexname = 'ix_companies_slug'
    """))
    if not result.fetchone():
        op.create_index('ix_companies_slug', 'companies', ['slug'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_companies_slug', table_name='companies')
    op.drop_column('companies', 'slug')
    op.drop_column('companies', 'kiosk_enabled')

