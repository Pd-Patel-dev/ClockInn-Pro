# ClockInn-Pro — Security & Safety Audit

This document summarizes security-related findings across the application (backend API, frontend, configuration, and operations). Use it to prioritize hardening and compliance.

---

## 1. Authentication & Session Management

### ✅ Good practices

- **Password hashing**: Passwords are hashed with **Argon2** via `passlib` (`CryptContext(schemes=["argon2"])`). No plaintext storage.
- **PIN hashing**: Kiosk PINs use the same Argon2 context.
- **Login rate limiting**: Failed login attempts are tracked per email; lockout after `LOGIN_ATTEMPTS_LIMIT` (default 5) for `LOCKOUT_DURATION_MINUTES` (default 10). Implemented in `server/app/core/login_attempts.py`.
- **Timing attack mitigation**: On unknown email, password is verified against a dummy hash so response time does not reveal whether the email exists.
- **Refresh token handling**: Refresh tokens are hashed before storage; reuse detection revokes all sessions for that user.
- **JWT**: Access and refresh tokens are signed with `SECRET_KEY` and `ALGORITHM` (HS256). Token type and expiration are validated.
- **Password strength**: `validate_password_strength` enforces length, upper/lower/digit/special character rules.
- **Email normalization**: Emails are normalized (lowercase, trim) before lookup and storage.

### ⚠️ Recommendations

| Issue | Location | Recommendation |
|-------|----------|----------------|
| **~~Tokens in `localStorage`~~** ✅ **Implemented** | ~~`client/lib/api.ts`, `client/lib/auth.ts`~~ | **Refresh token** is now stored in an **HttpOnly, Secure, SameSite cookie** set by the backend; the client never reads or writes it. **Access token** remains in memory and `localStorage` (for persistence across reloads) and is sent in the `Authorization` header. For maximum XSS protection, the access token could also be moved to an HttpOnly cookie and read server-side. |
| **~~JWT `sub` type in DB query~~** ✅ **Implemented** | ~~`server/app/core/dependencies.py` (`get_current_user`)~~ | `user_id` from JWT is now parsed with `uuid.UUID(str(user_id))`; `ValueError`/`TypeError`/`AttributeError` are caught and return 401 "Invalid token payload" instead of 500. |
| **~~Long-lived refresh tokens~~** ✅ **Implemented** | ~~`server/app/core/config.py`~~ | **Sliding expiration**: each refresh token is valid for `REFRESH_TOKEN_EXPIRE_DAYS` (default 7) from issue. **Absolute max**: session cannot exceed `REFRESH_TOKEN_ABSOLUTE_MAX_DAYS` (default 30) from first login. `session_start` is stored in the refresh token payload and enforced on refresh. |

---

## 2. Authorization & Access Control

### ✅ Good practices

- **Role-based access**: `get_current_admin`, `get_current_developer`, `require_role`, and `require_permission` enforce role/permission checks.
- **Company scoping**: Endpoints pass `current_user.company_id` into services; data is filtered by company (e.g. `get_shift(db, shift_id, current_user.company_id)`).
- **Permission service**: Fine-grained permissions (e.g. `shift_note:view:self`) are checked via `user_has_permission` before sensitive operations.
- **Employee vs own data**: Non-admin employees are restricted to their own shifts/time entries where applicable.

### ⚠️ Recommendations

| Issue | Location | Recommendation |
|-------|----------|----------------|
| **~~Audit all path params~~** ✅ **Verified** | All `*_id` path parameters | All endpoints that take an entity ID in the path now validate it with `parse_uuid()` (400 + clear message for invalid UUID) and scope by `company_id` via company-scoped services. Cash drawer `session_id` was updated to use `parse_uuid`; shifts, payroll, users, time, leave, shift_notes already followed the pattern. |
| **~~Developer / admin routes~~** ✅ **Addressed** | ~~`server/app/api/v1/endpoints/developer.py`~~ | All developer routes already use `get_current_developer` (DEVELOPER role only). Responses were trimmed: no `secret_key_configured` name (now `auth_configured`), no Gmail token expiry/source/sender, no `database_info` (host/port), no CORS origins list or `frontend_url`, no token-expire or rate-limit values; only high-level booleans (`database_configured`, `email_configured`, `auth_configured`, `cors_configured`, `email_operational`). Database error message no longer returned in response. |

---

## 3. Input Validation & Injection

### ✅ Good practices

- **Pydantic schemas**: Request bodies and query parameters are validated via Pydantic (type and constraints).
- **UUID parsing**: `parse_uuid()` in `server/app/core/error_handling.py` is used for path/query IDs and returns 400 on invalid UUIDs.
- **No raw SQL with user input**: Queries use SQLAlchemy ORM or `text("SELECT 1")` / fixed strings; no string formatting of user input into SQL.
- **XSS**: The only `innerHTML` usage found (`client/app/schedules/page.tsx`) is inside `escapeHtml()` which sets `textContent` then reads `innerHTML` (i.e. escaping), not rendering raw user input.

### ⚠️ Recommendations

| Issue | Location | Recommendation |
|-------|----------|----------------|
| **~~Shift notes / free text~~** ✅ **Verified** | Shift note content, comments | All user-supplied text (shift note content, preview, comments, leave review_comment) is rendered as **React text content** (e.g. `{content}` in JSX), so it is escaped by default. The only HTML injection is in `schedules/page.tsx` print view, which uses `escapeHtml()` (textContent → innerHTML) for employee names and titles. **No `dangerouslySetInnerHTML`** is used anywhere. Comments added at render sites to avoid introducing raw HTML in future. |
| **~~File paths~~** ✅ **Documented** | ~~`server/app/services/email_service.py`~~ | Gmail token/credentials paths are built from `Path(__file__).resolve().parent` (server root) only — no user input. Module docstring and helper `_gmail_server_root()` document that any future file paths must be from config/env only and validated (e.g. resolved, no path traversal). |

---

## 4. Sensitive Data & Logging

### ✅ Good practices

- **No passwords in logs**: Login attempt logging uses redacted email (`normalized_email[:3] + "***"`).
- **JWT errors**: Security module logs JWT decode errors at `debug` level without token content.
- **`.env` and secrets**: `.env`, `.env.local`, `gmail_credentials.json`, and `gmail_token.json` are in `.gitignore`.

### ⚠️ Recommendations

| Issue | Location | Recommendation |
|-------|----------|----------------|
| **~~Gmail token in logs~~** ✅ **Fixed** | ~~`server/app/services/email_service.py`~~ | Token snippet removed; on refresh we log only a single safe message. |
| **~~Error details to client~~** ✅ **Addressed** | ~~`server/app/core/error_handling.py`~~ | In production, the generic handler never returns exception text or stack traces: 500 responses use a fixed message; ValueError responses use "Invalid input." instead of str(e). Detailed messages only when ENVIRONMENT is not prod/production. |
| **~~Developer endpoint~~** ✅ **Verified** | Developer config/status responses | Responses return only booleans (e.g. `auth_configured`, `email_configured`); no `SECRET_KEY` or actual token values are ever returned. |

---

## 5. HTTP & Transport Security

### ✅ Good practices

- **Security headers** (`server/main.py`): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restricting geolocation/mic/camera.
- **CORS**: Configured from `settings.CORS_ORIGINS`; `*` is rejected when using credentials (must set explicit origins).
- **No mixed content**: API URL is from `NEXT_PUBLIC_API_URL`; use HTTPS in production for both frontend and API.

### ⚠️ Recommendations

| Issue | Location | Recommendation |
|-------|----------|----------------|
| **~~HTTPS enforcement~~** ✅ **Addressed** | App / reverse proxy | When `ENVIRONMENT` is prod/production, the app (1) redirects HTTP→HTTPS (301) using `X-Forwarded-Proto`/`X-Forwarded-Host`, (2) sets **Strict-Transport-Security** on HTTPS responses. **Recommended**: enforce HTTPS and HSTS at the reverse proxy (Nginx, cloud load balancer) and set `X-Forwarded-Proto`/`X-Forwarded-Host`; see *Production HTTPS* below. |
| **~~CORS in production~~** ✅ **Addressed** | ~~`server/app/core/config.py`~~ | Config rejects `CORS_ORIGINS='*'` at startup (invalid with `allow_credentials=True`). Set explicit origin(s) e.g. `https://app.example.com`. |

**Production HTTPS (reverse proxy)**  
Configure your reverse proxy to terminate TLS and redirect HTTP→HTTPS. Example (Nginx) for API and optional frontend:

```nginx
# Redirect HTTP to HTTPS
server { listen 80; server_name api.example.com; return 301 https://$host$request_uri; }
server {
  listen 443 ssl http2;
  server_name api.example.com;
  ssl_certificate /path/to/fullchain.pem;
  ssl_certificate_key /path/to/privkey.pem;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
  }
}
```

Set `ENVIRONMENT=prod` (or `production`) and `COOKIE_SECURE=true` when using HTTPS.

---

## 6. Configuration & Secrets

### ✅ Good practices

- **`SECRET_KEY` required**: No default in config; app will not start without it.
- **Database URL**: From environment; not hardcoded.
- **Gmail credentials**: Optional env vars; sensitive files gitignored.

### ⚠️ Recommendations

| Issue | Location | Recommendation |
|-------|----------|----------------|
| **~~Default algorithm~~** ✅ **Acknowledged** | ~~`server/app/core/config.py`~~ | `ALGORITHM = "HS256"` is acceptable. Comment added: for very high security, consider RS256 with key rotation (would require key-pair generation and verification using public key). |
| **~~`.env.example`~~** ✅ **Verified** | Repo | No real secrets; only variable names and safe placeholders. Header and optional vars documented. |

---

## 7. Multi-Tenancy & Database

### ✅ Good practices

- **Company-scoped queries**: Services accept `company_id` and filter by it; API layer passes `current_user.company_id`.
- **RLS (Row Level Security)**: Migrations enable RLS on public tables (e.g. `025_enable_rls_on_public_tables.py`). Ensure policies align with app-level company/role checks.

### ⚠️ Recommendations

| Issue | Location | Recommendation |
|-------|----------|----------------|
| **~~RLS policies~~** ✅ **Documented** | Supabase/Postgres | RLS enabled with permissive policies; company isolation is in the app layer. If RLS scoping is added, use current_setting and match app rules. See migration 025 docstring. |
| **~~Login rate limit storage~~** ✅ **Acknowledged** | `server/app/core/login_attempts.py` | In-memory dict is acceptable for single-instance; resets on restart. For production with multiple API instances, use Redis (or similar) for shared rate-limit state. Module docstring documents this. |

**RLS vs application-layer security:** The app uses a single DB user; tenant isolation is enforced in the application via `company_id` and `current_user.company_id`. RLS is currently permissive on public tables. If company-scoping RLS is added later, set a session variable per request (e.g. `app.current_company_id`) and keep policies in sync with app rules.

---

## 8. Dependencies & Supply Chain

### Recommendations

- Run **`npm audit`** and **`pip audit`** (or `safety check`) regularly; fix high/critical issues (e.g. in CI or before releases).
- Pin dependency versions in **`requirements.txt`** / **`package.json`** and review updates for breaking or insecure changes.
- Keep Next.js and FastAPI (and their dependencies) up to date for security patches.

**Current state:** Backend dependencies are pinned in `requirements.txt` (exact versions). Frontend uses semver ranges in `package.json`; use `npm ci` and the lockfile for reproducible installs; for stricter pinning, consider exact versions or a lockfile-only workflow.

## 9. Quick Checklist

| Area | Status |
|------|--------|
| Passwords hashed (Argon2) | ✅ |
| Login rate limiting | ✅ |
| Refresh token reuse detection | ✅ |
| Company-scoped data access | ✅ |
| Path/query UUID validation | ✅ |
| No raw SQL with user input | ✅ |
| Security headers | ✅ |
| CORS configurable | ✅ |
| Secrets from environment | ✅ |
| **Refresh token in HttpOnly cookie** | ✅ |
| Tokens in localStorage | ⚠️ Access token only (refresh in cookie) |
| Gmail token in logs | ✅ Fixed |
| HTTPS enforcement | ✅ App redirect + HSTS; use reverse proxy in production |
| Rate limit shared store | ⚠️ Use Redis for multi-instance |

---

## 10. Summary

The application follows solid security practices: strong password hashing, rate limiting and lockout, company-scoped authorization, UUID validation, and safe use of the ORM. **The refresh token is now stored in an HttpOnly, Secure, SameSite cookie** so XSS cannot read it; the client sends it automatically with `credentials: 'include'`. Remaining improvements: avoid logging any part of sensitive tokens, enforce HTTPS and strict CORS in production (set `COOKIE_SECURE=true` when using HTTPS), and use a shared store for login rate limits when running multiple API instances.

*Last audit: generated from codebase review. Re-run and update this document when making significant changes or before major releases.*
