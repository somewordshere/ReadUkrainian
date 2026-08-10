CREATE TABLE IF NOT EXISTS speech_usage_daily (
  day TEXT PRIMARY KEY,
  characters_used INTEGER NOT NULL DEFAULT 0 CHECK (characters_used >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
