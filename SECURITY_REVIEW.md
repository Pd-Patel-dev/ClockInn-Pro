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

### 4. **Email enumeration on public punch**
- **Where:** `POST /time/punch` returns `"Employee not found"` when email is not in DB (after PIN is not yet checked).
- **Risk:** Attackers can probe whether an email exists in the system.
- **Recommendation:** Use a generic message such as `"Invalid email or PIN"` for both “user not found” and “wrong PIN” (and still verify PIN with constant-time logic where applicable).

---

## Medium

### 5. **Access token in `localStorage`**
- **Where:** `client/lib/api.ts` — access token stored in `localStorage`.
- **Risk:** Any XSS can read `localStorage` and steal the access token; refresh token is safer in HttpOnly cookie.
- **Recommendation:** Acceptable for many SPA setups; mitigate by strict CSP, sanitizing all user-generated content, and short access token lifetime (you use 15 minutes). Document the trade-off and ensure no sensitive data is only protected by the access token long-term.

### 6. **No global API rate limiting**
- **Where:** `RATE_LIMIT_PER_MINUTE` exists in config but there is no middleware applying it to the whole API.
- **Risk:** Unauthenticated and authenticated endpoints can be hammered (e.g. login, kiosk, password reset).
- **Recommendation:** Add a global rate limit (e.g. by IP) for the API, and keep stricter limits for auth and kiosk endpoints (login already has lockout; add PIN rate limit as in #3).

### 7. **Login lockout is in-memory**
- **Where:** `server/app/core/login_attempts.py` — `_attempts` dict in process memory.
- **Risk:** With multiple API instances or restarts, lockout state is lost; attackers can retry from another instance or after restart.
- **Recommendation:** For multi-instance or production, store failed attempts and lockout in a shared store (e.g. Redis) keyed by normalized email (and optionally IP if desired).

### 8. **Refresh token in request body**
- **Where:** `auth.py` — refresh endpoint accepts refresh token from cookie or from request body (`refresh_data.refresh_token`).
- **Risk:** If clients send refresh token in body, it may be logged (e.g. in proxies or app logs) and is more exposed than cookie.
- **Recommendation:** Prefer cookie-only for refresh; deprecate body parameter and remove once all clients use cookies.

### 9. **`delete_cookie` may not clear cookie on all browsers**
- **Where:** `auth.py` — `_clear_refresh_cookie` only sets `path="/"`.
- **Risk:** If cookie was set with `Secure` and `SameSite`, some browsers require the same attributes on delete to clear it.
- **Recommendation:** Use the same `secure` and `samesite` (and domain if set) when calling `response.delete_cookie(...)`.

### 10. **Sensitive data in error messages**
- **Where:** Various endpoints; e.g. `create_developer_supabase.py` and some auth paths may expose stack traces or internal details when `ENVIRONMENT` is not production.
- **Risk:** Information disclosure helps attackers (e.g. DB or paths).
- **Recommendation:** In production, never return stack traces or internal details; return generic messages and log details server-side only.

---

## Low / Informational

### 11. **CORS**
- **Status:** CORS uses an explicit list of origins (no `*` with credentials). Good.
- **Recommendation:** Ensure production `CORS_ORIGINS` only lists trusted front-end origins.

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
| High      | Email enumeration on `/time/punch`       | Return generic “Invalid email or PIN” |
| Medium    | Access token in localStorage             | Document XSS mitigations; keep short expiry |
| Medium    | No global API rate limit                  | Add middleware rate limit by IP |
| Medium    | Login lockout in-memory                   | Move to Redis (or similar) for multi-instance |
| Medium    | Refresh token in body                     | Prefer cookie-only; deprecate body |
| Medium    | delete_cookie attributes                  | Match cookie’s Secure/SameSite when clearing |
| Low       | Error messages in production              | No stack traces or internals in responses |

---

*Generated from a full-app security review. Re-run after major changes or before production go-live.*
