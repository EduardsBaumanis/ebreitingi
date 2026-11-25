-- Migration number: 0001 	 Initial schema (see plan.md §3)

-- CMS users. Identity comes from Cloudflare Access; this table holds the role.
CREATE TABLE admin_users (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT,
  role       TEXT NOT NULL CHECK (role IN ('admin','moderator')),
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Institutions, imported from the CSV export. reg_number is unique in the data.
CREATE TABLE institutions (
  id             INTEGER PRIMARY KEY,
  reg_number     TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  name_search    TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,
  veids          TEXT NOT NULL,
  tips           TEXT,
  founder        TEXT,
  accredited     INTEGER NOT NULL DEFAULT 0,
  liquidated     INTEGER NOT NULL DEFAULT 0,
  subordination  TEXT,
  location       TEXT,
  hidden         INTEGER NOT NULL DEFAULT 0,
  avg_score      REAL,
  rated_teachers INTEGER NOT NULL DEFAULT 0,
  review_count   INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_inst_veids    ON institutions(veids);
CREATE INDEX idx_inst_location ON institutions(location);
CREATE INDEX idx_inst_search   ON institutions(name_search);

CREATE TABLE teachers (
  id           INTEGER PRIMARY KEY,
  full_name    TEXT NOT NULL,
  name_search  TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','active','hidden','removed')),
  source       TEXT NOT NULL CHECK (source IN ('admin','import','suggested')),
  avg_score    REAL,
  review_count INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_teacher_search ON teachers(name_search);

CREATE TABLE teacher_institutions (
  teacher_id     INTEGER NOT NULL REFERENCES teachers(id),
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  subjects       TEXT,
  PRIMARY KEY (teacher_id, institution_id)
);
CREATE INDEX idx_ti_institution ON teacher_institutions(institution_id);

CREATE TABLE criteria (
  id          INTEGER PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE tags (
  id         INTEGER PRIMARY KEY,
  label      TEXT NOT NULL,
  sentiment  TEXT NOT NULL CHECK (sentiment IN ('positive','neutral','negative')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);

-- Reviews. No reviewer-identifying data is stored.
CREATE TABLE reviews (
  id                  INTEGER PRIMARY KEY,
  teacher_id          INTEGER NOT NULL REFERENCES teachers(id),
  institution_id      INTEGER NOT NULL REFERENCES institutions(id),
  subject             TEXT,
  period              TEXT,
  comment             TEXT NOT NULL,
  comment_original    TEXT,
  edited_by_moderator INTEGER NOT NULL DEFAULT 0,
  overall_score       REAL NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','removed')),
  rejection_reason    TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  moderated_at        TEXT,
  moderated_by        INTEGER REFERENCES admin_users(id)
);
CREATE INDEX idx_reviews_status      ON reviews(status, created_at);
CREATE INDEX idx_reviews_teacher     ON reviews(teacher_id, status);
CREATE INDEX idx_reviews_institution ON reviews(institution_id, status);

CREATE TABLE review_scores (
  review_id    INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  criterion_id INTEGER NOT NULL REFERENCES criteria(id),
  score        INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  PRIMARY KEY (review_id, criterion_id)
);

CREATE TABLE review_tags (
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (review_id, tag_id)
);

CREATE TABLE teacher_replies (
  id            INTEGER PRIMARY KEY,
  review_id     INTEGER NOT NULL REFERENCES reviews(id),
  body          TEXT NOT NULL,
  contact_email TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  moderated_at  TEXT,
  moderated_by  INTEGER REFERENCES admin_users(id)
);
CREATE INDEX idx_replies_status ON teacher_replies(status, created_at);

CREATE TABLE removal_requests (
  id              INTEGER PRIMARY KEY,
  requester_name  TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  relation        TEXT NOT NULL CHECK (relation IN ('teacher','institution','other')),
  target_type     TEXT NOT NULL CHECK (target_type IN ('teacher','review')),
  target_id       INTEGER NOT NULL,
  message         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','granted','partially_granted','denied')),
  resolution_note TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT,
  resolved_by     INTEGER REFERENCES admin_users(id)
);
CREATE INDEX idx_removal_status ON removal_requests(status, created_at);
