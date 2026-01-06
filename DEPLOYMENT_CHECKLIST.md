# ✅ Deployment Checklist

Use this checklist to ensure everything is set up correctly before going live.

## Pre-Deployment

### Database Setup
- [ ] Supabase project created
- [ ] Database password saved securely
- [ ] Database connection string (pooler URL) copied
- [ ] All migrations run successfully
- [ ] Database tables verified in Supabase dashboard

### Gmail API Setup
- [ ] Google Cloud project created
- [ ] Gmail API enabled
- [ ] OAuth 2.0 credentials created
- [ ] Refresh token obtained
- [ ] `gmail_credentials.json` created (for reference)
- [ ] `gmail_token.json` created (for reference)
- [ ] JSON converted to single-line strings

### Code Preparation
- [ ] All code pushed to GitHub
- [ ] No sensitive data in code (no hardcoded credentials)
- [ ] `.env` files in `.gitignore`
- [ ] `gmail_credentials.json` and `gmail_token.json` in `.gitignore`
- [ ] README updated
- [ ] All tests passing (if applicable)

## Backend Deployment (Render)

### Service Configuration
- [ ] Render web service created
- [ ] GitHub repository connected
- [ ] Build command: `cd server && pip install -r requirements.txt`
- [ ] Start command: `bash server/render-start.sh`
- [ ] Region selected (closest to database)

### Environment Variables
- [ ] `DATABASE_URL` set (using pooler URL)
- [ ] `SECRET_KEY` set (strong random string, 32+ chars)
- [ ] `ALGORITHM` set to `HS256`
- [ ] `ACCESS_TOKEN_EXPIRE_MINUTES` set to `15`
- [ ] `REFRESH_TOKEN_EXPIRE_DAYS` set to `30`
- [ ] `FRONTEND_URL` set (will update after frontend deploy)
- [ ] `CORS_ORIGINS` set (will update after frontend deploy)
- [ ] `PORT` set to `8000`
- [ ] `GMAIL_CREDENTIALS_JSON` set (optional)
- [ ] `GMAIL_TOKEN_JSON` set (optional)
- [ ] `GMAIL_SENDER_EMAIL` set (optional)

### Deployment
- [ ] Initial deployment successful
- [ ] Build logs show no errors
- [ ] Migration logs show success
- [ ] Service health check passes
- [ ] API docs accessible at `/docs`
- [ ] Health endpoint works: `/api/v1/health`
- [ ] Backend URL noted: `https://...onrender.com`

## Frontend Deployment (Vercel)

### Project Configuration
- [ ] Vercel project created
- [ ] GitHub repository connected
- [ ] Framework preset: Next.js
- [ ] Root directory: `client`
- [ ] Build command auto-detected: `npm run build`
- [ ] Output directory auto-detected: `.next`

### Environment Variables
- [ ] `NEXT_PUBLIC_API_URL` set to backend URL
- [ ] Variable added for Production environment
- [ ] Variable added for Preview environment (optional)
- [ ] Variable added for Development environment (optional)

### Deployment
- [ ] Initial deployment successful
- [ ] Build logs show no errors
- [ ] Frontend accessible at Vercel URL
- [ ] No console errors in browser
- [ ] API connection works (check network tab)
- [ ] Frontend URL noted: `https://...vercel.app`

### Post-Deployment
- [ ] Updated backend `FRONTEND_URL` env var
- [ ] Updated backend `CORS_ORIGINS` env var
- [ ] Backend redeployed with new CORS settings

## Verification

### Basic Functionality
- [ ] Frontend loads without errors
- [ ] Registration page works
- [ ] Can register new company
- [ ] Email verification received (if Gmail configured)
- [ ] Can verify email with PIN
- [ ] Can login after verification
- [ ] Dashboard loads for admin
- [ ] Can view employees list
- [ ] Can add new employee

### Core Features
- [ ] Clock in/out works (web)
- [ ] Kiosk page loads: `/kiosk/[slug]`
- [ ] Clock in/out works (kiosk)
- [ ] Time entries visible in logs
- [ ] Schedule creation works
- [ ] Shift viewing works
- [ ] Leave request creation works
- [ ] Leave request approval works
- [ ] Payroll generation works
- [ ] Reports export works (PDF/Excel)

### Email Features (if configured)
- [ ] Registration email sent
- [ ] Verification PIN email received
- [ ] Email verification works
- [ ] Gmail health check: `/api/v1/admin/gmail/health` (admin only)

### Security
- [ ] HTTPS enabled (both frontend and backend)
- [ ] CORS configured correctly
- [ ] No sensitive data exposed in network requests
- [ ] API requires authentication (except public endpoints)
- [ ] Rate limiting active

## Monitoring Setup

### Logs
- [ ] Render logs accessible
- [ ] Vercel logs accessible
- [ ] Supabase logs accessible (optional)

### Alerts
- [ ] Render deployment alerts configured
- [ ] Vercel build alerts configured
- [ ] Error monitoring set up (optional: Sentry)

### Health Checks
- [ ] Backend health endpoint monitored
- [ ] Database connection monitored
- [ ] Gmail API health monitored

## Documentation

### User Documentation
- [ ] Admin guide created
- [ ] Employee guide created
- [ ] Kiosk usage guide created

### Technical Documentation
- [ ] API documentation accessible (`/docs`)
- [ ] Deployment guide complete
- [ ] Environment variables documented
- [ ] Troubleshooting guide available

## Final Checks

### Performance
- [ ] Page load times acceptable
- [ ] API response times acceptable
- [ ] Database queries optimized

### Scalability
- [ ] Database connection pooling configured
- [ ] Rate limits appropriate
- [ ] Caching strategy considered (future)

### Compliance
- [ ] Privacy policy (if required)
- [ ] Terms of service (if required)
- [ ] GDPR compliance (if applicable)
- [ ] Data retention policy

## Go Live

- [ ] All checklist items completed
- [ ] Tested with real users (beta testing)
- [ ] Feedback collected and addressed
- [ ] Backup strategy in place
- [ ] Rollback plan prepared
- [ ] Support contact information available

---

## 🎉 Ready to Launch!

Once all items are checked, your app is ready for production use!

**Remember:**
- Monitor logs closely in first 24-48 hours
- Be ready to fix issues quickly
- Collect user feedback
- Plan regular updates and improvements

---

## Quick Command Reference

### Check Backend Health
```bash
curl https://your-backend.onrender.com/api/v1/health
```

### Check Gmail API Health (Admin)
```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  https://your-backend.onrender.com/api/v1/admin/gmail/health
```

### Test Registration
1. Visit frontend URL
2. Register new company
3. Check email for verification PIN
4. Verify email
5. Login

---

**Date Completed:** _______________

**Deployed By:** _______________

**Backend URL:** _______________

**Frontend URL:** _______________

**Database:** Supabase - _______________

