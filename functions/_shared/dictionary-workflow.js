import {
  canonicalizeUkrainianWord,
  extractUkrainianWords,
  normalizeUkrainianText,
} from "./ukrainian-word.js";

const QUERY_CHUNK_SIZE = 80;

export const DICTIONARY_PARTS_OF_SPEECH = Object.freeze([
  "adjective",
  "adverb",
  "conjunction",
  "interjection",
  "name",
  "noun",
  "numeral",
  "particle",
  "preposition",
  "pronoun",
  "proper-noun",
  "verb",
]);

export const DICTIONARY_GRAMMAR_TAGS = Object.freeze([
  "accusative",
  "adverbial",
  "comparative",
  "conditional",
  "dative",
  "feminine",
  "first-person",
  "future",
  "gender-not-distinguished",
  "genitive",
  "imperative",
  "imperfective",
  "infinitive",
  "instrumental",
  "locative",
  "masculine",
  "neuter",
  "nominative",
  "participle",
  "past",
  "perfective",
  "plural",
  "present",
  "second-person",
  "singular",
  "superlative",
  "third-person",
  "vocative",
]);

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export async function analyzeDictionaryCoverage(
  db,
  paragraphs,
  { targetLanguage = "en" } = {}
) {
  const counts = new Map();
  (Array.isArray(paragraphs) ? paragraphs : []).forEach((paragraph) => {
    extractUkrainianWords(paragraph).forEach((word) => {
      counts.set(word, (counts.get(word) || 0) + 1);
    });
  });

  const words = [...counts.keys()];
  const covered = new Set();

  for (const wordChunk of chunk(words, QUERY_CHUNK_SIZE)) {
    const placeholders = wordChunk.map((_, index) => `?${index + 2}`).join(", ");
    const result = await db
      .prepare(`
        SELECT DISTINCT form.normalized_form AS normalizedForm
        FROM dictionary_forms AS form
        INNER JOIN dictionary_lexemes AS lexeme ON lexeme.id = form.lexeme_id
        INNER JOIN dictionary_senses AS sense ON sense.lexeme_id = lexeme.id
        INNER JOIN dictionary_translations AS translation ON translation.sense_id = sense.id
        WHERE translation.target_language = ?1
          AND translation.review_status = 'approved'
          AND lexeme.review_status = 'approved'
          AND form.source_language = 'uk'
          AND form.normalized_form IN (${placeholders})
      `)
      .bind(targetLanguage, ...wordChunk)
      .all();

    (result.results || []).forEach((row) => covered.add(row.normalizedForm));
  }

  const missing = words
    .filter((word) => !covered.has(word))
    .sort((left, right) => left.localeCompare(right, "uk"))
    .map((word) => ({ word, count: counts.get(word) }));

  return {
    available: true,
    targetLanguage,
    totalUniqueWords: words.length,
    coveredUniqueWords: covered.size,
    missingCount: missing.length,
    coveragePercent: words.length ? Number(((covered.size / words.length) * 100).toFixed(1)) : 100,
    missing,
  };
}

export async function analyzeEnabledDictionaryCoverage(db, paragraphs) {
  const result = await db.prepare(`
    SELECT target_language AS targetLanguage
    FROM dictionary_language_pairs
    WHERE source_language = 'uk' AND enabled = 1
    ORDER BY target_language ASC
  `).all();
  const coverages = [];
  for (const row of result.results || []) {
    coverages.push(await analyzeDictionaryCoverage(db, paragraphs, {
      targetLanguage: row.targetLanguage,
    }));
  }
  return coverages;
}

export function validateDictionarySuggestion(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, message: "Dictionary suggestion details are required." };
  }

  const allowedKeys = new Set([
    "word",
    "lemma",
    "partOfSpeech",
    "tags",
    "targetLanguage",
    "translation",
    "explanation",
  ]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    return { ok: false, message: "The dictionary suggestion contains unsupported fields." };
  }

  const normalizedForm = canonicalizeUkrainianWord(payload.word, {
    allowSurroundingPunctuation: false,
  });
  const normalizedLemma = canonicalizeUkrainianWord(payload.lemma, {
    allowSurroundingPunctuation: false,
  });
  const partOfSpeech = String(payload.partOfSpeech || "").trim();
  const targetLanguage = String(payload.targetLanguage || "").trim().toLowerCase();
  const translation = String(payload.translation || "").trim();
  const explanation = String(payload.explanation || "").trim();
  const tags = Array.isArray(payload.tags)
    ? [...new Set(payload.tags.map((tag) => String(tag).trim()).filter(Boolean))].sort()
    : [];

  if (!normalizedForm || !normalizedLemma) {
    return { ok: false, message: "Word and lemma must each be one Ukrainian word." };
  }
  if (!DICTIONARY_PARTS_OF_SPEECH.includes(partOfSpeech)) {
    return { ok: false, message: "Select a supported part of speech." };
  }
  if (!/^[a-z]{2}$/u.test(targetLanguage)) {
    return { ok: false, message: "Target language must be a two-letter language code." };
  }
  if (!translation || translation.length > 500) {
    return { ok: false, message: "Translation must contain between 1 and 500 characters." };
  }
  if (explanation.length > 500) {
    return { ok: false, message: "Explanation must not exceed 500 characters." };
  }
  if (tags.some((tag) => !DICTIONARY_GRAMMAR_TAGS.includes(tag))) {
    return { ok: false, message: "The suggestion contains an unsupported grammar tag." };
  }

  return {
    ok: true,
    value: {
      displayForm: normalizeUkrainianText(payload.word),
      normalizedForm,
      lemma: String(payload.lemma).trim().normalize("NFC"),
      normalizedLemma,
      partOfSpeech,
      tags,
      targetLanguage,
      translation,
      explanation,
    },
  };
}

export function normalizeSuggestionRow(row) {
  let tags = [];
  try {
    const parsed = JSON.parse(row.tagsJson);
    if (Array.isArray(parsed)) tags = parsed;
  } catch {
    // Invalid stored tags are displayed as an empty list and cannot affect lookup.
  }

  return {
    suggestionId: Number(row.suggestionId),
    word: row.displayForm,
    lemma: row.lemma,
    partOfSpeech: row.partOfSpeech,
    tags,
    targetLanguage: row.targetLanguage,
    translation: row.translation,
    explanation: row.explanation || "",
    status: row.status,
    suggestedByEmail: row.suggestedByEmail,
    suggestedAt: row.suggestedAt,
    reviewedByEmail: row.reviewedByEmail || null,
    reviewedAt: row.reviewedAt || null,
    reviewNote: row.reviewNote || "",
  };
}
