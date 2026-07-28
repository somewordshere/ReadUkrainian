ALTER TABLE texts ADD COLUMN draft_json TEXT;
ALTER TABLE texts ADD COLUMN draft_updated_at TEXT;
ALTER TABLE texts ADD COLUMN draft_updated_by_user_id INTEGER;
ALTER TABLE texts ADD COLUMN draft_updated_by_email TEXT;
ALTER TABLE texts ADD COLUMN updated_by_user_id INTEGER;
ALTER TABLE texts ADD COLUMN updated_by_email TEXT;
ALTER TABLE texts ADD COLUMN published_at TEXT;

UPDATE texts
SET published_at = updated_at
WHERE is_enabled = 1 AND published_at IS NULL;

CREATE TABLE IF NOT EXISTS story_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_by_user_id INTEGER,
  created_by_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (story_id) REFERENCES texts(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_story_revisions_story_created
  ON story_revisions(story_id, created_at DESC, id DESC);
