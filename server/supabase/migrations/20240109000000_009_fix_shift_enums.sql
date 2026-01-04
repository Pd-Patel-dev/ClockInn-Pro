-- Fix shift enum types
-- This migration converts VARCHAR columns to proper ENUM types

-- Create enum types if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shiftstatus') THEN
        CREATE TYPE shiftstatus AS ENUM ('DRAFT', 'PUBLISHED', 'APPROVED', 'CANCELLED');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shifttemplatetype') THEN
        CREATE TYPE shifttemplatetype AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'NONE');
    END IF;
END $$;

-- Convert shifts.status from VARCHAR to ENUM (if table exists and column is VARCHAR)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'shifts' 
        AND column_name = 'status'
        AND data_type = 'character varying'
    ) THEN
        -- Alter column to use enum type
        ALTER TABLE shifts 
        ALTER COLUMN status TYPE shiftstatus USING status::shiftstatus;
    END IF;
END $$;

-- Convert shift_templates.template_type from VARCHAR to ENUM (if table exists and column is VARCHAR)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'shift_templates' 
        AND column_name = 'template_type'
        AND data_type = 'character varying'
    ) THEN
        -- Alter column to use enum type
        ALTER TABLE shift_templates 
        ALTER COLUMN template_type TYPE shifttemplatetype USING template_type::shifttemplatetype;
    END IF;
END $$;

