# Run Migrations Using Supabase CLI

## ✅ What's Already Done

I've converted all your Alembic migrations to SQL files in `supabase/migrations/`:
- `001_initial_migration.sql` - Creates all base tables (companies, users, sessions, time_entries, leave_requests, audit_logs)
- `002_add_job_role_pay_rate.sql` - Adds job_role and pay_rate to users
- `003_add_payroll_tables.sql` - Creates payroll tables and fields
- `004_add_user_email_unique_constraint.sql` - Adds unique email constraint per company
- `005_add_composite_indexes.sql` - Adds performance indexes

## Step 1: Install Supabase CLI (if not already installed)

```bash
npm install -g supabase
```

Or download from: https://github.com/supabase/cli/releases

## Step 2: Login to Supabase

```bash
supabase login
```

This will open your browser to authenticate with Supabase.

## Step 3: Link to Your Supabase Project

You need your **Project Reference ID** from Supabase:

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Settings** → **General**
4. Copy your **Reference ID** (it's a long string like `abcdefghijklmnop`)

Then run:
```bash
cd server
supabase link --project-ref YOUR_PROJECT_REF_ID
```

You'll be prompted for:
- **Database password**: Your Supabase database password

## Step 4: Push Migrations

Once linked, push all migrations to your database:

```bash
supabase db push
```

This will:
- Apply all SQL migrations in `supabase/migrations/`
- Show you which migrations are being applied
- Report any errors if they occur

## Alternative: Use Direct Connection

If linking doesn't work, you can use a direct connection:

```bash
# Get your DATABASE_URL from Render Dashboard
supabase db push --db-url "postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres"
```

## Verify Migrations

After running, check that tables were created:

1. Go to Supabase Dashboard → **Table Editor**
2. You should see:
   - `companies`
   - `users`
   - `sessions`
   - `time_entries`
   - `leave_requests`
   - `audit_logs`
   - `payroll_runs`
   - `payroll_line_items`
   - `payroll_adjustments`

## Troubleshooting

### Error: "relation already exists"
- Some tables might already exist. You can either:
  - Drop existing tables and re-run migrations
  - Or skip already-applied migrations manually

### Error: "connection refused"
- Check your database password is correct
- Make sure your Supabase project is not paused
- Try using the connection pooler URL (port 6543)

### Error: "migration already applied"
- This is normal if migrations were partially run before
- Supabase tracks applied migrations in a `schema_migrations` table

## After Migrations

Once migrations complete successfully:
1. Your Render backend should now work!
2. Try registering a company again from your Vercel frontend
3. The "relation 'users' does not exist" error should be gone

---

**Note**: These SQL migrations are equivalent to your Alembic migrations. Both methods (Alembic or Supabase CLI) will work, but using Supabase CLI is easier for one-time setup.

