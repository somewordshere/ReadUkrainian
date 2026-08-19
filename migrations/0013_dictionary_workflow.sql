CREATE TABLE IF NOT EXISTS dictionary_sources (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  license_name TEXT,
  license_url TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('upstream', 'curated'))
);

INSERT OR IGNORE INTO dictionary_sources (
  id, name, url, license_name, license_url, source_kind
) VALUES (
  'kaikki-wiktionary',
  'English Wiktionary via Kaikki.org',
  'https://kaikki.org/dictionary/Ukrainian/',
  'CC BY-SA 4.0 / GFDL',
  'https://en.wiktionary.org/wiki/Wiktionary:Copyrights',
  'upstream'
);

INSERT OR IGNORE INTO dictionary_sources (
  id, name, url, license_name, license_url, source_kind
) VALUES (
  'readukrainian-curated',
  'Read Ukrainian reviewed supplement',
  NULL,
  NULL,
  NULL,
  'curated'
);

ALTER TABLE dictionary_language_pairs
ADD COLUMN available_revision TEXT;

ALTER TABLE dictionary_language_pairs
ADD COLUMN last_checked_at TEXT;

ALTER TABLE dictionary_lexemes
ADD COLUMN source_id TEXT NOT NULL DEFAULT 'kaikki-wiktionary';

ALTER TABLE dictionary_lexemes
ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved'
CHECK (review_status IN ('pending', 'approved'));

ALTER TABLE dictionary_translations
ADD COLUMN source_id TEXT NOT NULL DEFAULT 'kaikki-wiktionary';

ALTER TABLE dictionary_translations
ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved'
CHECK (review_status IN ('pending', 'approved'));

CREATE TABLE IF NOT EXISTS dictionary_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_language TEXT NOT NULL DEFAULT 'uk',
  target_language TEXT NOT NULL,
  display_form TEXT NOT NULL,
  normalized_form TEXT NOT NULL,
  lemma TEXT NOT NULL,
  normalized_lemma TEXT NOT NULL,
  part_of_speech TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  translation TEXT NOT NULL,
  explanation TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  suggested_by_user_id INTEGER,
  suggested_by_email TEXT NOT NULL,
  suggested_at TEXT NOT NULL,
  reviewed_by_user_id INTEGER,
  reviewed_by_email TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  FOREIGN KEY (suggested_by_user_id) REFERENCES users(id),
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_dictionary_suggestions_status_date
ON dictionary_suggestions (status, suggested_at DESC);

CREATE INDEX IF NOT EXISTS idx_dictionary_suggestions_form_language
ON dictionary_suggestions (source_language, normalized_form, target_language, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_suggestions_one_pending
ON dictionary_suggestions (source_language, normalized_form, target_language)
WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS story_dictionary_preferences (
  story_id INTEGER NOT NULL,
  normalized_form TEXT NOT NULL,
  target_language TEXT NOT NULL,
  sense_id TEXT NOT NULL,
  selected_by_user_id INTEGER,
  selected_by_email TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  PRIMARY KEY (story_id, normalized_form, target_language),
  FOREIGN KEY (story_id) REFERENCES texts(id) ON DELETE CASCADE,
  FOREIGN KEY (sense_id) REFERENCES dictionary_senses(id) ON DELETE CASCADE,
  FOREIGN KEY (selected_by_user_id) REFERENCES users(id)
);
