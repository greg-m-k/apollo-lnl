CREATE TABLE persons (
  id TEXT PRIMARY KEY,
  session TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  hire_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  UNIQUE (session, email)
);
