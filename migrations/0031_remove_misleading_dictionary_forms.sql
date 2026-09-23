-- Reviewed 2026-09-23 while adding the dictionary guards (scripts/lib/dictionary-guards.mjs).
-- Each form below is real Wiktionary data but misleads learners: the stories always
-- use the other word, and for German it was the only result.
--   по    slang clipping of the surname Порошенко (stories: the preposition «по»)
--   мене  vocative of the place name Мен, Maine (stories: «я» → «мене»)
--   мені  locative of Мен and dative/locative of Мена (stories: «я» → «мені»)
--   серед genitive plural of «середа», Wednesday (stories: the preposition «серед»)
-- Delete only these form -> lexeme associations; lexemes, senses and translations stay.
-- The matching builder protection lives in scripts/dictionary/form-exclusions.mjs, and
-- data/dictionary/canaries.json forbids each lemma for its form.

DELETE FROM dictionary_forms
WHERE source_language = 'uk'
  AND normalized_form = 'по'
  AND lexeme_id IN (
    SELECT id FROM dictionary_lexemes
    WHERE source_language = 'uk' AND normalized_lemma = 'порошенко' AND part_of_speech = 'name'
      AND source_id IN ('kaikki-wiktionary', 'kaikki-dewiktionary')
  );

DELETE FROM dictionary_forms
WHERE source_language = 'uk'
  AND normalized_form IN ('мене', 'мені')
  AND lexeme_id IN (
    SELECT id FROM dictionary_lexemes
    WHERE source_language = 'uk' AND normalized_lemma = 'мен' AND part_of_speech = 'name'
      AND source_id IN ('kaikki-wiktionary', 'kaikki-dewiktionary')
  );

DELETE FROM dictionary_forms
WHERE source_language = 'uk'
  AND normalized_form = 'мені'
  AND lexeme_id IN (
    SELECT id FROM dictionary_lexemes
    WHERE source_language = 'uk' AND normalized_lemma = 'мена' AND part_of_speech = 'name'
      AND source_id IN ('kaikki-wiktionary', 'kaikki-dewiktionary')
  );

DELETE FROM dictionary_forms
WHERE source_language = 'uk'
  AND normalized_form = 'серед'
  AND lexeme_id IN (
    SELECT id FROM dictionary_lexemes
    WHERE source_language = 'uk' AND normalized_lemma = 'середа' AND part_of_speech = 'noun'
      AND source_id IN ('kaikki-wiktionary', 'kaikki-dewiktionary')
  );
