# 📦 Migrate Data to Supabase

Complete guide to migrate your local database data to Supabase.

---

## 📋 **Prerequisites**

1. **Supabase Project Created**
   - Create project at [supabase.com](https://supabase.com)
   - Note your database password and connection string

2. **Local Database Running**
   - Docker Compose database is running
   - OR local PostgreSQL is accessible

3. **Python Dependencies**
   ```bash
   pip install asyncpg psycopg2-binary python-dateutil
   ```

---

## 🔄 **Step 1: Run Schema Migrations in Supabase**

**Before migrating data, you must have the schema created in Supabase.**

### Option A: Using Supabase SQL Editor (Recommended)

1. Go to Supabase Dashboard → **SQL Editor**
2. Run each migration file in order:
   - `server/supabase/migrations/001_initial_migration.sql`
   - `server/supabase/migrations/002_add_job_role_pay_rate.sql`
   - `server/supabase/migrations/003_add_payroll_tables.sql`
   - ... (all 11 migration files)
3. Run them sequentially (one at a time)

### Option B: Using Supabase CLI

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link your project
supabase link --project-ref your-project-ref

# Push migrations
cd server
supabase db push
```

### Option C: Using Alembic (via Python)

```bash
cd server

# Set Supabase DATABASE_URL
export DATABASE_URL="postgresql://postgres:[password]@db.xxx.supabase.co:5432/postgres"

# Run migrations
alembic upgrade head
```

**⚠️ Important:** Ensure all migrations are complete before proceeding to data migration.

---

## 📤 **Step 2: Export Data from Local Database**

### 2.1 Get Database Connection Strings

**Local Database (Source):**
```bash
# If using Docker Compose
SOURCE_DATABASE_URL="postgresql://clockinn:your-password@localhost:5432/clockinn"

# Or check your docker-compose.yml for actual values
# Default: postgresql://clockinn:POSTGRES_PASSWORD@localhost:5432/clockinn
```

**Supabase Database (Target):**
```bash
# Get from Supabase Dashboard → Settings → Database → Connection String → URI
# Use direct connection (not pooler) for migration
TARGET_DATABASE_URL="postgresql://postgres:[password]@db.xxx.supabase.co:5432/postgres"

# Or use connection pooler (slower but more stable)
TARGET_DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"
```

### 2.2 Install Dependencies

```bash
cd server
pip install asyncpg python-dateutil
```

### 2.3 Run Migration Script

```bash
# Using command line arguments
python scripts/migrate_to_supabase.py \
  --source "postgresql://clockinn:password@localhost:5432/clockinn" \
  --target "postgresql://postgres:password@db.xxx.supabase.co:5432/postgres"

# Or using environment variables
export SOURCE_DATABASE_URL="postgresql://clockinn:password@localhost:5432/clockinn"
export TARGET_DATABASE_URL="postgresql://postgres:password@db.xxx.supabase.co:5432/postgres"
python scripts/migrate_to_supabase.py
```

### 2.4 What the Script Does

The migration script will:
1. ✅ Connect to both databases
2. ✅ Export data in correct order (respecting foreign keys):
   - Companies
   - Users
   - Sessions
   - Shift Templates
   - Shifts
   - Time Entries
   - Leave Requests
   - Payroll Runs
   - Payroll Line Items
   - Payroll Adjustments
   - Schedule Swaps
3. ✅ Skip existing records (prevents duplicates)
4. ✅ Handle UUIDs, datetimes, and foreign keys
5. ✅ Provide migration summary

---

## ✅ **Step 3: Verify Migration**

### 3.1 Using the Script

```bash
# Verify only (no migration)
python scripts/migrate_to_supabase.py \
  --target "postgresql://postgres:password@db.xxx.supabase.co:5432/postgres" \
  --verify-only
```

### 3.2 Using Supabase Dashboard

1. Go to Supabase Dashboard → **Table Editor**
2. Check each table has data:
   - `companies` - Should have your companies
   - `users` - Should have your users
   - `time_entries` - Should have time entries
   - `shifts` - Should have shifts
   - etc.

### 3.3 Manual Verification Queries

Run in Supabase SQL Editor:

```sql
-- Count records in each table
SELECT 'companies' as table_name, COUNT(*) as count FROM companies
UNION ALL
SELECT 'users', COUNT(*) FROM users
UNION ALL
SELECT 'time_entries', COUNT(*) FROM time_entries
UNION ALL
SELECT 'shifts', COUNT(*) FROM shifts
UNION ALL
SELECT 'leave_requests', COUNT(*) FROM leave_requests;
```

---

## 🔧 **Step 4: Alternative Method - Using pg_dump/pg_restore**

If the Python script doesn't work, you can use PostgreSQL's native tools:

### 4.1 Export from Local Database

```bash
# Export schema and data
pg_dump -h localhost -U clockinn -d clockinn \
  --no-owner --no-acl \
  --data-only \
  -f clockinn_data.sql

# Or export specific tables only
pg_dump -h localhost -U clockinn -d clockinn \
  --data-only \
  --table=companies \
  --table=users \
  --table=time_entries \
  -f clockinn_data.sql
```

### 4.2 Import to Supabase

**⚠️ Important:** Supabase uses different user/role permissions. You need to modify the SQL file:

```bash
# Remove ownership and permission statements
sed -i 's/^ALTER TABLE.*OWNER TO.*;//' clockinn_data.sql
sed -i 's/^GRANT.*;//' clockinn_data.sql
sed -i 's/^REVOKE.*;//' clockinn_data.sql

# Import to Supabase
psql "postgresql://postgres:[password]@db.xxx.supabase.co:5432/postgres" -f clockinn_data.sql
```

---

## 🔍 **Step 5: Verify Data Integrity**

### 5.1 Check Foreign Keys

```sql
-- Check for orphaned records
SELECT COUNT(*) FROM users WHERE company_id NOT IN (SELECT id FROM companies);
SELECT COUNT(*) FROM time_entries WHERE employee_id NOT IN (SELECT id FROM users);
SELECT COUNT(*) FROM shifts WHERE employee_id NOT IN (SELECT id FROM users);
```

All should return 0.

### 5.2 Check Data Consistency

```sql
-- Verify user-company relationships
SELECT c.name, COUNT(u.id) as user_count
FROM companies c
LEFT JOIN users u ON u.company_id = c.id
GROUP BY c.id, c.name;

-- Verify time entries
SELECT 
  u.name,
  u.email,
  COUNT(te.id) as entry_count,
  MIN(te.clock_in_at) as first_entry,
  MAX(te.clock_in_at) as last_entry
FROM users u
LEFT JOIN time_entries te ON te.employee_id = u.id
GROUP BY u.id, u.name, u.email;
```

### 5.3 Test Application

1. Update your backend `DATABASE_URL` to Supabase
2. Start your backend
3. Test login with migrated users
4. Verify data loads correctly

---

## ⚠️ **Troubleshooting**

### Issue: Foreign Key Violations

**Cause:** Data imported in wrong order or constraints not satisfied.

**Solution:**
1. Delete data in reverse order
2. Re-run migration script (it will skip existing records)

```sql
-- Delete in reverse dependency order (be careful!)
DELETE FROM payroll_adjustments;
DELETE FROM payroll_line_items;
DELETE FROM payroll_runs;
DELETE FROM schedule_swaps;
DELETE FROM time_entries;
DELETE FROM leave_requests;
DELETE FROM shifts;
DELETE FROM shift_templates;
DELETE FROM sessions;
DELETE FROM users;
DELETE FROM companies;
```

### Issue: UUID Conflicts

**Cause:** UUIDs already exist in Supabase.

**Solution:** The script automatically skips duplicates. If you want to force overwrite, use `--no-skip-existing` (but this may cause errors).

### Issue: Connection Timeout

**Cause:** Supabase connection pooler has limits.

**Solution:**
1. Use direct connection URL (not pooler) for migration
2. Migrate in smaller batches
3. Run migration during off-peak hours

### Issue: SSL Connection Errors

**Cause:** Supabase requires SSL.

**Solution:** The Python script handles SSL automatically. If using `pg_dump`/`psql`, add SSL parameter:

```bash
psql "postgresql://postgres:[password]@db.xxx.supabase.co:5432/postgres?sslmode=require"
```

### Issue: Migration Script Errors

**Cause:** Missing dependencies or database connection issues.

**Solution:**
1. Check all dependencies installed: `pip install asyncpg python-dateutil`
2. Verify connection strings are correct
3. Check database is accessible
4. Review error logs for specific table/column issues

---

## 📊 **Migration Checklist**

- [ ] Supabase project created
- [ ] Schema migrations run in Supabase (all 11 files)
- [ ] Local database accessible
- [ ] Connection strings ready
- [ ] Dependencies installed (`asyncpg`, `python-dateutil`)
- [ ] Migration script run successfully
- [ ] Data verified in Supabase dashboard
- [ ] Foreign keys verified (no orphaned records)
- [ ] Application tested with Supabase
- [ ] Backup of local database created (optional but recommended)

---

## 🔄 **Step 6: Switch to Supabase**

Once migration is complete and verified:

### 6.1 Update Environment Variables

**Local Development:**
```bash
# .env file
DATABASE_URL=postgresql://postgres:[password]@db.xxx.supabase.co:5432/postgres
```

**Production (Render):**
1. Go to Render Dashboard → Environment Variables
2. Update `DATABASE_URL` to Supabase connection string
3. Use connection pooler URL for production:
   ```
   postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
4. Redeploy service

### 6.2 Test Everything

1. ✅ Test registration (new company)
2. ✅ Test login (migrated users)
3. ✅ Test clock in/out
4. ✅ Test schedule creation
5. ✅ Test payroll generation
6. ✅ Test kiosk functionality

---

## 📝 **Post-Migration Notes**

### Backup Strategy

1. **Supabase Auto-Backups:** Supabase automatically backs up your database
2. **Manual Backup:** Use `pg_dump` to create manual backups
3. **Export Critical Data:** Regularly export important data (payroll, time entries)

### Monitoring

1. Monitor Supabase dashboard for:
   - Database size
   - Connection limits
   - Query performance
2. Set up alerts for:
   - Storage limits
   - Connection limits
   - Slow queries

### Performance

- Use connection pooler for production (handles connection limits)
- Monitor query performance in Supabase
- Add indexes if needed (check slow queries)

---

## 🎉 **Migration Complete!**

Your data is now in Supabase and ready for production use!

**Next Steps:**
1. Update your deployment configuration
2. Test thoroughly in production
3. Monitor performance and usage
4. Set up regular backups

---

## 📚 **Additional Resources**

- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL Migration Guide](https://www.postgresql.org/docs/current/migration.html)
- [Supabase Connection Pooling](https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooler)

---

**Need Help?** Check the troubleshooting section or review the migration script logs for specific errors.

