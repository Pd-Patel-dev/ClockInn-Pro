# Pre-push / Production checklist

Use this before pushing to the branch that deploys to production (e.g. `main`).

## 1. Never push these (must be in `.gitignore`)

- [ ] **`.env`** and **`.env.local`** — Ignored. Never commit real secrets.
- [ ] **`server/gmail_token.json`** and **`server/gmail_credentials.json`** — Ignored. Never commit.
- [ ] **`server/gmail_token.json`** — If you see it in `git status`, do **not** add it.

**Quick check:** Run `git status`. If `.env` or `gmail_token.json` appear, **do not** `git add` them. If they were ever committed in the past, remove them from history and add to `.gitignore`.

## 2. Set these on Render (API) for production

In **Render Dashboard** → your **clockinn-api** service → **Environment**:

| Variable | Value | Notes |
|----------|--------|--------|
| `ENVIRONMENT` | `prod` | Enables HTTPS redirect, HSTS, safe error messages. |
| `COOKIE_SECURE` | `true` | Required so refresh cookie is sent only over HTTPS. |
| `CORS_ORIGINS` | `https://your-app.vercel.app` | Your real frontend URL (no trailing slash). |
| `FRONTEND_URL` | `https://your-app.vercel.app` | Same as above. |
| `DATABASE_URL` | *(your Supabase connection string)* | Use Supabase pooler URL if applicable. |
| `SECRET_KEY` | *(strong random string)* | e.g. `openssl rand -hex 32`. |
| `RUN_MIGRATIONS` | `true` | If you want Render to run migrations on deploy (optional; can run manually). |

If `server/render-start.sh` is used as the start command, ensure that script exists in the repo and runs migrations when `RUN_MIGRATIONS=true`, then starts the app.

## 3. Set these on Vercel (frontend) for production

In **Vercel** → your project → **Settings** → **Environment Variables**:

| Variable | Value |
|----------|--------|
| `NEXT_PUBLIC_API_URL` | `https://your-api.onrender.com` (or your API URL) |

Use **HTTPS** for the API URL in production.

## 4. After first deploy or after changing env

- [ ] Open the **frontend** URL and log in — confirm redirect and cookies work.
- [ ] If you use **HTTPS** on the API, confirm **COOKIE_SECURE=true** so the refresh cookie is sent.
- [ ] Run through one critical path (e.g. login → dashboard → punch or schedule).

## 5. Optional: check before each push

```bash
git status
# Ensure no .env or gmail_token.json or gmail_credentials.json are staged
git diff --cached --name-only
```

If anything sensitive appears in `--cached`, unstage it: `git reset HEAD -- <file>`.
