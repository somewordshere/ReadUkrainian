CREATE TABLE IF NOT EXISTS dictionary_language_pairs (
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  PRIMARY KEY (source_language, target_language)
);

CREATE TABLE IF NOT EXISTS dictionary_lexemes (
  id TEXT PRIMARY KEY NOT NULL,
  source_language TEXT NOT NULL,
  lemma TEXT NOT NULL,
  normalized_lemma TEXT NOT NULL,
  part_of_speech TEXT NOT NULL,
  source_entry_id TEXT NOT NULL,
  UNIQUE (source_language, source_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_dictionary_lexemes_language_lemma
ON dictionary_lexemes (source_language, normalized_lemma);

CREATE TABLE IF NOT EXISTS dictionary_forms (
  lexeme_id TEXT NOT NULL,
  source_language TEXT NOT NULL,
  normalized_form TEXT NOT NULL,
  display_form TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  PRIMARY KEY (lexeme_id, normalized_form, tags_json),
  FOREIGN KEY (lexeme_id) REFERENCES dictionary_lexemes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dictionary_forms_lookup
ON dictionary_forms (source_language, normalized_form, lexeme_id);

CREATE TABLE IF NOT EXISTS dictionary_senses (
  id TEXT PRIMARY KEY NOT NULL,
  lexeme_id TEXT NOT NULL,
  sense_order INTEGER NOT NULL CHECK (sense_order >= 1),
  usage_tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(usage_tags_json)),
  FOREIGN KEY (lexeme_id) REFERENCES dictionary_lexemes(id) ON DELETE CASCADE,
  UNIQUE (lexeme_id, sense_order)
);

CREATE INDEX IF NOT EXISTS idx_dictionary_senses_lexeme
ON dictionary_senses (lexeme_id, sense_order);

CREATE TABLE IF NOT EXISTS dictionary_translations (
  sense_id TEXT NOT NULL,
  target_language TEXT NOT NULL,
  translation TEXT NOT NULL,
  translation_order INTEGER NOT NULL CHECK (translation_order >= 1),
  PRIMARY KEY (sense_id, target_language, translation_order),
  FOREIGN KEY (sense_id) REFERENCES dictionary_senses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dictionary_translations_target
ON dictionary_translations (target_language, sense_id, translation_order);
