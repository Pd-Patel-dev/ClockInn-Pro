-- Add unique constraint on user email per company (case-insensitive)

-- First, clean up any duplicate emails within the same company
-- Keep the oldest user record for each (company_id, email) pair
-- Use created_at to determine which record is oldest
WITH duplicates AS (
    SELECT 
        id,
        company_id,
        LOWER(email) as email_lower,
        created_at,
        ROW_NUMBER() OVER (
            PARTITION BY company_id, LOWER(email) 
            ORDER BY created_at ASC, id ASC
        ) as rn
    FROM users
)
DELETE FROM users
WHERE id IN (
    SELECT id 
    FROM duplicates 
    WHERE rn > 1
);

-- Create unique index on (company_id, LOWER(email))
CREATE UNIQUE INDEX ix_users_company_email_lower 
ON users(company_id, LOWER(email));

