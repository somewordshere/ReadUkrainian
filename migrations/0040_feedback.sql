-- Readers' messages from the feedback form on the About page (POST /api/feedback);
-- the admin's Feedback card lists the open ones. The email is optional and only
-- there so an administrator can reply; resolving a message keeps it, deleting it
-- removes the row and the address with it.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  email TEXT CHECK (email IS NULL OR length(email) <= 254),
  page TEXT CHECK (page IS NULL OR length(page) <= 200),
  story_id INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by_email TEXT
);

CREATE INDEX IF NOT EXISTS idx_feedback_status
ON feedback (status, created_at);
