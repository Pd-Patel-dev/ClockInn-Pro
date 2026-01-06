# 🚀 ClockIn Pro - Production Deployment Guide

Complete guide to deploy ClockIn Pro to production.

---

## 📋 **Prerequisites**

1. **Accounts Required:**
   - [Render](https://render.com) account (Backend hosting)
   - [Vercel](https://vercel.com) account (Frontend hosting)
   - [Supabase](https://supabase.com) account (PostgreSQL database)
   - [Google Cloud Console](https://console.cloud.google.com) (Gmail API)

2. **GitHub Repository:**
   - Push your code to GitHub (required for Vercel/Render)

3. **Domain (Optional):**
   - Custom domain for frontend
   - Custom domain for backend API

---

## 🗄️ **Step 1: Database Setup (Supabase)**

### 1.1 Create Supabase Project

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Click "New Project"
3. Fill in:
   - **Project Name**: `clockinn-pro`
   - **Database Password**: (save this securely!)
   - **Region**: Choose closest to your users
4. Wait for project to be created (~2 minutes)

### 1.2 Get Database Connection String

1. Go to **Settings** → **Database**
2. Find **Connection String** → **URI**
3. Copy the connection string (looks like: `postgresql://postgres:[YOUR-PASSWORD]@db.xxx.supabase.co:5432/postgres`)
4. Replace `[YOUR-PASSWORD]` with your actual password
5. **Important:** For production, use the **Connection Pooling** URL instead:
   - Connection Pooling → Transaction mode
   - Use this URL format: `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`

### 1.3 Run Database Migrations

**Option A: Using Supabase SQL Editor (Recommended)**
1. Go to **SQL Editor** in Supabase
2. Copy and run each migration file from `server/supabase/migrations/` in order:
   - `001_initial_migration.sql`
   - `002_add_job_role_pay_rate.sql`
   - ... (all migration files)
3. Run them sequentially

**Option B: Using Supabase CLI**
```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link your project
supabase link --project-ref your-project-ref

# Push migrations
cd server
supabase db push
```

**Option C: Using Alembic (via Render after deployment)**
- Migrations will run automatically on first deploy (see Step 3)

---

## 🔐 **Step 2: Gmail API Setup (Email Verification)**

### 2.1 Create Gmail API Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable **Gmail API**:
   - APIs & Services → Enable APIs → Search "Gmail API" → Enable
4. Create OAuth 2.0 credentials:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Authorized redirect URIs:
     - `http://localhost:8080/` (for testing)
     - Your production callback URL (if using custom flow)
   - Save Client ID and Client Secret

### 2.2 Get Refresh Token

**Using Google OAuth 2.0 Playground (Easiest):**

1. Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
2. Click the gear icon (⚙️) in top right
3. Check "Use your own OAuth credentials"
4. Enter your Client ID and Client Secret
5. In left panel, find "Gmail API v1" → `https://www.googleapis.com/auth/gmail.send`
6. Click "Authorize APIs"
7. Sign in with the email you want to use for sending (e.g., `no-reply.clockinpro@gmail.com`)
8. Click "Exchange authorization code for tokens"
9. Copy the **Refresh Token**

**Note:** Playground refresh tokens expire after 24 hours. For production, use your own OAuth flow or see `server/GMAIL_SETUP_PLAYGROUND.md` for more details.

### 2.3 Create Credentials JSON

1. Create `gmail_credentials.json`:
```json
{
  "installed": {
    "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
    "client_secret": "YOUR_CLIENT_SECRET",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "redirect_uris": ["http://localhost"]
  }
}
```

2. Create `gmail_token.json`:
```json
{
  "token": "ACCESS_TOKEN",
  "refresh_token": "YOUR_REFRESH_TOKEN",
  "token_uri": "https://oauth2.googleapis.com/token",
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "client_secret": "YOUR_CLIENT_SECRET",
  "scopes": ["https://www.googleapis.com/auth/gmail.send"],
  "expiry": "2024-01-01T00:00:00Z"
}
```

3. Convert to environment variables (single-line JSON):
```bash
# On Linux/Mac
cat gmail_credentials.json | jq -c

# On Windows (PowerShell)
Get-Content gmail_credentials.json | ConvertFrom-Json | ConvertTo-Json -Compress
```

---

## 🔧 **Step 3: Backend Deployment (Render)**

### 3.1 Create Render Web Service

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click "New" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Name**: `clockinn-api`
   - **Environment**: `Python 3`
   - **Build Command**: `cd server && pip install -r requirements.txt`
   - **Start Command**: `bash server/render-start.sh`
   - **Region**: Choose closest to your database

### 3.2 Configure Environment Variables

Add these environment variables in Render:

#### **Required Variables:**
```env
# Database
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

# JWT
SECRET_KEY=your-super-secret-key-here-generate-with-openssl-rand-hex-32
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=30

# CORS
FRONTEND_URL=https://your-frontend.vercel.app
CORS_ORIGINS=https://your-frontend.vercel.app

# Server
PORT=8000
```

#### **Gmail API (Optional but recommended):**
```env
# Gmail API (single-line JSON strings)
GMAIL_CREDENTIALS_JSON={"installed":{"client_id":"...","client_secret":"...",...}}
GMAIL_TOKEN_JSON={"token":"...","refresh_token":"...",...}
GMAIL_SENDER_EMAIL=no-reply.clockinpro@gmail.com
```

**How to get single-line JSON:**
```bash
# Copy entire JSON content from gmail_credentials.json and gmail_token.json
# Paste into Render environment variable (Render handles it automatically)
# Or use jq -c on Linux/Mac, or ConvertTo-Json -Compress on Windows PowerShell
```

#### **Generate SECRET_KEY:**
```bash
# On Linux/Mac
openssl rand -hex 32

# On Windows (PowerShell)
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

### 3.3 Deploy

1. Click "Create Web Service"
2. Render will:
   - Clone your repo
   - Install dependencies
   - Run migrations (via `render-start.sh`)
   - Start the server
3. Wait for deployment to complete (~5-10 minutes)
4. Note your backend URL: `https://clockinn-api.onrender.com`

### 3.4 Verify Backend

1. Check deployment logs for errors
2. Visit `https://your-backend.onrender.com/docs` (FastAPI docs)
3. Test health endpoint: `https://your-backend.onrender.com/api/v1/health`

---

## 🎨 **Step 4: Frontend Deployment (Vercel)**

### 4.1 Create Vercel Project

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "Add New" → "Project"
3. Import your GitHub repository
4. Configure:
   - **Framework Preset**: Next.js
   - **Root Directory**: `client`
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `.next` (auto-detected)

### 4.2 Configure Environment Variables

Add these environment variables in Vercel:

```env
NEXT_PUBLIC_API_URL=https://your-backend.onrender.com
```

**Where to add:**
1. Go to your project → Settings → Environment Variables
2. Add variable for **Production**, **Preview**, and **Development**

### 4.3 Deploy

1. Click "Deploy"
2. Vercel will:
   - Install dependencies
   - Build the Next.js app
   - Deploy to CDN
3. Wait for deployment (~2-5 minutes)
4. Note your frontend URL: `https://your-app.vercel.app`

### 4.4 Update CORS on Backend

After frontend is deployed, update backend CORS settings:

1. Go to Render → Environment Variables
2. Update:
   ```env
   FRONTEND_URL=https://your-app.vercel.app
   CORS_ORIGINS=https://your-app.vercel.app
   ```
3. Redeploy backend (Render auto-redeploys on env var changes)

---

## ✅ **Step 5: Post-Deployment Verification**

### 5.1 Test Basic Functionality

1. **Frontend:**
   - Visit your Vercel URL
   - Should load without errors
   - Check browser console for API connection

2. **Backend:**
   - Visit `/docs` endpoint
   - Test `/api/v1/health` endpoint
   - Check logs for errors

3. **Registration:**
   - Register a new company
   - Verify email is received (if Gmail API configured)
   - Complete email verification

4. **Login:**
   - Login with admin credentials
   - Verify dashboard loads

5. **Kiosk:**
   - Visit `/kiosk/[company-slug]`
   - Test clock in/out with PIN

### 5.2 Test Email Verification

1. Register a new user
2. Check email inbox for verification PIN
3. Complete verification flow
4. If emails not sending, check:
   - Gmail API credentials in Render
   - Gmail service health: `/api/v1/admin/gmail/health` (admin only)

### 5.3 Verify Database

1. Go to Supabase → Table Editor
2. Verify tables exist:
   - `companies`
   - `users`
   - `time_entries`
   - `shifts`
   - `leave_requests`
   - etc.

---

## 🔒 **Step 6: Security Checklist**

- [ ] **SECRET_KEY** is strong (32+ random characters)
- [ ] **DATABASE_URL** uses connection pooling
- [ ] **CORS_ORIGINS** only includes your frontend domain
- [ ] **Gmail credentials** stored as environment variables (not in code)
- [ ] **Refresh tokens** secured
- [ ] **HTTPS** enabled (Render/Vercel default)
- [ ] **Database** has strong password
- [ ] **Environment variables** not exposed in logs
- [ ] **Rate limiting** enabled (already configured)

---

## 🐛 **Step 7: Troubleshooting**

### Backend Won't Start

**Check Render logs:**
1. Go to Render → Logs
2. Look for:
   - Migration errors
   - Database connection errors
   - Missing environment variables

**Common issues:**
- **Database connection failed**: Check `DATABASE_URL` (use pooler URL)
- **Migration failed**: Run migrations manually via Supabase SQL Editor
- **Port error**: Ensure `PORT` env var is set to `8000`

### Frontend Can't Connect to Backend

**Check:**
1. `NEXT_PUBLIC_API_URL` is correct in Vercel
2. Backend URL is accessible (visit `/docs`)
3. CORS is configured correctly
4. Browser console for CORS errors

### Email Not Sending

**Check:**
1. Gmail API credentials in Render env vars
2. Refresh token not expired
3. Gmail service health: `GET /api/v1/admin/gmail/health`
4. Check Render logs for Gmail API errors
5. Verify sender email has Gmail API enabled

### Database Connection Issues

**Use Connection Pooling:**
- Supabase has connection limits
- Use pooler URL for production
- Format: `postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres`

---

## 📊 **Step 8: Monitoring & Maintenance**

### 8.1 Monitor Logs

**Render (Backend):**
- View logs in Render dashboard
- Set up log alerts for errors

**Vercel (Frontend):**
- View logs in Vercel dashboard
- Check Analytics tab for errors

**Supabase (Database):**
- Monitor database usage
- Check query performance
- Set up alerts for storage/connection limits

### 8.2 Set Up Alerts

1. **Render:**
   - Set up email alerts for deployment failures
   - Monitor service health

2. **Vercel:**
   - Set up alerts for build failures
   - Monitor usage limits

3. **Supabase:**
   - Set up alerts for database size
   - Monitor connection limits

### 8.3 Regular Maintenance

1. **Database:**
   - Run cleanup jobs (verification data cleanup)
   - Monitor storage usage
   - Backup regularly (Supabase auto-backups)

2. **Gmail API:**
   - Monitor refresh token expiration
   - Test email sending monthly
   - Update token if expired

3. **Dependencies:**
   - Update npm packages regularly
   - Update Python packages regularly
   - Review security advisories

---

## 🔄 **Step 9: Updating Your Deployment**

### Backend Updates

1. Push changes to GitHub
2. Render auto-detects and redeploys
3. Monitor logs for errors
4. Verify health endpoint

### Frontend Updates

1. Push changes to GitHub
2. Vercel auto-detects and redeploys
3. Preview deployments available for PRs
4. Merge to main for production deploy

### Database Migrations

**If adding new migrations:**
1. Create migration locally: `alembic revision --autogenerate -m "description"`
2. Test migration locally
3. Push to GitHub
4. Render will run migrations on next deploy (via `render-start.sh`)

**Manual migration (if needed):**
1. Go to Supabase SQL Editor
2. Copy migration SQL
3. Run manually

---

## 📝 **Quick Reference**

### Environment Variables Summary

#### Backend (Render):
```
DATABASE_URL=...
SECRET_KEY=...
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=30
FRONTEND_URL=...
CORS_ORIGINS=...
PORT=8000
GMAIL_CREDENTIALS_JSON=...
GMAIL_TOKEN_JSON=...
GMAIL_SENDER_EMAIL=...
```

#### Frontend (Vercel):
```
NEXT_PUBLIC_API_URL=...
```

### Important URLs

- **Backend API**: `https://your-backend.onrender.com`
- **API Docs**: `https://your-backend.onrender.com/docs`
- **Health Check**: `https://your-backend.onrender.com/api/v1/health`
- **Frontend**: `https://your-app.vercel.app`
- **Kiosk**: `https://your-app.vercel.app/kiosk/[company-slug]`

---

## 🎉 **You're Live!**

Your ClockIn Pro app is now deployed and ready for users!

### Next Steps:
1. Test all features thoroughly
2. Create your admin account
3. Add employees
4. Test kiosk functionality
5. Share with your team!

### Support Resources:
- [Render Docs](https://render.com/docs)
- [Vercel Docs](https://vercel.com/docs)
- [Supabase Docs](https://supabase.com/docs)
- [FastAPI Docs](https://fastapi.tiangolo.com)
- [Next.js Docs](https://nextjs.org/docs)

---

**Need help?** Check the troubleshooting section or review the logs for specific error messages.

