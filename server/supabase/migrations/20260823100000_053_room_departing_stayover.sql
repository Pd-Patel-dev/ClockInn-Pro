-- 053: room occupancy vacant/occupied → departing/stayover
UPDATE rooms SET occupancy_status = 'departing' WHERE occupancy_status = 'vacant';
UPDATE rooms SET occupancy_status = 'stayover' WHERE occupancy_status = 'occupied';
UPDATE rooms SET occupancy_status = 'departing'
WHERE occupancy_status NOT IN ('departing', 'stayover');

ALTER TABLE rooms ALTER COLUMN occupancy_status SET DEFAULT 'departing';
