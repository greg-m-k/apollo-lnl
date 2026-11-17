CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  session TEXT NOT NULL DEFAULT '',
  person_id TEXT NOT NULL,
  title TEXT NOT NULL,
  department TEXT NOT NULL,
  salary REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);
CREATE INDEX employees_person ON employees (person_id);
