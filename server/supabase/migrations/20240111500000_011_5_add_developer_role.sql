-- Migration to add DEVELOPER role to userrole enum
-- This must run before creating the developer account

-- Add DEVELOPER value to userrole enum
-- Using IF NOT EXISTS to make it idempotent (safe to run multiple times)
DO $$ 
BEGIN
    -- Check if DEVELOPER already exists in the enum
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_enum 
        WHERE enumlabel = 'DEVELOPER' 
        AND enumtypid = (
            SELECT oid 
            FROM pg_type 
            WHERE typname = 'userrole'
        )
    ) THEN
        ALTER TYPE userrole ADD VALUE 'DEVELOPER';
        RAISE NOTICE 'Added DEVELOPER role to userrole enum';
    ELSE
        RAISE NOTICE 'DEVELOPER role already exists in userrole enum';
    END IF;
END $$;

