-- Local read models built from the three topics (apollo-demo projections_db).
CREATE TABLE person_projections (
  id TEXT PRIMARY KEY, session TEXT NOT NULL DEFAULT '', name TEXT, email TEXT, hire_date TEXT,
  active INTEGER, last_updated INTEGER NOT NULL, event_version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE employee_projections (
  id TEXT PRIMARY KEY, session TEXT NOT NULL DEFAULT '', person_id TEXT, title TEXT, department TEXT,
  salary REAL, active INTEGER, last_updated INTEGER NOT NULL, event_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX employee_projections_person ON employee_projections (person_id);
CREATE TABLE badge_projections (
  id TEXT PRIMARY KEY, session TEXT NOT NULL DEFAULT '', person_id TEXT, badge_number TEXT, access_level TEXT,
  clearance TEXT, active INTEGER, last_updated INTEGER NOT NULL, event_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX badge_projections_person ON badge_projections (person_id);
CREATE TABLE processed_events (
  event_id TEXT PRIMARY KEY, session TEXT NOT NULL DEFAULT '', topic TEXT NOT NULL, processed_at INTEGER NOT NULL
);
-- Where each event spent its time on the way to the projection (all three topics).
CREATE TABLE propagation_timing (
  entity_id TEXT NOT NULL, session TEXT NOT NULL DEFAULT '', event_type TEXT NOT NULL,
  event_created_at INTEGER NOT NULL, published_at INTEGER NOT NULL, consumer_received_at INTEGER NOT NULL,
  projection_updated_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX propagation_timing_entity ON propagation_timing (entity_id, projection_updated_at);

-- Seed rows go straight into the projections, as in the apollo-demo import.sql.
INSERT INTO person_projections (id, name, email, hire_date, active, last_updated) VALUES
  ('person-001', 'Alice Johnson', 'alice.johnson@company.com', '2020-01-15', 1, unixepoch() * 1000),
  ('person-002', 'Bob Smith', 'bob.smith@company.com', '2019-06-01', 1, unixepoch() * 1000),
  ('person-003', 'Carol Williams', 'carol.williams@company.com', '2021-03-20', 1, unixepoch() * 1000),
  ('person-004', 'David Brown', 'david.brown@company.com', '2018-11-10', 0, unixepoch() * 1000),
  ('person-005', 'Eva Martinez', 'eva.martinez@company.com', '2022-08-05', 1, unixepoch() * 1000);
INSERT INTO employee_projections (id, person_id, title, department, salary, active, last_updated) VALUES
  ('emp-001', 'person-001', 'Senior Software Engineer', 'Engineering', 150000.00, 1, unixepoch() * 1000),
  ('emp-002', 'person-002', 'Product Manager', 'Product', 140000.00, 1, unixepoch() * 1000),
  ('emp-003', 'person-003', 'Data Analyst', 'Analytics', 95000.00, 1, unixepoch() * 1000),
  ('emp-005', 'person-005', 'DevOps Engineer', 'Engineering', 130000.00, 1, unixepoch() * 1000);
INSERT INTO badge_projections (id, person_id, badge_number, access_level, clearance, active, last_updated) VALUES
  ('badge-001', 'person-001', 'B10001', 'RESTRICTED', 'SECRET', 1, unixepoch() * 1000),
  ('badge-002', 'person-002', 'B10002', 'ALL_ACCESS', 'TOP_SECRET', 1, unixepoch() * 1000),
  ('badge-003', 'person-003', 'B10003', 'STANDARD', 'CONFIDENTIAL', 1, unixepoch() * 1000),
  ('badge-005', 'person-005', 'B10005', 'RESTRICTED', 'SECRET', 1, unixepoch() * 1000);
