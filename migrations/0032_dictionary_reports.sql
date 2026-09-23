-- Learners flag a wrong or missing translation from the reader's word popup
-- (POST /api/dictionary/report); the admin's Dictionary card lists open reports.
-- One open row per word and language: repeat reports only raise its count.
CREATE TABLE IF NOT EXISTS dictionary_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_word TEXT NOT NULL,
  target_language TEXT NOT NULL CHECK (target_language IN ('en', 'de')),
  story_id INTEGER,
  shown_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(shown_json)),
  reports INTEGER NOT NULL DEFAULT 1 CHECK (reports >= 1),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'fixed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_reported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by_email TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_reports_open_word
ON dictionary_reports (normalized_word, target_language)
WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_dictionary_reports_status
ON dictionary_reports (status, last_reported_at);
