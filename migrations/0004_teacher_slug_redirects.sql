-- Migration number: 0004 	 Old teacher page addresses after a merge.
-- When teacher A is merged into teacher B, /pedagogi/<A's slug> permanently redirects to B.
CREATE TABLE teacher_slug_redirects (
  slug       TEXT PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_slug_redirects_teacher ON teacher_slug_redirects(teacher_id);
