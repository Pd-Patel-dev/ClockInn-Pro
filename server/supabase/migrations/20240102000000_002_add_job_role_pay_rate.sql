-- Add job_role and pay_rate columns to users table

ALTER TABLE users 
ADD COLUMN job_role VARCHAR(255),
ADD COLUMN pay_rate NUMERIC(10, 2);

