-- 051_housekeeping_permissions
INSERT INTO permissions (id, name, display_name, description, category, created_at)
VALUES
  (gen_random_uuid(), 'housekeeping.view', 'View Housekeeping Board', 'View rooms and housekeeping board', 'HOUSEKEEPING', now()),
  (gen_random_uuid(), 'housekeeping.status', 'Update Room Status', 'Update occupancy and cleaning status', 'HOUSEKEEPING', now()),
  (gen_random_uuid(), 'housekeeping.assign', 'Assign & Print Sheets', 'Assign rooms to housekeepers and print assignment sheets', 'HOUSEKEEPING', now())
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role, permission_id, company_id)
SELECT 'HOUSEKEEPING', id, '00000000-0000-0000-0000-000000000000'::uuid
FROM permissions
WHERE name IN ('housekeeping.view', 'housekeeping.status', 'housekeeping.assign')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role, permission_id, company_id)
SELECT 'FRONTDESK', id, '00000000-0000-0000-0000-000000000000'::uuid
FROM permissions
WHERE name IN ('housekeeping.view', 'housekeeping.status', 'housekeeping.assign')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role, permission_id, company_id)
SELECT 'ADMIN', id, '00000000-0000-0000-0000-000000000000'::uuid
FROM permissions
WHERE name IN ('housekeeping.view', 'housekeeping.status', 'housekeeping.assign')
ON CONFLICT DO NOTHING;
