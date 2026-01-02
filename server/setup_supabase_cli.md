# Setup Supabase CLI for Migrations

## Step 1: Install Supabase CLI

### Option A: Using npm (Recommended)
```bash
npm install -g supabase
```

### Option B: Using Scoop (Windows)
```bash
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

### Option C: Using Chocolatey (Windows)
```bash
choco install supabase
```

### Option D: Direct Download
Download from: https://github.com/supabase/cli/releases

## Step 2: Login to Supabase
```bash
supabase login
```
This will open your browser to authenticate.

## Step 3: Link to Your Supabase Project

1. Go to your Supabase Dashboard
2. Click on your project
3. Go to **Settings** → **General**
4. Copy your **Project Reference ID** (or use the project URL)

Then run:
```bash
cd server
supabase link --project-ref your-project-ref-id
```

You'll need:
- **Database Password**: Your Supabase database password
- **Project ID**: Found in Settings → General

## Step 4: Run Migrations

After linking, you can push migrations using SQL files. We've created SQL migration files that match your Alembic migrations.

```bash
supabase db push
```

This will apply all SQL migrations in `supabase/migrations/` to your database.

## Alternative: Run SQL Directly

If you prefer, you can also run SQL directly:
```bash
supabase db execute --file supabase/migrations/001_initial_migration.sql
```

