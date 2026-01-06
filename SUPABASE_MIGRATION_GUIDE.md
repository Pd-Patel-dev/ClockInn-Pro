# Supabase Migration Guide

## Overview

This guide explains how to run the new migration (`010_add_company_slug_and_kiosk_enabled.sql`) on your Supabase database.

## Migration Details

**File:** `server/supabase/migrations/20240110000000_010_add_company_slug_and_kiosk_enabled.sql`

**Changes:**
- Adds `kiosk_enabled` column (BOOLEAN, default: true)
- Adds `slug` column (VARCHAR(50), unique, indexed)
- Generates slugs for existing companies
- Creates unique index on slug column

## Method 1: Using Supabase Dashboard (Recommended)

1. **Login to Supabase Dashboard**
   - Go to https://supabase.com/dashboard
   - Select your project

2. **Navigate to SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "New query"

3. **Run the Migration**
   - Copy the contents of `server/supabase/migrations/20240110000000_010_add_company_slug_and_kiosk_enabled.sql`
   - Paste into the SQL editor
   - Click "Run" or press `Ctrl+Enter` (Windows) / `Cmd+Enter` (Mac)

4. **Verify Migration**
   - Check that the query executed successfully
   - Verify columns exist:
   ```sql
   SELECT column_name, data_type, is_nullable, column_default
   FROM information_schema.columns
   WHERE table_name = 'companies'
   AND column_name IN ('slug', 'kiosk_enabled');
   ```

## Method 2: Using Supabase CLI

If you have Supabase CLI installed:

```bash
# Make sure you're in the server directory
cd server

# Link to your Supabase project (if not already linked)
supabase link --project-ref your-project-ref

# Push migrations to Supabase
supabase db push

# Or apply specific migration
supabase migration up
```

## Method 3: Using psql (Command Line)

1. **Get your Supabase connection string**
   - Go to Supabase Dashboard → Settings → Database
   - Copy the connection string (URI format)

2. **Run the migration file**
   ```bash
   psql "postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres?sslmode=require" -f server/supabase/migrations/20240110000000_010_add_company_slug_and_kiosk_enabled.sql
   ```

## Verification Queries

After running the migration, verify everything is correct:

```sql
-- Check columns exist
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'companies'
AND column_name IN ('slug', 'kiosk_enabled');

-- Check index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'companies'
AND indexname = 'ix_companies_slug';

-- Check all companies have slugs
SELECT id, name, slug, kiosk_enabled
FROM companies
LIMIT 10;

-- Check for NULL slugs (should return 0 rows)
SELECT COUNT(*) as null_slugs
FROM companies
WHERE slug IS NULL;

-- Check for duplicate slugs (should return 0 rows)
SELECT slug, COUNT(*) as count
FROM companies
GROUP BY slug
HAVING COUNT(*) > 1;
```

## Troubleshooting

### Error: Column already exists
If you see "column already exists" error, it means the migration was partially run. The migration uses `IF NOT EXISTS` clauses, so it should be safe to re-run. However, if you encounter issues:

1. Check current state:
   ```sql
   SELECT column_name 
   FROM information_schema.columns 
   WHERE table_name = 'companies';
   ```

2. If columns exist but migration failed partway, you may need to manually complete it.

### Error: Duplicate slug generation
If you see duplicate slug errors:
1. The migration handles this automatically by appending random suffixes
2. If issues persist, check existing slugs:
   ```sql
   SELECT slug, COUNT(*) 
   FROM companies 
   GROUP BY slug 
   HAVING COUNT(*) > 1;
   ```

### Error: SSL connection required
Make sure your connection string includes `?sslmode=require` at the end.

## Post-Migration Checklist

- [ ] Migration executed successfully
- [ ] All companies have slugs
- [ ] No NULL slugs exist
- [ ] No duplicate slugs
- [ ] Index `ix_companies_slug` exists
- [ ] `kiosk_enabled` column exists and defaults to `true`
- [ ] Test kiosk functionality works with new slug-based URLs

## Next Steps

After migration:
1. Update your application to use the new slug-based kiosk URLs
2. Test kiosk functionality: `/kiosk/[company-slug]`
3. Verify company slugs are displayed in settings page
4. Test clock-in/out via kiosk API endpoints

## Notes

- The migration is **idempotent** - safe to run multiple times
- Existing companies will automatically get slugs generated
- New companies will have slugs auto-generated on registration (handled by application code)
- The `slug` column is immutable - once set, it should not be changed (application enforces this)

