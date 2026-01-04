-- Add series_id to shifts and shift_id to time_entries
-- Revision: 008
-- Date: 2025-01-08

-- Add series_id to shifts table for grouping bulk-created shifts
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS series_id UUID;
CREATE INDEX IF NOT EXISTS ix_shifts_series_id ON shifts(series_id);

-- Add shift_id to time_entries table to link entries to shifts
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS shift_id UUID;
ALTER TABLE time_entries 
  ADD CONSTRAINT fk_time_entries_shift_id 
  FOREIGN KEY (shift_id) 
  REFERENCES shifts(id) 
  ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_time_entries_shift_id ON time_entries(shift_id);

