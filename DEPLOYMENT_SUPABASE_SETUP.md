# Deployment Guide: Supabase + Render + Vercel

This guide covers deploying ClockInn Pro to production with Supabase as the database, Render for the backend API, and Vercel for the frontend.

## Quick Start Checklist

- [ ] Set up Supabase project
- [ ] Run database migrations
- [ ] Deploy backend to Render
- [ ] Deploy frontend to Vercel
- [ ] Create developer account
- [ ] Configure Gmail API
- [ ] Test developer portal

## Step 1: Supabase Setup

### 1.1 Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Note your database connection details:
   - Project URL
   - Database password
   - Database URL (Connection Pooling)

### 1.2 Get Database Connection String

**Option A: Direct Connection (for migrations)**
```
postgresql://postgres:[YOUR_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
```

**Option B: Connection Pooler (recommended for production)**
```
postgresql://postgres.[PROJECT_REF]:[YOUR_PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
```

### 1.3 Run Database Migrations

#### Using Supabase Dashboard (SQL Editor):

1. Go to SQL Editor in Supabase dashboard
2. Run migrations in order:
   - `server/supabase/migrations/20240101000000_001_initial_migration.sql`
   - `server/supabase/migrations/20240102000000_002_add_job_role_pay_rate.sql`
   - ... (all migrations in order)
   - `server/supabase/migrations/20240112000000_012_create_developer_account.sql` (optional - can run after)

#### Using Supabase CLI:

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link project
supabase link --project-ref [YOUR_PROJECT_REF]

# Push migrations
supabase db push
```

## Step 2: Backend Deployment (Render)

### 2.1 Connect Repository

1. Go to [render.com](https://render.com)
2. Create a new Web Service
3. Connect your GitHub repository
4. Select the repository

### 2.2 Configure Service

**Basic Settings:**
- **Name**: `clockinn-api`
- **Environment**: `Python 3`
- **Region**: Choose closest to your users
- **Branch**: `main` (or your production branch)

**Build & Deploy:**
- **Build Command**: `cd server && pip install -r requirements.txt`
- **Start Command**: `bash server/render-start.sh`

**Environment Variables:**
```
DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
SECRET_KEY=[GENERATE_A_SECURE_RANDOM_STRING]
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=30
FRONTEND_URL=https://your-frontend.vercel.app
CORS_ORIGINS=https://your-frontend.vercel.app
PORT=8000
GMAIL_CREDENTIALS_JSON=[YOUR_GMAIL_CREDENTIALS_JSON_STRING]
GMAIL_TOKEN_JSON=[YOUR_GMAIL_TOKEN_JSON_STRING]
GMAIL_SENDER_EMAIL=no-reply.clockinpro@gmail.com
```

### 2.3 Generate SECRET_KEY

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 2.4 Deploy

1. Click "Create Web Service"
2. Wait for build to complete
3. Note your API URL (e.g., `https://clockinn-api.onrender.com`)

## Step 3: Frontend Deployment (Vercel)

### 3.1 Connect Repository

1. Go to [vercel.com](https://vercel.com)
2. Import your GitHub repository
3. Select the repository

### 3.2 Configure Project

**Framework Preset**: Next.js

**Environment Variables:**
```
NEXT_PUBLIC_API_URL=https://clockinn-api.onrender.com
```

**Build Settings:**
- **Build Command**: `npm run build` (default)
- **Output Directory**: `.next` (default)
- **Install Command**: `npm install` (default)

### 3.3 Deploy

1. Click "Deploy"
2. Wait for build to complete
3. Note your frontend URL (e.g., `https://clockinn-pro.vercel.app`)

### 3.4 Update CORS in Backend

After frontend is deployed, update the `CORS_ORIGINS` and `FRONTEND_URL` in Render:

```
CORS_ORIGINS=https://clockinn-pro.vercel.app
FRONTEND_URL=https://clockinn-pro.vercel.app
```

Then redeploy the backend.

## Step 4: Create Developer Account

### Method 1: SQL Migration (Recommended)

1. Go to Supabase Dashboard → SQL Editor
2. Run the migration: `server/supabase/migrations/20240112000000_012_create_developer_account.sql`

### Method 2: Python Script (On Render)

1. Go to Render Dashboard → Your Service → Shell
2. Run:
```bash
cd server
python create_developer_supabase.py
```

### Method 3: Python Script (Local)

1. Set environment variable:
```bash
export DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres"
```

2. Run script:
```bash
cd server
python create_developer_supabase.py
```

**Developer Credentials:**
- Email: `pd.dev267@gmail.com`
- Password: `Dev@2024ChangeMe!`
- ⚠️ **Change password after first login!**

## Step 5: Configure Gmail API

1. **Login** as developer (`pd.dev267@gmail.com`)
2. Go to **Settings** → **Email Service** tab
3. **Upload Gmail Token** (if using Google Playground method)
4. **Test Email** to verify setup

See `server/GMAIL_SETUP_PLAYGROUND.md` for detailed Gmail API setup.

## Step 6: Verify Deployment

### Test Backend:
```bash
curl https://clockinn-api.onrender.com/health
```

### Test Frontend:
1. Visit `https://your-frontend.vercel.app`
2. Register a new company (creates first admin)
3. Login as developer
4. Access Developer Portal at `/developer`

### Test Developer Portal:
1. Login with developer credentials
2. You should be redirected to `/developer`
3. Check all tabs:
   - Overview
   - Stats
   - System
   - Activity
   - Email

## Troubleshooting

### Backend Issues

**Migration Errors:**
- Check Render logs
- Verify `DATABASE_URL` is correct
- Ensure migrations are in correct order

**Connection Errors:**
- Verify SSL is configured (automatic for Supabase)
- Check firewall rules in Supabase
- Use connection pooler for production

**Gmail API Errors:**
- Check `GMAIL_CREDENTIALS_JSON` and `GMAIL_TOKEN_JSON` are set
- Verify tokens are valid
- Check Gmail API health in Developer Portal

### Frontend Issues

**API Connection Errors:**
- Verify `NEXT_PUBLIC_API_URL` is correct
- Check CORS settings in backend
- Verify backend is running

**Build Errors:**
- Check Node.js version (should be 18+)
- Verify all dependencies are in `package.json`
- Check build logs in Vercel

### Developer Account Issues

**Account Not Created:**
- Check Supabase logs
- Verify at least one company exists
- Ensure DEVELOPER role exists in enum

**Can't Login:**
- Verify password hash is correct
- Check user exists in `users` table
- Verify email is normalized (lowercase)

## Production Checklist

Before going live:

- [ ] All migrations applied
- [ ] Developer account created
- [ ] Gmail API configured and tested
- [ ] CORS configured correctly
- [ ] Environment variables set
- [ ] SSL certificates valid (automatic with Vercel/Render)
- [ ] Backend health check passing
- [ ] Frontend builds successfully
- [ ] Developer portal accessible
- [ ] Email verification working
- [ ] Kiosk page working
- [ ] All API endpoints tested

## Security Notes

1. **Never commit secrets** - Use environment variables
2. **Rotate SECRET_KEY** periodically
3. **Use connection pooler** for Supabase in production
4. **Enable rate limiting** (already configured)
5. **Monitor logs** for suspicious activity
6. **Change default developer password** immediately

## Support

- Check logs: Render Dashboard → Logs
- Check database: Supabase Dashboard → Logs
- Check frontend: Vercel Dashboard → Logs
- Developer Portal: System info and activity monitoring

