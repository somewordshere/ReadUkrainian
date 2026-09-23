-- The admin's shortlist of Google voices; the site voice in speech_settings must be one of them.
CREATE TABLE IF NOT EXISTS speech_voice_options (
  voice_id TEXT PRIMARY KEY NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_email TEXT
);

INSERT INTO speech_voice_options (voice_id, is_enabled, updated_by_email)
VALUES ('uk-UA-Chirp3-HD-Achernar', 1, 'migration:0030')
ON CONFLICT(voice_id) DO NOTHING;

-- Voice IDs are now Google voice names; retired Lada/MAI/achernar IDs become the default.
UPDATE speech_settings
SET
  voice_id = 'uk-UA-Chirp3-HD-Achernar',
  version = version + 1,
  updated_at = CURRENT_TIMESTAMP,
  updated_by_user_id = NULL,
  updated_by_email = 'migration:0030'
WHERE voice_id NOT LIKE 'uk-UA-%';
