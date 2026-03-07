-- Migration: Add beverage_sold column to shift_notes
-- Corresponds to Alembic 028_add_shift_note_beverage_sold

ALTER TABLE shift_notes ADD COLUMN IF NOT EXISTS beverage_sold INTEGER;
