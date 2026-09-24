// Checks that catch a wrong dictionary before learners see it. One implementation
// for the three places that run them:
//   - scripts/dictionary/validate-rebuild.mjs: every update candidate (all checks);
//   - scripts/check-dictionary-coverage.mjs: the whole dictionary on every commit
//     and release (canaries, form caps, duplicate entries, form-is-another-lemma);
//   - scripts/check-live-dictionary.mjs: the live site after releases and daily
//     (canaries).
// Each failure names the word, what went wrong, how often stories use the word,
// and how to approve it if it is in fact correct.
import { readFileSync } from "node:fs";

import { lookupDictionaryWord } from "../../functions/_shared/dictionary.js";
import { extractCanonicalSpeechWords } from "../speech/normalization.mjs";

const DATA = new URL("../../data/dictionary/", import.meta.url);
export const GUARD_LANGUAGES = Object.freeze(["en", "de", "pl"]);

function readJson(name) {
  return JSON.parse(readFileSync(new URL(name, DATA), "utf8"));
}

export function loadGuardConfig() {
  const guards = readJson("guards.json");
  const approved = readJson("approved-forms.json");
  return {
    canaries: readJson("canaries.json").words,
    formCaps: guards.formCaps,
    duplicateEntryCaps: guards.duplicateEntryCaps,
    canaryDiffWords: guards.canaryDiffWords,
    knownTags: guards.knownTags || [],
    approvedForms: new Set(approved.pairs.map(crossingKey)),
  };
}

// How often each canonical word appears across the active stories.
export function storyWordFrequency(stories) {
  const counts = new Map();
  for (const story of stories) {
    if (story.active === false) continue;
    for (const word of extractCanonicalSpeechWords((story.paragraphs || []).join(" "))) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return counts;
}

export function loadStoryWordFrequency() {
  return storyWordFrequency(JSON.parse(readFileSync(new URL("../content-seed.json", DATA), "utf8")));
}

const uses = (frequency, word) => {
  const count = frequency?.get(word);
  return count ? ` (${count} ${count === 1 ? "use" : "uses"} in stories)` : "";
};

// A lookup is (text, language) -> the lemmas learners are shown.
export function databaseLookup(db) {
  return async (text, targetLanguage) => {
    const result = await lookupDictionaryWord(db, { text, targetLanguage });
    return result.entries.map((entry) => entry.normalizedLemma || entry.lemma);
  };
}

// 1. Hand-written expectations for common words: the lemmas each must show in a
// language, and lemmas no language may show for it.
export async function checkCanaries(lookup, canaries, { languages = GUARD_LANGUAGES, frequency } = {}) {
  const failures = [];
  for (const canary of canaries) {
    for (const language of languages) {
      const lemmas = await lookup(canary.word, language);
      for (const lemma of canary.expect?.[language] || []) {
        if (!lemmas.includes(lemma)) {
          failures.push(`${language}: «${canary.word}»${uses(frequency, canary.word)} no longer shows «${lemma}» (shows ${lemmas.map((l) => `«${l}»`).join(", ") || "nothing"}).`);
        }
      }
      for (const lemma of canary.forbid || []) {
        if (lemmas.includes(lemma)) {
          failures.push(`${language}: «${canary.word}»${uses(frequency, canary.word)} shows «${lemma}», which it must never show.`);
        }
      }
    }
  }
  return failures;
}

export async function collectLemmas(lookup, words, languages = GUARD_LANGUAGES) {
  const lemmas = new Map();
  for (const language of languages) {
    for (const word of words) lemmas.set(`${language}\u0000${word}`, await lookup(word, language));
  }
  return lemmas;
}

export function mostFrequentWords(frequency, count) {
  return [...frequency].sort((left, right) => right[1] - left[1]).slice(0, count).map(([word]) => word);
}

// 2. The most used words must not gain a new lemma in an update. Additions to
// rarer words are normal; a new meaning for «я» almost never is.
export function checkCanaryDiff(before, after, { frequency } = {}) {
  const failures = [];
  for (const [key, afterLemmas] of after) {
    const [language, word] = key.split("\u0000");
    const beforeLemmas = before.get(key) || [];
    for (const lemma of afterLemmas.filter((item) => !beforeLemmas.includes(item))) {
      failures.push(`${language}: «${word}»${uses(frequency, word)} gains the lemma «${lemma}». If that meaning is right, add «${word}» → «${lemma}» to data/dictionary/canaries.json as expected.`);
    }
  }
  return failures;
}

// Lexemes learners can see in a language: approved, with an approved translation.
function visibleLexemes(language) {
  return `
    SELECT DISTINCT lexeme.id, lexeme.normalized_lemma AS lemma, lexeme.part_of_speech AS pos
    FROM dictionary_lexemes AS lexeme
    JOIN dictionary_senses AS sense ON sense.lexeme_id = lexeme.id
    JOIN dictionary_translations AS translation ON translation.sense_id = sense.id
    WHERE translation.target_language = '${language}'
      AND lexeme.review_status = 'approved' AND translation.review_status = 'approved'`;
}

// 3. No lexeme may carry more distinct forms than its part of speech allows.
// A whole table of other words filed under one entry shows up here first.
export function checkFormCaps(sqlite, formCaps, { languages = GUARD_LANGUAGES } = {}) {
  const failures = [];
  for (const language of languages) {
    const rows = sqlite.prepare(`
      SELECT lexeme.lemma, lexeme.pos, COUNT(DISTINCT form.normalized_form) AS forms
      FROM (${visibleLexemes(language)}) AS lexeme
      JOIN dictionary_forms AS form ON form.lexeme_id = lexeme.id
      GROUP BY lexeme.id
    `).all();
    for (const row of rows) {
      const cap = formCaps[row.pos] ?? formCaps.default;
      if (row.forms > cap) {
        failures.push(`${language}: «${row.lemma}» (${row.pos}) has ${row.forms} word forms; the limit for ${row.pos} is ${cap}. Check it isn't a table of other words; if the forms are right, raise formCaps.${row.pos} in data/dictionary/guards.json.`);
      }
    }
  }
  return failures;
}

// 4. An update must not add again the entries a language already has. A source
// whose entry IDs changed (a raw dump instead of Kaikki's processed file, as in
// 0033 and 0036) re-adds every entry under a new ID; lookups merge the copies, so
// nothing else shows it.
export function duplicateEntryCounts(sqlite, { languages = GUARD_LANGUAGES } = {}) {
  return Object.fromEntries(languages.map((language) => [language, sqlite.prepare(`
    SELECT COUNT(*) AS words FROM (
      SELECT 1 FROM (${visibleLexemes(language)}) GROUP BY lemma, pos HAVING COUNT(*) > 1
    )
  `).get().words]));
}

export function checkDuplicateEntries(sqlite, caps, { languages = GUARD_LANGUAGES } = {}) {
  const counts = duplicateEntryCounts(sqlite, { languages });
  return languages
    .filter((language) => counts[language] > caps[language])
    .map((language) => `${language}: ${counts[language]} words have more than one entry with the same part of speech; the limit is ${caps[language]}. A dictionary built from a source without Kaikki's meaning IDs adds every entry again under a new ID. If the new entries are real homonyms, raise duplicateEntryCaps.${language} in data/dictionary/guards.json.`);
}

export function crossingKey({ language, pos, form, lemma }) {
  return [language, pos, form, lemma].join("\u0000");
}

// Forms filed under one lemma that are themselves another lemma of the same part
// of speech (я under ти, мама under озимина).
export function formLemmaCrossings(sqlite, { languages = GUARD_LANGUAGES } = {}) {
  const crossings = [];
  for (const language of languages) {
    for (const row of sqlite.prepare(`
      WITH visible AS (${visibleLexemes(language)})
      SELECT DISTINCT form.normalized_form AS form, owner.lemma, owner.pos
      FROM visible AS owner
      JOIN dictionary_forms AS form ON form.lexeme_id = owner.id
      JOIN visible AS other ON other.lemma = form.normalized_form AND other.pos = owner.pos AND other.lemma <> owner.lemma
      WHERE form.normalized_form <> owner.lemma
      ORDER BY form.normalized_form, owner.lemma
    `).all()) {
      crossings.push({ language, pos: row.pos, form: row.form, lemma: row.lemma });
    }
  }
  return crossings;
}

// 4. Every such pair must have been reviewed and listed in approved-forms.json.
export function checkFormCrossings(sqlite, approvedForms, { languages = GUARD_LANGUAGES, frequency } = {}) {
  return formLemmaCrossings(sqlite, { languages })
    .filter((crossing) => !approvedForms.has(crossingKey(crossing)))
    .map(({ language, pos, form, lemma }) => (
      `${language}: «${form}»${uses(frequency, form)} is filed as a form of «${lemma}» (${pos}) although «${form}» is a ${pos} entry of its own. If «${form}» really is a form of «${lemma}», run npm run dictionary:review-forms -- --approve.`
    ));
}

export function formTags(sqlite) {
  const tags = new Set();
  for (const { tagsJson } of sqlite.prepare("SELECT DISTINCT tags_json AS tagsJson FROM dictionary_forms").all()) {
    for (const tag of JSON.parse(tagsJson)) tags.add(tag);
  }
  return tags;
}

// 5. A tag the dictionary has never used means the upstream data changed shape.
export function checkNewTags(beforeTags, afterTags) {
  const added = [...afterTags].filter((tag) => !beforeTags.has(tag)).sort();
  return added.length
    ? [`New form tags the dictionary has never used: ${added.join(", ")}. Kaikki's data may have changed shape; find the forms carrying them in the migration and check they belong to their lemma before merging. If they're fine, add them to knownTags in data/dictionary/guards.json.`]
    : [];
}

export function reportFailures(title, failures) {
  if (!failures.length) return;
  const shown = failures.slice(0, 60);
  const more = failures.length > shown.length ? `\n  … and ${failures.length - shown.length} more` : "";
  throw new Error(`${title}: ${failures.length} problem${failures.length === 1 ? "" : "s"}\n  - ${shown.join("\n  - ")}${more}`);
}
