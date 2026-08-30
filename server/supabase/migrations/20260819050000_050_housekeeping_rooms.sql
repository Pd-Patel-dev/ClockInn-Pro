-- 050_housekeeping_rooms
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number VARCHAR(32) NOT NULL,
  room_type VARCHAR(64) NOT NULL DEFAULT 'Standard',
  occupancy_status VARCHAR(20) NOT NULL DEFAULT 'vacant',
  cleaning_status VARCHAR(20) NOT NULL DEFAULT 'clean',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_rooms_company_number UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS ix_rooms_company_id ON rooms (company_id);

CREATE TABLE IF NOT EXISTS housekeeping_sheets (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  housekeeper_id UUID REFERENCES users(id) ON DELETE SET NULL,
  housekeeper_name VARCHAR(255) NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(255),
  notes VARCHAR(1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_housekeeping_sheets_company_id ON housekeeping_sheets (company_id);

CREATE TABLE IF NOT EXISTS housekeeping_sheet_items (
  id UUID PRIMARY KEY,
  sheet_id UUID NOT NULL REFERENCES housekeeping_sheets(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  room_number VARCHAR(32) NOT NULL,
  room_type VARCHAR(64) NOT NULL,
  occupancy_status VARCHAR(20) NOT NULL,
  cleaning_status VARCHAR(20) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_housekeeping_sheet_items_sheet_id ON housekeeping_sheet_items (sheet_id);
