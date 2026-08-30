-- 052_room_assigned_housekeeper
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS assigned_housekeeper_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_rooms_assigned_housekeeper_id ON rooms (assigned_housekeeper_id);
