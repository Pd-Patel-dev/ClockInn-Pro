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
