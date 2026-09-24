import { canonicalizeUkrainianWord } from "./ukrainian-word.js";

const MAX_LEXEMES = 12;
const MAX_FORM_ROWS = 48;
const MAX_TRANSLATIONS_PER_LEXEME = 12;

// Ukrainian word forms are shared by every translation language. The English
// dictionary must cover every story word and its forms are what the dictionary
// guards check, so its forms are the reference: an entry in any language is found
// through them when it has the same lemma and part of speech. A new language then
// needs only lemmas and translations, and a repair to a form reaches every
// language at once. Entries keep their own forms too, which lead only to them.
export const FORMS_REFERENCE_LANGUAGE = "en";

// Kaikki abbreviates parts of speech (adj, adv…); the curated entries and the
// suggestion form spell them out, as the reader's labels do. Lookups compare and
// report the spelled-out name, so both kinds of entry for a word meet.
const PART_OF_SPEECH_NAMES = Object.freeze({
  adj: "adjective",
  adv: "adverb",
  conj: "conjunction",
  det: "determiner",
  intj: "interjection",
  num: "numeral",
  prep: "preposition",
  pron: "pronoun",
  "proper-noun": "name",
});

export function canonicalPartOfSpeech(value) {
  return Object.hasOwn(PART_OF_SPEECH_NAMES, value) ? PART_OF_SPEECH_NAMES[value] : value;
}

function canonicalPartOfSpeechSql(column) {
  const cases = Object.entries(PART_OF_SPEECH_NAMES).map(([short, name]) => `WHEN '${short}' THEN '${name}'`);
  return `(CASE ${column} ${cases.join(" ")} ELSE ${column} END)`;
}

// Two common table expressions for a WITH clause. word_analyses: the forms that
// match (normalizedForm, displayForm, tagsJson) and the approved entry that
// records each. form_entries: every entry those forms lead to (lexemeId plus the
// form's columns), whatever language it translates into; callers keep the
// entries that have a translation in theirs. `shared` is 0 when the entry records
// the form itself and 1 when it is reached through the reference forms, so an
// entry's own reading of a word can be listed first.
export function formEntriesCtes({ sourceLanguage, formCondition }) {
  return `
    word_analyses AS (
      SELECT
        form.normalized_form AS normalizedForm,
        form.display_form AS displayForm,
        form.tags_json AS tagsJson,
        owner.id AS ownerId,
        owner.normalized_lemma AS normalizedLemma,
        owner.part_of_speech AS partOfSpeech
      FROM dictionary_forms AS form
      INNER JOIN dictionary_lexemes AS owner ON owner.id = form.lexeme_id
      WHERE form.source_language = ${sourceLanguage}
        AND form.normalized_form ${formCondition}
        AND owner.review_status = 'approved'
    ),
    form_entries AS (
      SELECT lexemeId, normalizedForm, MIN(displayForm) AS displayForm, tagsJson, MIN(shared) AS shared
      FROM (
        SELECT ownerId AS lexemeId, normalizedForm, displayForm, tagsJson, 0 AS shared
        FROM word_analyses
        UNION ALL
        SELECT lexeme.id, analysis.normalizedForm, analysis.displayForm, analysis.tagsJson, 1
        FROM word_analyses AS analysis
        INNER JOIN dictionary_lexemes AS lexeme
          ON lexeme.source_language = ${sourceLanguage}
          AND lexeme.normalized_lemma = analysis.normalizedLemma
          AND ${canonicalPartOfSpeechSql("lexeme.part_of_speech")} = ${canonicalPartOfSpeechSql("analysis.partOfSpeech")}
        WHERE lexeme.id <> analysis.ownerId
          AND EXISTS (
            SELECT 1 FROM dictionary_senses AS sense
            INNER JOIN dictionary_translations AS translation ON translation.sense_id = sense.id
            WHERE sense.lexeme_id = analysis.ownerId
              AND translation.target_language = '${FORMS_REFERENCE_LANGUAGE}'
              AND translation.review_status = 'approved'
          )
      )
      GROUP BY lexemeId, normalizedForm, tagsJson
    )`;
}

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

// Dictionary updates only add rows, and a newer Wiktionary source gives the same
// word a new entry id, so one word can arrive as several identical entries.
// Show each lemma and part of speech once, with its translations and forms merged
// (the part of speech is already canonical, so "adj" and "adjective" meet here).
function mergeDuplicateEntries(entries) {
  const merged = new Map();
  for (const entry of entries) {
    const key = `${entry.normalizedLemma}\u0000${entry.partOfSpeech}`;
    let existing = merged.get(key);
    if (!existing) {
      existing = { ...entry, forms: [...entry.forms], translations: [] };
      merged.set(key, existing);
    }
    for (const form of entry.forms) {
      const signature = JSON.stringify(form.tags);
      if (!existing.forms.some((known) => JSON.stringify(known.tags) === signature)) existing.forms.push(form);
    }
    for (const translation of entry.translations) {
      const known = existing.translations.find((item) => item.text === translation.text);
      if (!known) existing.translations.push(translation);
      else if (translation.preferred) known.preferred = true;
    }
    existing.translations = existing.translations.slice(0, MAX_TRANSLATIONS_PER_LEXEME);
  }
  return [...merged.values()];
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

async function readMatchingForms(db, sourceLanguage, normalizedWord, targetLanguage) {
  return db
    .prepare(`
      WITH ${formEntriesCtes({ sourceLanguage: "?1", formCondition: "= ?2" })}
      SELECT
        lexeme.id AS lexemeId,
        lexeme.lemma,
        lexeme.normalized_lemma AS normalizedLemma,
        lexeme.part_of_speech AS partOfSpeech,
        lexeme.source_id AS sourceId,
        entry.displayForm,
        entry.tagsJson
      FROM form_entries AS entry
      INNER JOIN dictionary_lexemes AS lexeme ON lexeme.id = entry.lexemeId
      WHERE lexeme.review_status = 'approved'
        -- Only entries with a translation in the asked language compete for the
        -- limit below; otherwise other languages' entries push them out.
        AND EXISTS (
          SELECT 1 FROM dictionary_senses AS sense
          JOIN dictionary_translations AS translation ON translation.sense_id = sense.id
          WHERE sense.lexeme_id = lexeme.id
            AND translation.target_language = ?4
            AND translation.review_status = 'approved'
        )
      ORDER BY
        CASE WHEN lexeme.normalized_lemma = ?2 THEN 0 ELSE 1 END,
        lexeme.lemma ASC,
        ${canonicalPartOfSpeechSql("lexeme.part_of_speech")} ASC,
        entry.shared ASC,
        entry.tagsJson ASC,
        -- Entries for the same word otherwise tie; keep the source's order
        -- («бути» "być" before its use as a future-tense auxiliary).
        lexeme.rowid ASC
      LIMIT ?3
    `)
    .bind(sourceLanguage, normalizedWord, MAX_FORM_ROWS, targetLanguage)
    .all();
}

async function readStoryPreference(db, storyId, normalizedWord, targetLanguage) {
  return db
    .prepare(`
      SELECT sense_id AS senseId
      FROM story_dictionary_preferences
      WHERE story_id = ?1 AND normalized_form = ?2 AND target_language = ?3
      LIMIT 1
    `)
    .bind(storyId, normalizedWord, targetLanguage)
    .first();
}

export async function lookupDictionaryWord(
  db,
  { text, sourceLanguage = "uk", targetLanguage = "en", storyId = null }
) {
  const normalizedWord = canonicalizeUkrainianWord(text);
  if (!normalizedWord) {
    throw new TypeError("Select one Ukrainian word, not a phrase.");
  }

  // The language pair, the matching forms and the story's preferred sense do not
  // depend on each other, so they are read together: one round trip to D1
  // instead of three before the translations.
  const hasStory = Number.isSafeInteger(storyId) && storyId > 0;
  const [pair, formResult, preference] = await Promise.all([
    getDictionaryLanguagePair(db, sourceLanguage, targetLanguage),
    readMatchingForms(db, sourceLanguage, normalizedWord, targetLanguage),
    hasStory ? readStoryPreference(db, storyId, normalizedWord, targetLanguage) : null,
  ]);

  if (!pair) {
    return { supported: false, normalizedWord, entries: [], attribution: null };
  }

  const lexemes = new Map();
  for (const row of formResult.results || []) {
    if (!lexemes.has(row.lexemeId) && lexemes.size >= MAX_LEXEMES) continue;

    const entry = lexemes.get(row.lexemeId) || {
      id: row.lexemeId,
      lemma: row.lemma,
      normalizedLemma: row.normalizedLemma,
      partOfSpeech: canonicalPartOfSpeech(row.partOfSpeech),
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
  const preferredSenseId = preference?.senseId || null;

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

  const entries = mergeDuplicateEntries([...lexemes.values()])
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
