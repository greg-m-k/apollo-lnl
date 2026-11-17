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
