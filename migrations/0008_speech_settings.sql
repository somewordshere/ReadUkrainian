CREATE TABLE IF NOT EXISTS speech_settings (
  singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
  voice_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id INTEGER,
  updated_by_email TEXT,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO speech_settings (singleton_id, voice_id)
VALUES (1, 'lada')
ON CONFLICT(singleton_id) DO NOTHING;
