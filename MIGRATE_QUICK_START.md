# 🚀 Quick Start: Migrate to Supabase

Quick reference guide for migrating your local database to Supabase.

---

## ⚡ **Quick Steps**

### 1. Prepare Supabase
```bash
# 1. Create Supabase project at supabase.com
# 2. Get connection string from Settings → Database
# 3. Run all schema migrations (see MIGRATE_TO_SUPABASE.md)
```

### 2. Get Connection Strings

**Local Database (if using Docker):**
```bash
# Check docker-compose.yml for actual values
# Default: postgresql://clockinn:YOUR_PASSWORD@localhost:5432/clockinn
```

**Supabase:**
```bash
# From Supabase Dashboard → Settings → Database
# Direct connection: postgresql://postgres:[PASSWORD]@db.xxx.supabase.co:5432/postgres
```

### 3. Install Dependencies
```bash
cd server
pip install asyncpg python-dateutil
```

### 4. Run Migration
```bash
python scripts/migrate_to_supabase.py \
  --source "postgresql://clockinn:YOUR_PASSWORD@localhost:5432/clockinn" \
  --target "postgresql://postgres:SUPABASE_PASSWORD@db.xxx.supabase.co:5432/postgres"
```

### 5. Verify
```bash
# Check Supabase dashboard → Table Editor
# Or run verification:
python scripts/migrate_to_supabase.py \
  --target "postgresql://postgres:SUPABASE_PASSWORD@db.xxx.supabase.co:5432/postgres" \
  --verify-only
```

---

## 📋 **Before You Start**

- [ ] Supabase project created
- [ ] All schema migrations run in Supabase
- [ ] Local database running (Docker Compose)
- [ ] Connection strings ready
- [ ] Dependencies installed

---

## 🔧 **Troubleshooting**

**Connection Error?**
- Check passwords are correct
- Verify database is accessible
- Use direct connection (not pooler) for migration

**Missing Dependencies?**
```bash
pip install asyncpg python-dateutil
```

**Foreign Key Errors?**
- Ensure schema migrations are complete
- Run migrations in order
- Check Supabase SQL Editor for errors

**Need More Help?**
See `MIGRATE_TO_SUPABASE.md` for detailed instructions.

---

## ✅ **After Migration**

1. Update `DATABASE_URL` in your environment
2. Test your application
3. Verify all data migrated correctly
4. Update production environment variables

---

**Full Guide:** See `MIGRATE_TO_SUPABASE.md` for complete instructions.

