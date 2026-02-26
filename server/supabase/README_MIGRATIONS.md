# Running Supabase migrations

## 1. Get your project reference

- Open [Supabase Dashboard](https://app.supabase.com) and select your project.
- The **Project ref** is in the URL: `https://app.supabase.com/project/YOUR_PROJECT_REF`
- Or go to **Project Settings → General** and copy **Reference ID**.

## 2. Link the project (first time only)

From the **server** directory (where the `supabase` folder is):

```bash
cd server
supabase link --project-ref YOUR_PROJECT_REF
```

When prompted, enter your database password (the one you set for the project).

## 3. Push migrations

```bash
supabase db push
```

This runs all migrations in `supabase/migrations/` that haven’t been applied yet.

---

**If you don’t use the CLI:** run the SQL files manually in **Supabase Dashboard → SQL Editor**, in order (015 → 016 → … → 022).
