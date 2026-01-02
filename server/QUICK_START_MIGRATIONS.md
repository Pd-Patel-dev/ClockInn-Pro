# Quick Start: Run Migrations with Supabase CLI

## ✅ Correct Command Syntax

The `supabase db push` command **automatically** finds and applies all migrations in `supabase/migrations/`. You don't need `--file` flag.

## Step-by-Step Instructions

### 1. Install Supabase CLI
```bash
npm install -g supabase
```

### 2. Login
```bash
supabase login
```

### 3. Link Your Project
```bash
cd server
supabase link --project-ref YOUR_PROJECT_REF_ID
```

Get Project Ref ID from: Supabase Dashboard → Settings → General

### 4. Push Migrations
```bash
supabase db push
```

That's it! This will apply all 5 migrations automatically:
- ✅ 001_initial_migration.sql
- ✅ 002_add_job_role_pay_rate.sql  
- ✅ 003_add_payroll_tables.sql
- ✅ 004_add_user_email_unique_constraint.sql
- ✅ 005_add_composite_indexes.sql

## Alternative: Direct Connection (No Linking)

If you prefer not to link:

```bash
supabase db push --db-url "postgresql://postgres:YOUR_PASSWORD@db.xxxxx.supabase.co:5432/postgres" --password YOUR_PASSWORD
```

**Important**: URL must be percent-encoded (special characters encoded).

## Preview Before Applying (Dry Run)

To see what will be applied without actually applying it:

```bash
supabase db push --dry-run
```

## Common Flags

- `--dry-run` - Preview migrations without applying
- `--db-url` - Use direct database URL instead of linked project
- `--password` - Database password (if using --db-url)
- `--include-all` - Include migrations not in remote history

## ✅ That's It!

After `supabase db push` completes successfully, your database will have all tables and your Render backend will work!

