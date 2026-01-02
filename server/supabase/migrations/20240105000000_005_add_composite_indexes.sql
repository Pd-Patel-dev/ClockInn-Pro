-- Add composite indexes for common queries

-- Add composite index on (company_id, status) for users table
-- This optimizes queries filtering users by company and status
CREATE INDEX idx_users_company_status ON users(company_id, status);

-- Note: idx_time_entries_company_employee_clock_in was already created in migration 003
-- Add composite index on (company_id, status, created_at) for leave_requests table
-- This optimizes queries filtering leave requests by company, status, and date
CREATE INDEX idx_leave_requests_company_status_created ON leave_requests(company_id, status, created_at);

