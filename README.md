# ClockInn-Pro

Hey! This is a side project I've been working on - a time tracking and payroll app. Nothing fancy, just something to help small businesses handle employee hours and paychecks without spending a fortune on expensive software.

## What it does

Basically, employees can clock in and out, request time off, and see their schedule. Admins can manage everyone, approve requests, create shifts, and generate payroll. Each company's data is kept separate so multiple businesses can use it.

Stuff that works:

- Clock in/out with email or a PIN
- Schedule shifts on a calendar (supports overnight shifts too)
- Request time off and get it approved/rejected
- Generate payroll for weekly or biweekly periods
- Export reports as PDF or Excel
- Track hours, breaks, and overtime

## Tech stack

**Backend**: FastAPI (Python), PostgreSQL, SQLAlchemy for the database stuff

**Frontend**: Next.js with TypeScript and Tailwind

I used Docker Compose to make it easier to run everything locally.

## Repository layout

### `server/`

FastAPI app: **`app/main.py`**, **`app/api/v1/router.py`** wires routers; **`app/models/`** (SQLAlchemy: User, Company, TimeEntry, Session, payroll, shifts, cash drawer, shift notes, etc.); **`app/services/`** business logic; **`app/schemas/`** Pydantic; **`app/core/`** (config, security, DB, rate limit, permissions); **`app/middleware/`**; **`app/pdf_templates/`**; **`alembic/`** migrations; **`tests/`**; **`scripts/`** (seed, migrate).

**One-off scripts at `server/` root** (not imported by the running API): **`create_developer_supabase.py`** and **`create_developer_account.py`**. They bootstrap a developer user against `DATABASE_URL`; use env `DEVELOPER_INITIAL_PASSWORD` or a generated password—see each file’s docstring. Do not treat them as part of `app/`.

**Largest modules under `server/app/`** (approximate line counts; run `wc -l` or your IDE to refresh):

| Lines | File |
|------:|------|
| 1073 | `services/email_service.py` |
| 814 | `api/v1/endpoints/time.py` |
| 726 | `services/payroll_service.py` |
| 650 | `api/v1/endpoints/payroll.py` |
| 644 | `services/export_service.py` |
| 618 | `services/shift_service.py` |
| 591 | `api/v1/endpoints/developer.py` |
| 585 | `services/cash_drawer_service.py` |
| 572 | `services/user_service.py` |
| 524 | `services/shift_note_service.py` |

### `client/`

Next.js App Router: **`app/`** pages; **`components/`** shared UI; **`lib/`** (`api.ts`, `auth.ts`, `tokenManager.ts`); **`hooks/`**; **`config/navigation.ts`**; **`middleware.ts`**.

**Largest TS/TSX files** (approximate):

| Lines | File |
|------:|------|
| 1604 | `app/settings/page.tsx` |
| 1085 | `app/kiosk/[slug]/page.tsx` |
| 968 | `app/employees/[id]/page.tsx` |
| 939 | `app/schedules/page.tsx` |
| 832 | `app/punch-in-out/page.tsx` |
| 826 | `app/developer/page.tsx` |
| 728 | `app/admin/shift-log/page.tsx` |
| 675 | `app/punch/page.tsx` |
| 611 | `app/schedules/week/page.tsx` |
| 569 | `app/time-entries/page.tsx` |

**Windows:** Git or tools may show paths as `client\app\...` or `client/app/...`—they are the same files. Avoid editing the same file twice because of duplicate spellings in search results.

More detail: **[docs/CLOCKINN_PRO_FULL_EXAMINATION_REPORT.md](docs/CLOCKINN_PRO_FULL_EXAMINATION_REPORT.md)**.

### User model (quick reference)

Defined in **`server/app/models/user.py`**.

- **Roles:** `UserRole` enum (ADMIN, MANAGER, DEVELOPER, MAINTENANCE, FRONTDESK, HOUSEKEEPING, RESTAURANT, SECURITY)—not just “admin vs employee”.
- **PIN:** stored as **`pin_hash`** (Argon2); kiosk/punch verifies against the hash.
- **Pay:** **`pay_rate_cents`** is the primary field for payroll; **`pay_rate`** is legacy. **`PayRateType`** is currently HOURLY. No separate employee contract table.
- **Tenant isolation:** each user has **`company_id`**; email is unique per company (`uq_user_company_email`).

Full field list and relationships: see the `User` class in that file.

## Getting it running

### Docker (easiest way)

```bash
docker-compose up -d
docker-compose exec api alembic upgrade head
docker-compose exec api python -m scripts.seed_data
```

Then go to http://localhost:3000. API docs are at http://localhost:8000/docs.

**Migrations:** Run `docker-compose exec api alembic upgrade head` after pulling new code that adds migrations (e.g. shift notes, RLS). Optional: set `RUN_MIGRATIONS=true` in your `.env` to run migrations automatically when the API container starts.

### Without Docker

**Backend:**

```bash
cd server
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
python -m scripts.seed_data
uvicorn main:app --reload
```

**Frontend:**

```bash
cd client
npm install
npm run dev
```

## Setup

You'll need a `.env` file. Copy `.env.example` to `.env` and fill in:

- `DATABASE_URL` - Your PostgreSQL connection string
- `SECRET_KEY` - Random string for JWT (I used `openssl rand -hex 32` to generate one)
- `FRONTEND_URL` and `CORS_ORIGINS` - Your frontend URL
- `NEXT_PUBLIC_API_URL` - Backend API URL

To use **Supabase** as the database instead of local Postgres, see **[docs/MIGRATE_TO_SUPABASE.md](docs/MIGRATE_TO_SUPABASE.md)**.

## Backend tests (Docker)

Pytest uses database name **`clockinn_test`** with the **same user and password** as your app `DATABASE_URL` (not a separate `clockinn_test` user).

- **New compose volumes:** `docker/postgres/docker-entrypoint-initdb.d/02-clockinn-test.sql` creates `clockinn_test` on first Postgres init.
- **Existing `postgres_data` volume:** create the DB once:
  ```bash
  docker compose exec db psql -U clockinn -d postgres -c "CREATE DATABASE clockinn_test;"
  ```
  (Use your `POSTGRES_USER` if it is not `clockinn`.)

From the repo root:

```bash
docker compose exec api python -m pytest -q
```

## Sample data

The seed script creates a demo company with:

- Admin: `admin@demo.com` (password is in the seed script)
- Employees: `john@demo.com`, `jane@demo.com`, `bob@demo.com` with PINs 1234, 5678, 9012

## Features

**Shifts**: Create schedules on a calendar view. Each employee gets their own color so it's easy to see who's working when. You can create shifts for a whole week at once, which saves time.

**Payroll**: Calculates pay based on hours worked, handles overtime, and you can export it as PDF or Excel.

**Time tracking**: Tracks clock ins, clock outs, breaks, and calculates hours automatically.

**Leave requests**: Employees request time off, admins approve or reject it.

**Shift Notepad / Common Log**: Each shift has one continuous note (like a notepad). Employees write during their shift with autosave; admins view all notes on the Common Log page (`/admin/common-log`), filter by date/employee/status, search content, mark as reviewed, and add manager comments. Company settings control whether notes are required before clock-out and whether editing after clock-out is allowed.

## API

The backend API is at `/api/v1/`. Endpoints for auth, users, time entries, leave, shifts, payroll, reports, and shift notes. Check out `/docs` when the server is running to see everything.

## Deployment

I deployed the backend on Render and frontend on Vercel. You'll need to:

- Set up environment variables in both places
- Run migrations on the database (I used Supabase)
- Make sure CORS is configured correctly

The `render-start.sh` script runs migrations automatically when the backend starts on Render.

## Notes

- Passwords are hashed with Argon2
- JWT tokens for auth (refresh tokens rotate on use)
- Everything is scoped by company_id so data is isolated
- Logs go to `logs/server/` if you need to debug something

## Troubleshooting

### "gaierror: [Errno -3] Temporary failure in name resolution" on login

This means the app could not resolve the **database hostname** in `DATABASE_URL`. The hostname is only valid in a specific context:

- **Running with Docker Compose**  
  The API container uses the service name `db` as the host. Use:
  ```env
  DATABASE_URL=postgresql://user:password@db:5432/clockinn
  ```
  (Docker Compose sets this for the `api` service; ensure the stack is up: `docker-compose up -d`.)

- **Running the API on your machine (no Docker)**  
  The host must be reachable from your machine. Use `localhost` (or `127.0.0.1`) if Postgres is on the same machine:
  ```env
  DATABASE_URL=postgresql://user:password@localhost:5432/clockinn
  ```
  If your `.env` still has `@db:5432`, change it to `@localhost:5432`. The name `db` does not resolve outside Docker.

After changing `DATABASE_URL`, restart the API and try logging in again.

This was just a learning project, so there might be rough edges. Feel free to open issues if you find bugs!
