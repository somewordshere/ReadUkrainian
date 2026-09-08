-- Reviewed Kaikki inflection-table errors, 2026-09-06.
-- Delete only incorrect form -> lexeme associations. Preserve the lexemes,
-- senses, translations, valid forms and any story-specific sense preferences.
-- The matching builder protection lives in scripts/dictionary/form-exclusions.mjs.

DELETE FROM dictionary_forms
WHERE source_language = 'uk'
  AND lexeme_id IN (
    SELECT id FROM dictionary_lexemes
    WHERE source_language = 'uk' AND normalized_lemma = 'озимина'
      AND part_of_speech = 'noun'
      AND source_id IN ('kaikki-wiktionary', 'kaikki-dewiktionary')
  )
  AND normalized_form IN (
    'мама', 'мами', 'мам', 'мамів', 'мамі', 'мамам', 'маму', 'мамою',
    'мамами', 'мамах', 'мамо'
  );

DELETE FROM dictionary_forms
WHERE source_language = 'uk'
  AND lexeme_id IN (
    SELECT id FROM dictionary_lexemes
    WHERE source_language = 'uk' AND normalized_lemma = 'рясний'
      AND part_of_speech = 'adj'
      AND source_id IN ('kaikki-wiktionary', 'kaikki-dewiktionary')
  )
  AND normalized_form IN (
    'червоний', 'червоне', 'червона', 'червоні', 'червоного', 'червоної',
    'червоних', 'червоному', 'червоній', 'червоним', 'червону', 'червоною',
    'червоними', 'червонім'
  );

DELETE FROM dictionary_forms
WHERE source_language = 'uk'
  AND lexeme_id IN (
    SELECT id FROM dictionary_lexemes
    WHERE source_language = 'uk' AND normalized_lemma = 'лісопарк'
      AND part_of_speech = 'noun'
      AND source_id IN ('kaikki-wiktionary', 'kaikki-dewiktionary')
  )
  AND normalized_form IN (
    'парк', 'парки', 'парку', 'парків', 'паркові', 'паркам', 'парком',
    'парками', 'парках'
  );
