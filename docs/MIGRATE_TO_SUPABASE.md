# Migrate ClockInn-Pro to Supabase

This guide walks you through moving your database from Docker/local PostgreSQL to **Supabase** (hosted Postgres). The app already supports Supabase (SSL, RLS). You keep using your FastAPI backend and Next.js frontend; only the database host changes.

---

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New project**.
3. Choose organization, name (e.g. `clockinn-pro`), database password (save it), and region.
4. Wait for the project to be ready.

---

## 2. Get connection strings

In the Supabase dashboard: **Project Settings** → **Database**.

- **Direct connection** (for migrations and long-lived servers like Docker/Render):
  - **Connection string** → **URI**. Copy it; it looks like:
    ```text
    postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres
    ```
  - Or use the **Session mode** / **Direct** URI if shown (port **5432** to the pooler, or **6543** for transaction mode).
- For **direct** (non-pooler) Supabase often shows:
  ```text
  postgresql://postgres:[YOUR-PASSWORD]@db.[project-ref].supabase.co:5432/postgres
  ```
  Use this for running migrations and for the API when it runs in Docker or on a single server.

Replace `[YOUR-PASSWORD]` with your database password. If the password has special characters, URL-encode them (e.g. `@` → `%40`).

---

## 3. Run migrations on Supabase

Migrations create all tables (including shift_notes, cash_drawer, RLS, etc.) on the empty Supabase database.

### Option A: From your machine (recommended first time)

1. **Temporarily point** `DATABASE_URL` to Supabase (in `server/.env` or project root `.env` used by the server):
   ```env
   DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[project-ref].supabase.co:5432/postgres
   ```
2. From the **server** directory (where `alembic.ini` lives), run:
   ```bash
   cd server
   alembic upgrade head
   ```
   Use the same env that loads `DATABASE_URL` (e.g. activate venv and ensure `.env` is loaded, or set `DATABASE_URL` in the shell).

### Option B: Using Docker

1. In project root `.env` (or env used by Docker), set:
   ```env
   DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[project-ref].supabase.co:5432/postgres
   ```
2. Run migrations inside the API container (no need to start Postgres in Docker):
   ```bash
   docker-compose run --rm api alembic upgrade head
   ```
   `docker-compose run` uses the same `DATABASE_URL` as the `api` service.

### Option C: Using Supabase CLI

Use this if you want to apply migrations with the **Supabase CLI** (`supabase db push`). Migrations live in `server/supabase/migrations/` as SQL files (including shift_notes tables, permissions, and RLS).

1. **Install Supabase CLI** (if needed):  
   [Install guide](https://supabase.com/docs/guides/cli/getting-started) (e.g. `npm i -g supabase` or Windows: `scoop install supabase`).

2. **Link your remote project** (one-time). From the repo root:
   ```bash
   cd server
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```
   When prompted, enter your **database password** (Supabase Dashboard → Project Settings → Database).  
   Find **YOUR_PROJECT_REF** in the dashboard URL or under **Settings → General → Reference ID**.

3. **Push migrations** to the linked Supabase database:
   ```bash
   supabase db push
   ```
   This applies all pending SQL files in `server/supabase/migrations/` in order (including the latest shift_notes and RLS migrations).

**From project root** you can use the global `--workdir` flag:
```bash
supabase link --workdir server --project-ref YOUR_PROJECT_REF
supabase db push --workdir server
```

**Note:** The app also uses **Alembic** (Python migrations in `server/alembic/versions/`). For this project, `server/supabase/migrations/` is kept in sync with the schema (shift_notes, permissions, RLS). Use either **Alembic** (Option A/B) or **Supabase CLI** (Option C), not both, for the same database to avoid duplicate or conflicting migrations.

---

## 4. Seed data or migrate existing data

**Fresh start (no existing data to keep):**

```bash
# From host (with DATABASE_URL pointing to Supabase)
cd server && python -m scripts.seed_data

# Or with Docker
docker-compose run --rm api python -m scripts.seed_data
```

**You have existing data in Docker/local Postgres:**

Use the data migration script to copy data into Supabase:

```bash
cd server
# Source = current local/Docker DB, Target = Supabase
python scripts/migrate_to_supabase.py \
  --source "postgresql://clockinn:YOUR_LOCAL_PASSWORD@localhost:5432/clockinn" \
  --target "postgresql://postgres:YOUR_SUPABASE_PASSWORD@db.xxxxx.supabase.co:5432/postgres"
```

Run this **after** migrations have already been applied to Supabase (step 3). The script uses `DATABASE_URL` from env for one of the endpoints if you don’t pass both; see `scripts/migrate_to_supabase.py` for full usage.

---

## 5. Point the app to Supabase

### Local / Docker

In the **same `.env`** used when starting the API (root or `server/`):

```env
# Supabase (use your project’s direct URI)
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[project-ref].supabase.co:5432/postgres
```

- **Docker:** Ensure `docker-compose` reads this `.env` (it does by default). Then:
  ```bash
  docker-compose up -d
  ```
  You can **omit** the `db` service if you no longer need local Postgres, or leave it for local dev and switch `DATABASE_URL` per environment.

### Production (e.g. Render)

In Render **Environment** for the API service, set:

- `DATABASE_URL` = your Supabase **direct** connection string (same as above).

For serverless or high connection count, you can use Supabase **connection pooler** (Transaction mode, port 6543):

```env
DATABASE_URL=postgresql://postgres.[project-ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
```

Use the pooler URI from the Supabase dashboard (Database → Connection string → Transaction mode).

---

## 6. Optional: Docker Compose without local Postgres

If you only use Supabase and don’t need a local Postgres container:

1. In `docker-compose.yml`, comment out or remove the `db` service and the `api` `depends_on: db`.
2. Set `DATABASE_URL` in `.env` to your Supabase URI (step 5).
3. Run:
   ```bash
   docker-compose up -d
   docker-compose exec api alembic upgrade head   # if not already run
   ```

---

## 7. Verify

- Open the app (e.g. http://localhost:3000), log in (or register), and use core flows (punch, schedules, shift notes).
- In Supabase: **Table Editor** to see tables and data; **Database** → **Migrations** if you use Supabase’s migration tracking (optional; Alembic is the source of truth for this app).

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| **SSL required** | The app and Alembic already enable SSL when the URL contains `supabase.co` or `pooler.supabase.com`. Use the Supabase URI as above. |
| **Connection refused / timeout** | Use the **direct** URI (`db.xxx.supabase.co:5432`) for migrations and for the API. Ensure IP is allowed (Supabase Dashboard → Database → Connection pooling / Network). |
| **Migrations fail (relation exists)** | If you ran migrations twice or created tables manually, check `alembic_version` and fix or reset. Prefer a fresh Supabase project for a clean migration run. |
| **Docker: “name resolution” for `db`** | You’re still using `DATABASE_URL=...@db:5432/...` while the API runs in Docker. Switch `DATABASE_URL` to the Supabase URI so the API connects to Supabase, not to a `db` hostname. |

---

## Summary

1. Create a Supabase project and copy the **direct** Postgres URI.
2. Set `DATABASE_URL` to that URI and run `alembic upgrade head` (from host or `docker-compose run --rm api alembic upgrade head`).
3. Seed data or run `scripts/migrate_to_supabase.py` if you have existing data.
4. Point the app (local/Docker and production) at Supabase by setting `DATABASE_URL` everywhere the API runs.
5. Optionally remove the local `db` service from Docker if you no longer need it.

Your app continues to use **your own auth (JWT + refresh cookie)** and **company-scoped access**; Supabase is used only as the Postgres host.
