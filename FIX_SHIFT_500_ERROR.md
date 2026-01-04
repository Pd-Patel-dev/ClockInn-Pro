# Fix 500 Error on Shift Endpoints

## Problem
Getting 500 Internal Server Error when trying to:
- Fetch shifts: `GET /api/v1/shifts`
- Create bulk week shifts: `POST /api/v1/shifts/bulk/week`

## Root Cause
The production database is missing the `shifts` table and related tables because migrations haven't been applied.

## Solution: Run Database Migrations

### Option 1: Using Supabase CLI (Recommended)

1. **Install Supabase CLI** (if not already installed):
   ```bash
   npm install -g supabase
   ```

2. **Login to Supabase**:
   ```bash
   supabase login
   ```

3. **Link your project**:
   ```bash
   cd server
   supabase link --project-ref your-project-ref
   ```
   (Get your project ref from Supabase dashboard URL)

4. **Push migrations**:
   ```bash
   supabase db push
   ```

### Option 2: Manual Migration via Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Run the migration files in order from `server/supabase/migrations/`:
   - `20240107000000_007_add_shift_scheduling_tables.sql`
   - `20240108000000_008_add_series_id_and_shift_id.sql`

### Option 3: Via Render Shell (if you have access)

1. Connect to your Render service shell
2. Run:
   ```bash
   cd server
   python run_migrations.py
   ```

## Verify Migrations

After running migrations, check the health endpoint:
```
GET https://clockinn-pro.onrender.com/api/v1/health
```

The response should show:
```json
{
  "database": {
    "migration_status": {
      "initialized": true,
      "current_version": "008_..."
    }
  }
}
```

## Required Tables

After migrations, you should have:
- `shifts` - Main shift table
- `shift_templates` - Recurring shift templates
- `schedule_swaps` - Shift swap requests
- Column `series_id` in `shifts` table
- Column `shift_id` in `time_entries` table

## Enhanced Error Logging

I've also improved error handling to provide more detailed error messages in development mode. The errors will now indicate if it's a database schema issue.

