-- Migration: Add company slug and kiosk_enabled
-- Description: Adds slug column (unique, indexed) and kiosk_enabled boolean to companies table
-- Date: 2026-01-10

-- Add kiosk_enabled column with default true
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS kiosk_enabled BOOLEAN NOT NULL DEFAULT true;

-- Add slug column (nullable initially, will be made NOT NULL after populating)
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS slug VARCHAR(50);

-- Function to generate slug from company name
CREATE OR REPLACE FUNCTION slugify(text TEXT)
RETURNS TEXT AS $$
DECLARE
    result TEXT;
BEGIN
    -- Convert to lowercase and trim
    result := LOWER(TRIM(text));
    
    -- Replace non-alphanumeric characters with hyphens
    result := REGEXP_REPLACE(result, '[^a-z0-9]+', '-', 'g');
    
    -- Collapse multiple hyphens into one
    result := REGEXP_REPLACE(result, '-+', '-', 'g');
    
    -- Remove leading/trailing hyphens
    result := TRIM(BOTH '-' FROM result);
    
    -- Limit length to 40 characters
    IF LENGTH(result) > 40 THEN
        result := LEFT(result, 40);
        result := RTRIM(result, '-');
    END IF;
    
    -- Return 'company' if empty
    IF result = '' THEN
        result := 'company';
    END IF;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to generate short random ID
CREATE OR REPLACE FUNCTION generate_short_id()
RETURNS TEXT AS $$
BEGIN
    -- Generate a 6-character random string
    RETURN LOWER(SUBSTRING(ENCODE(GEN_RANDOM_BYTES(4), 'base64') FROM 1 FOR 6));
END;
$$ LANGUAGE plpgsql;

-- Generate slugs for existing companies that don't have one
DO $$
DECLARE
    company_rec RECORD;
    base_slug TEXT;
    final_slug TEXT;
    slug_exists BOOLEAN;
    attempts INTEGER;
BEGIN
    FOR company_rec IN 
        SELECT id, name 
        FROM companies 
        WHERE slug IS NULL
    LOOP
        -- Generate base slug
        base_slug := slugify(company_rec.name);
        final_slug := base_slug;
        attempts := 0;
        slug_exists := TRUE;
        
        -- Check if slug exists and generate unique one if needed
        WHILE slug_exists AND attempts < 10 LOOP
            -- Check if slug exists
            SELECT EXISTS(SELECT 1 FROM companies WHERE slug = final_slug) INTO slug_exists;
            
            IF slug_exists THEN
                -- Generate new slug with suffix
                final_slug := base_slug || '-' || generate_short_id();
                attempts := attempts + 1;
            END IF;
        END LOOP;
        
        -- Update company with generated slug
        UPDATE companies 
        SET slug = final_slug 
        WHERE id = company_rec.id;
    END LOOP;
END $$;

-- Make slug NOT NULL (safe now that all companies have slugs)
ALTER TABLE companies 
ALTER COLUMN slug SET NOT NULL;

-- Create unique index on slug
CREATE UNIQUE INDEX IF NOT EXISTS ix_companies_slug 
ON companies(slug);

-- Drop helper functions (optional - you can keep them if you want to use them elsewhere)
DROP FUNCTION IF EXISTS slugify(TEXT);
DROP FUNCTION IF EXISTS generate_short_id();

