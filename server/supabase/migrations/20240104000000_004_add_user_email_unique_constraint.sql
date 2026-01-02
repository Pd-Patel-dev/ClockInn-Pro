-- Add unique constraint on user email per company (case-insensitive)

-- First, clean up any duplicate emails within the same company
-- Keep the oldest user record for each (company_id, email) pair
DELETE FROM users u1
WHERE u1.id NOT IN (
    SELECT MIN(u2.id)
    FROM users u2
    GROUP BY u2.company_id, LOWER(u2.email)
)
AND EXISTS (
    SELECT 1
    FROM users u3
    WHERE u3.company_id = u1.company_id
    AND LOWER(u3.email) = LOWER(u1.email)
    AND u3.id < u1.id
);

-- Create unique index on (company_id, LOWER(email))
CREATE UNIQUE INDEX ix_users_company_email_lower 
ON users(company_id, LOWER(email));

