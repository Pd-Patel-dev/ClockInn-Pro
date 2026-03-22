# ClockInn-Pro — Security Review

This document summarizes security-related findings from a full-app review. Address high/critical items first; medium/low can be scheduled as improvements.

---

## Critical / High

### 1. **Cookie `Secure` flag in production**
- **Where:** `server/app/core/config.py` — `COOKIE_SECURE: bool = False`; `server/app/api/v1/endpoints/auth.py` — `_set_refresh_cookie` uses it.
- **Risk:** If the app is served over HTTPS but `COOKIE_SECURE` is left `False`, the refresh token cookie can be sent over HTTP (e.g. mixed content or redirect), enabling interception.
- **Recommendation:** Set `COOKIE_SECURE=true` in production (and ensure `ENVIRONMENT=production` or equivalent so the app knows it’s production). Optionally set it to `True` when `FRONTEND_URL` (or a similar env) starts with `https://`.

### 2. **Default developer password in code**
- **Where:** `server/create_developer_supabase.py` — `default_password = "Dev@2024ChangeMe!"`.
- **Risk:** Anyone with repo access can log in as a developer if the script was run and the password was never changed.
- **Recommendation:** Generate a random password at runtime (e.g. `secrets.token_urlsafe(16)`) and print it once; or require a CLI argument/env var for the initial password. Do not commit a fixed default.

### 3. **Kiosk / punch PIN brute force**
- **Where:** Kiosk `POST /kiosk/check-pin` and `POST /kiosk/clock`; `/time/punch` (email + PIN). No rate limiting on PIN attempts.
- **Risk:** 4-digit PIN = 10,000 possibilities. Attackers can try many PINs per minute; login rate limit does not apply to these endpoints.
- **Recommendation:** Add rate limiting for PIN attempts (e.g. per IP and/or per `company_slug`): lockout after N failed attempts (reuse `PIN_ATTEMPTS_LIMIT` / `LOCKOUT_DURATION_MINUTES` or similar). Consider lockout per (IP, company_slug) to avoid one company blocking others.

### 4. **Email enumeration on public punch** *(addressed)*
- **Where:** `POST /time/punch` returned `"Employee not found"` when email is not in DB.
- **Risk:** Attackers could probe whether an email exists in the system.
- **Fix:** Public punch path now returns `401` with generic `"Invalid email or PIN"` for: unknown email, wrong PIN, and PIN not configured. No distinction between “user not found” and “wrong PIN” (`server/app/api/v1/endpoints/time.py`, `server/app/services/time_entry_service.py`).

---

## Medium

### 5. **Access token in `localStorage`** *(trade-off documented)*
- **Where:** `client/lib/api.ts` — access token stored in `localStorage` (refresh token is HttpOnly cookie).
- **Risk:** Any XSS can read `localStorage` and steal the access token; refresh token is not readable by JS.
- **Mitigations in place:** Short access token lifetime (15 min); refresh token in HttpOnly cookie; no long-term secrets depend solely on the access token. Full trade-off, risk, and mitigations (CSP, sanitization, SPA alternatives) are documented in the **JSDoc block** above `accessToken` in `client/lib/api.ts`.

### 6. **No global API rate limiting** *(addressed)*
- **Where:** `app/middleware/rate_limit.py` + `main.py` — sliding-window limits per client IP (`get_client_ip`: `X-Forwarded-For`, `X-Real-IP`, then `request.client.host`).
- **Behavior:** `RATE_LIMIT_PER_MINUTE` (default 60) for most `/api/v1/*` routes; stricter `RATE_LIMIT_AUTH_KIOSK_PER_MINUTE` (default 30) for `/api/v1/auth/*` and `/api/v1/kiosk/*` (each request counts toward both caps). Exempt: `/api/v1/health` (except `/health/test-error`), `/docs`, `/openapi.json`, `/redoc`, and **HTTP OPTIONS** (CORS preflight). Toggle with `RATE_LIMIT_ENABLED`.
- **Limits:** In-memory only — not shared across workers/instances (same class of issue as login lockout #7); use Redis-backed limits in production if you scale horizontally.
- **Recommendation (remaining):** Add PIN / kiosk-specific attempt limits (#3) in addition to this IP cap.

### 7. **Login lockout is in-memory** *(optional Redis)*
- **Where:** `server/app/core/login_attempts.py` — in-process dict by default; **Redis** when `REDIS_URL` is set (e.g. `redis://redis:6379/0`).
- **Behavior:** Keys `clockinn:login_attempts:{normalized_email}` (or `{email}|{ip}` if `LOGIN_LOCKOUT_USE_IP=true`). TTL on Redis keys prevents unbounded growth. `close_login_attempts_redis()` runs on app shutdown.
- **Risk without Redis:** Multiple instances or restarts still lose lockout coherence (each worker has its own memory store).
- **Recommendation:** Set `REDIS_URL` in production when running more than one API replica. Optionally enable `LOGIN_LOCKOUT_USE_IP` to scope lockout per IP (trade-off documented in `login_attempts.py`).

### 8. **Refresh token in request body**
- **Where:** `auth.py` — refresh endpoint accepts refresh token from cookie or from request body (`refresh_data.refresh_token`).
- **Risk:** If clients send refresh token in body, it may be logged (e.g. in proxies or app logs) and is more exposed than cookie.
- **Recommendation:** Prefer cookie-only for refresh; deprecate body parameter and remove once all clients use cookies.

### 9. **`delete_cookie` may not clear cookie on all browsers** *(addressed)*
- **Where:** `auth.py` — `_clear_refresh_cookie` shared scope with `_set_refresh_cookie` via `_refresh_cookie_scope_kwargs()` (`path`, `secure`, `httponly`, `samesite`, optional `COOKIE_DOMAIN`).
- **Risk:** If cookie was set with `Secure` and `SameSite`, some browsers require the same attributes on delete to clear it.
- **Fix:** `delete_cookie` now passes the same scope as `set_cookie`.

### 10. **Sensitive data in error messages** *(addressed)*
- **Where:** Previously various services/endpoints returned `str(e)` in HTTP `detail`; CLI script printed exceptions; `ENVIRONMENT` was read ad hoc via `os.getenv`.
- **Risk:** Information disclosure helps attackers (e.g. DB or paths).
- **Fix:** `settings.ENVIRONMENT` + `app.core.environment.is_production_environment()`; `@handle_endpoint_errors` already sanitized unhandled exceptions; **global `Exception` handler** in `main.py` returns a generic 500 body in production and logs server-side; **`client_error_detail()`** in `error_handling.py` for intentional HTTP 500s that previously embedded `str(e)` (e.g. `user_service`, `leave_service`, `time_entry_service`, `gmail`, `admin`, `cash_drawer`, `auth` set-password); **`/health/test-error` disabled in production**; **`create_developer_supabase.py`** logs full traceback, prints a generic message, exits 1.

---

## Low / Informational

### 11. **CORS** *(addressed)*
- **Status:** CORS uses an explicit list of origins (no `*` with credentials). Good.
- **Recommendation:** Ensure production `CORS_ORIGINS` only lists trusted front-end origins.
- **Fix:** `config.py` rejects `*` on startup. When `ENVIRONMENT` is `production` or `prod`, each `CORS_ORIGINS` entry must be `https://` unless it is `localhost` or `127.0.0.1` (so production cannot accidentally use `http://` public origins). `.env.example` documents comma-separated / multi-origin HTTPS lists.

### 12. **Security headers**
- **Status:** Middleware sets `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`; HSTS in production when forwarded over HTTPS. Good.
- **Recommendation:** Consider adding Content-Security-Policy (CSP) and tightening Permissions-Policy as needed.

### 13. **Password and PIN hashing**
- **Status:** Argon2 for passwords and PINs. Strong.
- **Recommendation:** Keep default Argon2 parameters; no change needed.

### 14. **JWT validation**
- **Status:** Access token validated with `type=access`, `sub` (user id), and user existence/active status. Algorithm fixed (no “alg” downgrade). Good.
- **Recommendation:** Ensure `SECRET_KEY` is strong and not committed; rotate if ever exposed.

### 15. **Company and tenant isolation**
- **Status:** Admin/employee endpoints consistently scope by `current_user.company_id` (users, time entries, payroll, shifts, etc.). Developer endpoints are developer-only. Good.
- **Recommendation:** Continue to add `company_id` (or equivalent) checks to any new admin/tenant-scoped APIs.

### 16. **SQL / injection**
- **Status:** Queries use SQLAlchemy ORM and parameterized conditions; search uses bound parameters (e.g. `term = f"%{search.strip()}%"` passed as param). No raw SQL concatenation observed.
- **Recommendation:** Keep using parameterized queries and avoid building SQL with string formatting.

### 17. **XSS**
- **Status:** Schedules page uses `escapeHtml` for user-supplied text in print context; comments warn against `dangerouslySetInnerHTML` with unsanitized data. No obvious unsafe `dangerouslySetInnerHTML` with user input.
- **Recommendation:** Continue to escape/sanitize all user-controlled content when rendering; consider a CSP to reduce impact of any future XSS.

### 18. **Public and semi-public endpoints**
- **Status:** Login, register, refresh, logout, kiosk (info, check-pin, clock), `/time/punch` (email+PIN) are public by design. Kiosk is protected by network allowlist and (when enabled) geofence.
- **Risk:** These are the main attack surface (brute force, enumeration).
- **Recommendation:** Harden with rate limiting (#3, #6) and generic error messages (#4).

### 19. **Geofence and kiosk network**
- **Status:** Geofence uses haversine distance; kiosk network uses IP allowlist (with proxy headers). Logic is server-side.
- **Recommendation:** Ensure reverse proxy is configured so `X-Real-IP` / `CF-Connecting-IP` / `X-Forwarded-For` are trustworthy (or strip them if not from a trusted proxy).

### 20. **Supabase / RLS**
- **Status:** Migrations enable RLS on some tables (e.g. shift_notes). Application uses a single DB user and enforces authorization in the API layer.
- **Recommendation:** If Supabase is used with multiple roles or direct client access, ensure RLS policies match API rules (e.g. company_id scoping). If the API is the only client, RLS is an extra layer of defense.

---

## Checklist summary

| Priority   | Item                                      | Action |
|-----------|-------------------------------------------|--------|
| Critical  | `COOKIE_SECURE` in production             | Set `COOKIE_SECURE=true` when on HTTPS |
| Critical  | Default developer password in code        | Use random password or env/CLI; never commit default |
| High      | Kiosk/PIN brute force                     | Add rate limiting for PIN attempts (per IP/company) |
| High      | Email enumeration on `/time/punch`       | Done — generic “Invalid email or PIN” |
| Medium    | Access token in localStorage             | Done — documented in api.ts; short expiry, HttpOnly refresh |
| Medium    | No global API rate limit                  | Done — `RateLimitMiddleware` + `RATE_LIMIT_*` settings |
| Medium    | Login lockout in-memory                   | Optional — set `REDIS_URL` for shared store across replicas |
| Medium    | Refresh token in body                     | Prefer cookie-only; deprecate body |
| Medium    | delete_cookie attributes                  | Match cookie’s Secure/SameSite when clearing |
| Low       | Error messages in production              | No stack traces or internals in responses |

---

*Generated from a full-app security review. Re-run after major changes or before production go-live.*
