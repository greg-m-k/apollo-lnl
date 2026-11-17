CREATE TABLE badge_holders (
  id TEXT PRIMARY KEY,
  session TEXT NOT NULL DEFAULT '',
  person_id TEXT NOT NULL,
  badge_number TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'STANDARD',
  clearance TEXT NOT NULL DEFAULT 'NONE',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  UNIQUE (session, badge_number)
);
CREATE INDEX badge_holders_person ON badge_holders (person_id);
INSERT INTO badge_holders (id, session, person_id, badge_number, access_level, clearance, active) VALUES
  ('badge-001', '', 'person-001', 'B10001', 'RESTRICTED', 'SECRET', 1),
  ('badge-002', '', 'person-002', 'B10002', 'ALL_ACCESS', 'TOP_SECRET', 1),
  ('badge-003', '', 'person-003', 'B10003', 'STANDARD', 'CONFIDENTIAL', 1),
  ('badge-005', '', 'person-005', 'B10005', 'RESTRICTED', 'SECRET', 1);
