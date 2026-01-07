# Creating Developer Account in Production (Supabase)

This guide explains how to create the developer account (`pd.dev267@gmail.com`) in your Supabase production database.

## Prerequisites

1. **Supabase Project Setup**: Ensure your Supabase database is set up and migrations are applied
2. **Company Exists**: At least one company must exist in the database (created during registration)
3. **Developer Role**: The `DEVELOPER` role must be added to the `userrole` enum (migration `20240111500000_011_5_add_developer_role.sql` - **MUST RUN BEFORE** creating the developer account)

## Method 1: Using SQL Migration (Recommended for Supabase)

1. **Apply the migrations in order**:

   **⚠️ IMPORTANT**: You must run the DEVELOPER role migration FIRST, then the developer account migration.

   **Step 1 - Add DEVELOPER role to enum:**

   - Go to Supabase Dashboard → SQL Editor
   - Run migration: `server/supabase/migrations/20240111500000_011_5_add_developer_role.sql`

   **Step 2 - Create developer account:**

   - Run migration: `server/supabase/migrations/20240112000000_012_create_developer_account.sql`

   Or using Supabase CLI (will run all migrations in order automatically):

   ```bash
   supabase db push
   ```

   **Note**: If you already pushed migrations and only need to add the DEVELOPER role, you can run just that migration manually in Supabase SQL Editor first.

2. **Verify the account was created**:
   - Check Supabase dashboard → Table Editor → `users` table
   - Filter by email: `pd.dev267@gmail.com`
   - Verify role is `DEVELOPER` and `email_verified` is `TRUE`

## Method 2: Using Python Script (Local/Remote)

### Option A: Run Locally (Connecting to Supabase)

1. **Set environment variables**:

   ```bash
   export DATABASE_URL="postgresql://postgres:[YOUR_PASSWORD]@db.[YOUR_PROJECT_REF].supabase.co:5432/postgres"
   ```

   Or create a `.env` file:

   ```
   DATABASE_URL=postgresql://postgres:[YOUR_PASSWORD]@db.[YOUR_PROJECT_REF].supabase.co:5432/postgres
   ```

2. **Install dependencies**:

   ```bash
   cd server
   pip install -r requirements.txt
   ```

3. **Run the script**:
   ```bash
   python create_developer_account.py
   ```

### Option B: Run on Render (Production Server)

1. **SSH into your Render instance** (if available) or use Render Shell
2. **Navigate to the server directory**:

   ```bash
   cd server
   ```

3. **Run the script**:

   ```bash
   python create_developer_account.py
   ```

   Note: Environment variables should already be set in Render's dashboard.

## Method 3: Using Supabase Dashboard (Manual)

1. **Open Supabase Dashboard** → SQL Editor
2. **Run this SQL**:

```sql
-- Generate a UUID for the developer user
DO $$
DECLARE
    dev_email TEXT := 'pd.dev267@gmail.com';
    dev_email_normalized TEXT := LOWER(TRIM(dev_email));
    default_password_hash TEXT := '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5wN.8Q9P9qLZu'; -- Dev@2024ChangeMe!
    company_uuid UUID;
    existing_user_id UUID;
    new_user_id UUID := gen_random_uuid();
BEGIN
    -- Check if developer already exists
    SELECT id INTO existing_user_id
    FROM users
    WHERE email = dev_email_normalized;

    IF existing_user_id IS NOT NULL THEN
        -- Update existing user to DEVELOPER role
        UPDATE users
        SET
            role = 'DEVELOPER'::userrole,
            email_verified = TRUE,
            verification_required = FALSE,
            last_verified_at = NOW()
        WHERE id = existing_user_id;

        RAISE NOTICE 'Developer account updated: %', dev_email;
    ELSE
        -- Get first company
        SELECT id INTO company_uuid
        FROM companies
        LIMIT 1;

        IF company_uuid IS NULL THEN
            RAISE EXCEPTION 'No company found. Please create a company first.';
        END IF;

        -- Create new developer user
        INSERT INTO users (
            id,
            company_id,
            role,
            name,
            email,
            password_hash,
            status,
            email_verified,
            verification_required,
            last_verified_at,
            created_at,
            updated_at
        ) VALUES (
            new_user_id,
            company_uuid,
            'DEVELOPER'::userrole,
            'Developer Account',
            dev_email_normalized,
            default_password_hash,
            'active'::userstatus,
            TRUE,
            FALSE,
            NOW(),
            NOW(),
            NOW()
        );

        RAISE NOTICE 'Developer account created successfully!';
    END IF;
END $$;
```

## Default Credentials

- **Email**: `pd.dev267@gmail.com`
- **Password**: `Dev@2024ChangeMe!`
- **Role**: `DEVELOPER`
- **Email Verified**: `TRUE` (auto-verified)

⚠️ **IMPORTANT**: Change the password immediately after first login!

## Verifying the Account

### Via Supabase Dashboard:

1. Go to Table Editor → `users`
2. Filter by email: `pd.dev267@gmail.com`
3. Verify:
   - `role` = `DEVELOPER`
   - `email_verified` = `TRUE`
   - `verification_required` = `FALSE`
   - `status` = `active`

### Via API:

```bash
curl -X POST https://your-api.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "pd.dev267@gmail.com",
    "password": "Dev@2024ChangeMe!"
  }'
```

### Via Frontend:

1. Go to login page
2. Use email: `pd.dev267@gmail.com`
3. Use password: `Dev@2024ChangeMe!`
4. You should be redirected to `/developer` page

## Troubleshooting

### Error: "No company found"

- **Solution**: Register a company first through the registration endpoint or UI
- The developer account needs to be associated with a company

### Error: "type userrole does not exist" or "invalid input value for enum userrole: 'DEVELOPER'"

- **Solution**: Run the migration that adds the DEVELOPER role:

  ```bash
  # Using Alembic
  alembic upgrade head

  # Or using Supabase migration
  # Apply: c1d2e3f4g5h6_add_developer_role.py or equivalent SQL
  ```

### Error: "SSL connection required"

- **Solution**: The Python script handles SSL automatically for Supabase connections
- If running manually, ensure your `DATABASE_URL` includes SSL parameters

### Error: "Email already exists"

- **Solution**: The script will update the existing user to DEVELOPER role automatically
- Or manually update via SQL:
  ```sql
  UPDATE users
  SET role = 'DEVELOPER'::userrole
  WHERE email = 'pd.dev267@gmail.com';
  ```

## Next Steps

After creating the developer account:

1. **Login** with the developer credentials
2. **Change the password** (recommended)
3. **Access Developer Portal** at `/developer`
4. **Configure Gmail API** (if not already done) in the Email Service tab
5. **Monitor system health** via the Developer Portal

## Security Notes

- The default password is intentionally weak for initial setup
- **Always change it after first login**
- The account is auto-verified for convenience (no email verification required)
- The password hash uses bcrypt with 12 rounds
- Store credentials securely (use a password manager)
