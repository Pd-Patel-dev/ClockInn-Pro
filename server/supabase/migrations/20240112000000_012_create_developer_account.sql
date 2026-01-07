-- Migration to create developer account
-- This creates a developer account with email: pd.dev267@gmail.com
-- Default password: Dev@2024ChangeMe! (should be changed after first login)

-- Note: This uses bcrypt hash for the password "Dev@2024ChangeMe!"
-- You can generate a new hash using Python: 
-- from passlib.context import CryptContext
-- pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
-- print(pwd_context.hash("Dev@2024ChangeMe!"))

-- IMPORTANT: This migration assumes:
-- 1. At least one company exists in the database
-- 2. The DEVELOPER role has been added to the userrole enum (migration 20240111500000_011_5_add_developer_role.sql)
-- 
-- NOTE: If you get an error about DEVELOPER not existing in enum, run migration 011_5 first!

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
        -- Get first company (we need at least one company)
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
        RAISE NOTICE 'Email: %', dev_email;
        RAISE NOTICE 'Password: Dev@2024ChangeMe!';
        RAISE NOTICE 'User ID: %', new_user_id;
        RAISE NOTICE 'Company ID: %', company_uuid;
        RAISE NOTICE '';
        RAISE NOTICE '⚠️  IMPORTANT: Please change the password after first login!';
    END IF;
END $$;

