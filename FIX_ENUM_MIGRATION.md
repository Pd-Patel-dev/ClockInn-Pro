# Fix Shift Enum Types in Database

## Problem
The database has `shifts.status` and `shift_templates.template_type` as `VARCHAR` columns instead of PostgreSQL `ENUM` types. This causes SQLAlchemy to fail because it expects enum types.

## Error
```
type "shiftstatus" does not exist
```

## Solution

### Option 1: Run the Fix Migration (Recommended)

Run this migration to convert existing VARCHAR columns to ENUM types:

```sql
-- Create enum types if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shiftstatus') THEN
        CREATE TYPE shiftstatus AS ENUM ('DRAFT', 'PUBLISHED', 'APPROVED', 'CANCELLED');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shifttemplatetype') THEN
        CREATE TYPE shifttemplatetype AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'NONE');
    END IF;
END $$;

-- Convert shifts.status from VARCHAR to ENUM
ALTER TABLE shifts 
ALTER COLUMN status TYPE shiftstatus USING status::shiftstatus;

-- Convert shift_templates.template_type from VARCHAR to ENUM
ALTER TABLE shift_templates 
ALTER COLUMN template_type TYPE shifttemplatetype USING template_type::shifttemplatetype;
```

### Option 2: Using Supabase CLI

```bash
cd server
supabase db push
```

This will run the new migration file `20240109000000_009_fix_shift_enums.sql`.

### Option 3: Manual via Supabase Dashboard

1. Go to Supabase Dashboard → SQL Editor
2. Copy the contents of `server/supabase/migrations/20240109000000_009_fix_shift_enums.sql`
3. Run the SQL script

## Verify Fix

After running the migration, check:
```sql
-- Should return 'USER-DEFINED' or 'e' for enum
SELECT typname, typtype 
FROM pg_type 
WHERE typname IN ('shiftstatus', 'shifttemplatetype');

-- Should return 'shiftstatus' as the data type
SELECT column_name, data_type, udt_name
FROM information_schema.columns 
WHERE table_name = 'shifts' AND column_name = 'status';
```

The `udt_name` should be `shiftstatus`, not `varchar`.

