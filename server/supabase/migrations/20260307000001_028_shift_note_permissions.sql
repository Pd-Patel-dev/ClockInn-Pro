-- Migration: Add shift note permissions and assign to roles
-- Corresponds to Alembic 027_add_shift_note_permissions

INSERT INTO permissions (id, name, display_name, description, category, created_at)
VALUES
    (gen_random_uuid(), 'shift_note:edit:self', 'Edit Own Shift Notes', 'Edit shift notepad for own shifts', 'TIME_ENTRIES', now()),
    (gen_random_uuid(), 'shift_note:view:self', 'View Own Shift Notes', 'View own shift notepad', 'TIME_ENTRIES', now()),
    (gen_random_uuid(), 'shift_note:view:all', 'View All Shift Notes', 'View all shift notes (Common Log)', 'ADMIN', now()),
    (gen_random_uuid(), 'shift_note:review', 'Review Shift Notes', 'Mark shift notes as reviewed', 'ADMIN', now()),
    (gen_random_uuid(), 'shift_note:comment', 'Comment on Shift Notes', 'Add manager comments to shift notes', 'ADMIN', now())
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role, permission_id, company_id)
SELECT 'ADMIN', id, '00000000-0000-0000-0000-000000000000'::uuid
FROM permissions
WHERE name IN (
    'shift_note:edit:self',
    'shift_note:view:self',
    'shift_note:view:all',
    'shift_note:review',
    'shift_note:comment'
)
ON CONFLICT (role, permission_id, company_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id, company_id)
SELECT 'FRONTDESK', id, '00000000-0000-0000-0000-000000000000'::uuid
FROM permissions
WHERE name IN ('shift_note:edit:self', 'shift_note:view:self')
ON CONFLICT (role, permission_id, company_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id, company_id)
SELECT 'MAINTENANCE', id, '00000000-0000-0000-0000-000000000000'::uuid
FROM permissions
WHERE name IN ('shift_note:edit:self', 'shift_note:view:self')
ON CONFLICT (role, permission_id, company_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id, company_id)
SELECT 'HOUSEKEEPING', id, '00000000-0000-0000-0000-000000000000'::uuid
FROM permissions
WHERE name IN ('shift_note:edit:self', 'shift_note:view:self')
ON CONFLICT (role, permission_id, company_id) DO NOTHING;
