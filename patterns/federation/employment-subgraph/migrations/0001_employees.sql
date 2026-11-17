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
INSERT INTO employees (id, session, person_id, title, department, salary, active) VALUES
  ('emp-001', '', 'person-001', 'Senior Software Engineer', 'Engineering', 150000.00, 1),
  ('emp-002', '', 'person-002', 'Product Manager', 'Product', 140000.00, 1),
  ('emp-003', '', 'person-003', 'Data Analyst', 'Analytics', 95000.00, 1),
  ('emp-005', '', 'person-005', 'DevOps Engineer', 'Engineering', 130000.00, 1);
