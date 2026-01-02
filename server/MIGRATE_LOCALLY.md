# How to Run Migrations Locally

This guide will help you run database migrations from your local terminal to your Supabase database.

## Prerequisites

1. Python 3.11+ installed
2. Your Supabase DATABASE_URL from Render

## Step 1: Get Your DATABASE_URL

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click on your `clockinn-api` service
3. Go to **Environment** tab
4. Find `DATABASE_URL` and copy its value
   - It should look like: `postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres`

## Step 2: Install Dependencies (if not already installed)

Open PowerShell or Command Prompt in the `server` directory and run:

```bash
python -m pip install -r requirements.txt
```

## Step 3: Run Migrations

### Option A: Using PowerShell (Windows)

```powershell
# Set your DATABASE_URL (replace with your actual URL from Render)
$env:DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres"

# Run migrations
python run_migrations.py
```

### Option B: Using Command Prompt (Windows)

```cmd
REM Set your DATABASE_URL (replace with your actual URL from Render)
set DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres

REM Run migrations
python run_migrations.py
```

### Option C: Using the Batch Script

```cmd
run_migrations_local.bat "postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres"
```

## Step 4: Verify Migrations

After running, you should see:
```
✅ Migrations completed successfully!
```

If you see errors, check:
1. Your DATABASE_URL is correct
2. Your Supabase database is accessible (not paused)
3. All dependencies are installed

## Troubleshooting

### Error: "Module not found"
Run: `python -m pip install -r requirements.txt`

### Error: "Connection refused" or "Network is unreachable"
- Check your DATABASE_URL is correct
- Make sure your Supabase project is not paused
- Try using the Connection Pooler URL (port 6543) instead

### Error: "relation already exists"
This means migrations have already been run. That's okay - the script is idempotent.

## Next Steps

After migrations complete, your Render backend should work! Try registering a company again.

