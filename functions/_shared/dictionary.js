import { canonicalizeUkrainianWord } from "./ukrainian-word.js";

const MAX_LEXEMES = 12;
const MAX_FORM_ROWS = 48;
const MAX_TRANSLATIONS_PER_LEXEME = 12;

const GRAMMAR_FEATURES = Object.freeze({
  case: ["nominative", "genitive", "dative", "accusative", "instrumental", "locative", "vocative"],
  number: ["singular", "plural"],
  gender: ["masculine", "feminine", "neuter", "gender-not-distinguished"],
  tense: ["past", "present", "future"],
  person: ["first-person", "second-person", "third-person"],
  aspect: ["perfective", "imperfective"],
  mood: ["imperative", "conditional"],
  verbForm: ["infinitive", "participle", "adverbial"],
  degree: ["comparative", "superlative"],
});

function parseTags(value) {
  try {
    const tags = JSON.parse(value);
    return Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function grammarFromTags(tags) {
  const grammar = {};

  Object.entries(GRAMMAR_FEATURES).forEach(([feature, candidates]) => {
    const value = candidates.find((candidate) => tags.includes(candidate));
    if (value) grammar[feature] = value;
  });

  return grammar;
}

function normalizePairRow(row) {
  if (!row) return null;

  return {
    sourceLanguage: row.sourceLanguage,
    targetLanguage: row.targetLanguage,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    sourceRevision: row.sourceRevision,
    licenseName: row.licenseName,
    licenseUrl: row.licenseUrl,
  };
}

async function getDictionaryLanguagePair(db, sourceLanguage, targetLanguage) {
  const row = await db
    .prepare(`
      SELECT
        source_language AS sourceLanguage,
        target_language AS targetLanguage,
        source_name AS sourceName,
        source_url AS sourceUrl,
        source_revision AS sourceRevision,
        license_name AS licenseName,
        license_url AS licenseUrl
      FROM dictionary_language_pairs
      WHERE source_language = ?1 AND target_language = ?2 AND enabled = 1
      LIMIT 1
    `)
    .bind(sourceLanguage, targetLanguage)
    .first();

  return normalizePairRow(row);
}

export async function lookupDictionaryWord(
  db,
  { text, sourceLanguage = "uk", targetLanguage = "en", storyId = null }
) {
  const normalizedWord = canonicalizeUkrainianWord(text);
  if (!normalizedWord) {
    throw new TypeError("Select one Ukrainian word, not a phrase.");
  }

  const pair = await getDictionaryLanguagePair(db, sourceLanguage, targetLanguage);
  if (!pair) {
    return { supported: false, normalizedWord, entries: [], attribution: null };
  }

  const formResult = await db
    .prepare(`
      SELECT
        lexeme.id AS lexemeId,
        lexeme.lemma,
        lexeme.normalized_lemma AS normalizedLemma,
        lexeme.part_of_speech AS partOfSpeech,
        lexeme.source_id AS sourceId,
        form.display_form AS displayForm,
        form.tags_json AS tagsJson
      FROM dictionary_forms AS form
      INNER JOIN dictionary_lexemes AS lexeme ON lexeme.id = form.lexeme_id
      WHERE form.source_language = ?1 AND form.normalized_form = ?2
        AND lexeme.review_status = 'approved'
      ORDER BY
        CASE WHEN lexeme.normalized_lemma = ?2 THEN 0 ELSE 1 END,
        lexeme.lemma ASC,
        lexeme.part_of_speech ASC,
        form.tags_json ASC
      LIMIT ?3
    `)
    .bind(sourceLanguage, normalizedWord, MAX_FORM_ROWS)
    .all();

  const lexemes = new Map();
  for (const row of formResult.results || []) {
    if (!lexemes.has(row.lexemeId) && lexemes.size >= MAX_LEXEMES) continue;

    const entry = lexemes.get(row.lexemeId) || {
      id: row.lexemeId,
      lemma: row.lemma,
      normalizedLemma: row.normalizedLemma,
      partOfSpeech: row.partOfSpeech,
      sourceId: row.sourceId,
      forms: [],
      translations: [],
    };
    const tags = parseTags(row.tagsJson);
    const signature = JSON.stringify(tags);
    if (!entry.forms.some((form) => JSON.stringify(form.tags) === signature)) {
      entry.forms.push({
        form: row.displayForm,
        tags,
        grammar: grammarFromTags(tags),
      });
    }
    lexemes.set(row.lexemeId, entry);
  }

  const lexemeIds = [...lexemes.keys()];
  let preferredSenseId = null;
  if (Number.isSafeInteger(storyId) && storyId > 0) {
    const preference = await db.prepare(`
      SELECT sense_id AS senseId
      FROM story_dictionary_preferences
      WHERE story_id = ?1 AND normalized_form = ?2 AND target_language = ?3
      LIMIT 1
    `).bind(storyId, normalizedWord, targetLanguage).first();
    preferredSenseId = preference?.senseId || null;
  }

  if (lexemeIds.length) {
    const placeholders = lexemeIds.map((_, index) => `?${index + 2}`).join(", ");
    const translationResult = await db
      .prepare(`
        SELECT
          sense.lexeme_id AS lexemeId,
          sense.id AS senseId,
          sense.sense_order AS senseOrder,
          sense.usage_tags_json AS usageTagsJson,
          translation.translation,
          translation.translation_order AS translationOrder,
          translation.source_id AS sourceId,
          source.name AS sourceName,
          source.url AS sourceUrl,
          source.license_name AS licenseName,
          source.license_url AS licenseUrl
        FROM dictionary_senses AS sense
        INNER JOIN dictionary_translations AS translation ON translation.sense_id = sense.id
        LEFT JOIN dictionary_sources AS source ON source.id = translation.source_id
        WHERE translation.target_language = ?1
          AND translation.review_status = 'approved'
          AND sense.lexeme_id IN (${placeholders})
        ORDER BY sense.lexeme_id ASC, sense.sense_order ASC, translation.translation_order ASC
      `)
      .bind(targetLanguage, ...lexemeIds)
      .all();

    const counts = new Map();
    for (const row of translationResult.results || []) {
      const entry = lexemes.get(row.lexemeId);
      const count = counts.get(row.lexemeId) || 0;
      if (!entry || count >= MAX_TRANSLATIONS_PER_LEXEME) continue;

      entry.translations.push({
        text: row.translation,
        senseOrder: Number(row.senseOrder),
        usageTags: parseTags(row.usageTagsJson),
        preferred: row.senseId === preferredSenseId,
        source: {
          id: row.sourceId,
          name: row.sourceName,
          url: row.sourceUrl,
          licenseName: row.licenseName,
          licenseUrl: row.licenseUrl,
        },
      });
      counts.set(row.lexemeId, count + 1);
    }
  }

  const entries = [...lexemes.values()]
    .filter((entry) => entry.translations.length)
    .map(({ id: _id, ...entry }) => ({
      ...entry,
      translations: entry.translations.sort((left, right) => Number(right.preferred) - Number(left.preferred)),
    }))
    .sort((left, right) => (
      Number(right.translations.some((translation) => translation.preferred))
      - Number(left.translations.some((translation) => translation.preferred))
    ));
  const attributions = new Map();
  entries.forEach((entry) => {
    entry.translations.forEach((translation) => {
      const source = translation.source;
      if (source?.id && source?.name) attributions.set(source.id, source);
    });
  });

  return {
    supported: true,
    normalizedWord,
    entries,
    attribution: pair,
    attributions: [...attributions.values()],
  };
}
