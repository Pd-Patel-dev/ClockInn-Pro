-- 047_drop_shift_notes: remove shift notepad tables, enum, and permissions
DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id FROM permissions WHERE name LIKE 'shift_note:%'
);
DELETE FROM permissions WHERE name LIKE 'shift_note:%';

DROP TABLE IF EXISTS shift_note_comments CASCADE;
DROP TABLE IF EXISTS shift_notes CASCADE;
DROP TYPE IF EXISTS shiftnotestatus;
