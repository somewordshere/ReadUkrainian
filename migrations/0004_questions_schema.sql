CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL,
  display_order INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  wrong_answers_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (story_id) REFERENCES texts(id) ON DELETE CASCADE,
  UNIQUE(story_id, display_order)
);

CREATE INDEX IF NOT EXISTS idx_questions_story_order
  ON questions(story_id, display_order);
