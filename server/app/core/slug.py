"""
Slug generation utility for company URLs.
"""
import re
import secrets
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.company import Company


def slugify(text: str, max_length: int = 40) -> str:
    """
    Convert a company name to a URL-safe slug.
    
    Rules:
    - Lowercase
    - Replace non-alphanumeric characters with hyphens
    - Collapse multiple hyphens
    - Trim hyphens from start/end
    - Limit to max_length characters
    """
    # Convert to lowercase
    slug = text.lower().strip()
    
    # Replace non-alphanumeric characters with hyphens
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    
    # Collapse multiple hyphens
    slug = re.sub(r'-+', '-', slug)
    
    # Trim hyphens from start and end
    slug = slug.strip('-')
    
    # Limit length
    if len(slug) > max_length:
        slug = slug[:max_length].rstrip('-')
    
    return slug or 'company'  # Fallback if slug becomes empty


def generate_short_id() -> str:
    """Generate a short random ID for slug collision handling."""
    return secrets.token_urlsafe(4).lower()[:6]


async def generate_unique_slug(db: AsyncSession, company_name: str) -> str:
    """
    Generate a unique slug for a company, handling collisions automatically.
    
    If the base slug exists, appends a short random suffix until unique.
    """
    base_slug = slugify(company_name)
    slug = base_slug
    
    # Check for collisions and append suffix if needed
    attempts = 0
    max_attempts = 10  # Prevent infinite loop
    
    while attempts < max_attempts:
        result = await db.execute(
            select(Company).where(Company.slug == slug)
        )
        existing = result.scalar_one_or_none()
        
        if not existing:
            return slug
        
        # Collision detected, append random suffix
        slug = f"{base_slug}-{generate_short_id()}"
        attempts += 1
    
    # Fallback: append a longer random suffix
    return f"{base_slug}-{secrets.token_urlsafe(8).lower()}"

