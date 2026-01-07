# Quick Deployment Guide

## 🚀 Deploy to Production in 3 Steps

### 1. Supabase Setup (Database)

```bash
# Option A: Using Supabase Dashboard (SQL Editor)
# Run all SQL migrations from: server/supabase/migrations/

# Option B: Using Supabase CLI
supabase db push
```

### 2. Render Setup (Backend API)

1. Connect GitHub repo to Render
2. Set environment variables:
   - `DATABASE_URL` (from Supabase)
   - `SECRET_KEY` (generate with: `python -c "import secrets; print(secrets.token_urlsafe(32))"`)
   - `FRONTEND_URL` (your Vercel URL)
   - `CORS_ORIGINS` (your Vercel URL)
   - `GMAIL_CREDENTIALS_JSON` (optional)
   - `GMAIL_TOKEN_JSON` (optional)

3. Deploy

### 3. Vercel Setup (Frontend)

1. Connect GitHub repo to Vercel
2. Set environment variable:
   - `NEXT_PUBLIC_API_URL` (your Render API URL)
3. Deploy

### 4. Create Developer Account

**After deployment, create developer account:**

```bash
# Method 1: SQL (Supabase Dashboard → SQL Editor)
# Run: server/supabase/migrations/20240112000000_012_create_developer_account.sql

# Method 2: Python Script (Render Shell)
cd server
python create_developer_supabase.py
```

**Developer Login:**
- Email: `pd.dev267@gmail.com`
- Password: `Dev@2024ChangeMe!`
- ⚠️ Change password after first login!

## ✅ Verify

1. Visit frontend URL
2. Register a company
3. Login as developer → Should redirect to `/developer`
4. Check Developer Portal tabs

## 📚 Full Documentation

- **Complete Deployment**: See `DEPLOYMENT_SUPABASE_SETUP.md`
- **Developer Account**: See `DEPLOYMENT_DEVELOPER_ACCOUNT.md`
- **Gmail Setup**: See `server/GMAIL_SETUP_PLAYGROUND.md`

