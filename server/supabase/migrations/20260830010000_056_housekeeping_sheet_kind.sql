-- 056: housekeeping sheet kind (assignment vs finalize/cleaned)
ALTER TABLE housekeeping_sheets
ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'assignment';

UPDATE housekeeping_sheets
SET kind = 'finalize'
WHERE notes ILIKE '%finalized board%'
   OR notes ILIKE '%cleaning done%';
