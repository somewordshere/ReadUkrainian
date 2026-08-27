#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import readline from "node:readline";

import {
  canonicalizeUkrainianWord,
  extractUkrainianWords,
  normalizeUkrainianText,
} from "../../functions/_shared/ukrainian-word.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const DEFAULT_CONTENT = resolve(PROJECT_ROOT, "data/content-seed.json");
const SOURCE_LANGUAGE = "uk";
const SOURCE_CONFIGS = Object.freeze({
  en: Object.freeze({
    output: resolve(PROJECT_ROOT, "migrations/0012_dictionary_uk_en_seed.sql"),
    sourceId: "kaikki-wiktionary",
    sourceName: "English Wiktionary via Kaikki.org",
    sourceUrl: "https://kaikki.org/dictionary/Ukrainian/",
    licenseName: "CC BY-SA 4.0 / GFDL",
    licenseUrl: "https://en.wiktionary.org/wiki/Wiktionary:Copyrights",
  }),
  de: Object.freeze({
    output: resolve(PROJECT_ROOT, "migrations/0015_dictionary_uk_de_seed.sql"),
    sourceId: "kaikki-dewiktionary",
    sourceName: "German Wiktionary via Kaikki.org",
    sourceUrl: "https://kaikki.org/dewiktionary/Ukrainisch/",
    licenseName: "CC BY-SA 4.0 / GFDL",
    licenseUrl: "https://de.wiktionary.org/wiki/Wiktionary:Lizenzbestimmungen",
  }),
});
const GENDER_TAGS = new Set(["masculine", "feminine", "neuter"]);
const IGNORED_FORM_TAGS = new Set([
  "canonical",
  "class",
  "error-unrecognized-form",
  "form-of",
  "inflection-template",
  "romanization",
  "table-tags",
]);

function usage() {
  return `Build a compact Ukrainian translation dictionary seed from Kaikki JSONL.

Usage:
  node scripts/dictionary/build-dictionary-seed.mjs --source PATH --revision YYYY-MM-DD [options]

Options:
  --source PATH          Kaikki Ukrainian JSONL file (required).
  --revision DATE        Source snapshot/dump date (required).
  --target en|de         Translation language (default: en).
  --scope story|all      Include current story forms or every dictionary form (default: story).
  --content PATH         Story seed JSON used by story scope (default: data/content-seed.json).
  --forms-source PATH    Optional Kaikki JSONL source with richer Ukrainian inflections.
  --since PATH           Already-applied seed whose statements to omit. Repeatable.
  --output PATH          Generated SQL file (default depends on target language).
  --help                 Show this message.
`;
}

function parseArgs(argv) {
  const options = {
    source: "",
    revision: "",
    targetLanguage: "en",
    scope: "story",
    content: DEFAULT_CONTENT,
    formsSource: "",
    output: "",
    since: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      return value;
    };

    switch (argument) {
      case "--source":
        options.source = resolve(nextValue());
        break;
      case "--revision":
        options.revision = nextValue();
        break;
      case "--target":
        options.targetLanguage = nextValue().toLowerCase();
        break;
      case "--scope":
        options.scope = nextValue();
        break;
      case "--content":
        options.content = resolve(nextValue());
        break;
      case "--forms-source":
        options.formsSource = resolve(nextValue());
        break;
      case "--since":
        options.since.push(resolve(nextValue()));
        break;
      case "--output":
        options.output = resolve(nextValue());
        break;
      case "--help":
      case "-h":
        process.stdout.write(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${argument}\n\n${usage()}`);
    }
  }

  if (!options.source) throw new Error("--source is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(options.revision)) {
    throw new Error("--revision must use YYYY-MM-DD.");
  }
  if (options.scope !== "story" && options.scope !== "all") {
    throw new Error("--scope must be story or all.");
  }
  if (!SOURCE_CONFIGS[options.targetLanguage]) {
    throw new Error("--target must be en or de.");
  }
  if (!options.output) options.output = SOURCE_CONFIGS[options.targetLanguage].output;

  return options;
}

function hashId(prefix, value) {
  return `${prefix}_${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 24)}`;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function compactTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : [])
    .filter((tag) => typeof tag === "string" && !IGNORED_FORM_TAGS.has(tag)))]
    .sort();
}

function collapseVerbPluralGenders(analyses) {
  const grouped = new Map();

  analyses.forEach(({ displayForm, tags }) => {
    const genders = tags.filter((tag) => GENDER_TAGS.has(tag));
    const withoutGender = tags.filter((tag) => !GENDER_TAGS.has(tag));
    const collapsible = withoutGender.includes("past") && withoutGender.includes("plural") && genders.length;
    const key = JSON.stringify(collapsible ? withoutGender : tags);
    const group = grouped.get(key) || {
      displayForm,
      tags: collapsible ? withoutGender : tags,
      genders: new Set(),
    };
    genders.forEach((gender) => group.genders.add(gender));
    grouped.set(key, group);
  });

  return [...grouped.values()].map((group) => ({
    displayForm: group.displayForm,
    tags: group.genders.size > 1
      ? [...group.tags, "gender-not-distinguished"].sort()
      : [...group.tags, ...group.genders].sort(),
  }));
}

async function loadStoryWords(contentPath) {
  const stories = JSON.parse(await readFile(contentPath, "utf8"));
  if (!Array.isArray(stories)) throw new Error("Story content must be an array.");

  const words = new Set();
  stories
    .filter((story) => story?.active !== false)
    .forEach((story) => {
      (story.paragraphs || []).forEach((paragraph) => {
        extractUkrainianWords(paragraph).forEach((word) => words.add(word));
      });
    });
  return words;
}

async function scanDictionaryEntries(sourcePath, visit) {
  const input = createReadStream(sourcePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let sourceLines = 0;

  for await (const line of lines) {
    sourceLines += 1;
    if (!line.trim()) continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON on source line ${sourceLines}.`);
    }
    visit(entry);
  }

  return sourceLines;
}

async function collectFormAliases(sourcePath, wantedWords) {
  const aliases = new Map();

  await scanDictionaryEntries(sourcePath, (entry) => {
    if (entry?.lang_code !== SOURCE_LANGUAGE || typeof entry.word !== "string" || typeof entry.pos !== "string") {
      return;
    }
    const normalizedForm = canonicalizeUkrainianWord(entry.word, {
      allowSurroundingPunctuation: false,
    });
    if (!normalizedForm || (wantedWords && !wantedWords.has(normalizedForm))) return;

    (entry.senses || []).forEach((sense) => {
      const parent = sense?.form_of?.[0]?.word || sense?.alt_of?.[0]?.word;
      const normalizedParent = canonicalizeUkrainianWord(parent, {
        allowSurroundingPunctuation: false,
      });
      if (!normalizedParent) return;

      const key = `${entry.pos}\u0000${normalizedParent}`;
      const forms = aliases.get(key) || new Map();
      const senseTags = sense?.form_of ? compactTags(sense.tags) : [];
      const normalizedSenseTags = entry.pos === "verb"
        && senseTags.includes("past")
        && senseTags.includes("plural")
        && !senseTags.some((tag) => GENDER_TAGS.has(tag))
        ? [...senseTags, "gender-not-distinguished"].sort()
        : senseTags;
      const entryForms = getEntryForms(entry, wantedWords);

      if (normalizedSenseTags.length) {
        entryForms.set(normalizedForm, [{
          displayForm: normalizeUkrainianText(entry.word),
          tags: normalizedSenseTags,
        }]);
      }

      entryForms.forEach((newAnalyses, form) => {
        const analyses = forms.get(form) || [];
        newAnalyses.forEach((analysis) => {
          const signature = JSON.stringify(analysis.tags);
          if (!analyses.some((existing) => JSON.stringify(existing.tags) === signature)) {
            analyses.push(analysis);
          }
        });
        forms.set(form, analyses);
      });
      aliases.set(key, forms);
    });
  });

  return aliases;
}

function getEntryForms(entry, wantedWords) {
  const analysesByForm = new Map();
  const listedForms = Array.isArray(entry.forms) ? entry.forms : [];
  const normalizedLemma = canonicalizeUkrainianWord(entry.word, {
    allowSurroundingPunctuation: false,
  });
  const hasListedLemma = listedForms.some((candidate) => (
    canonicalizeUkrainianWord(candidate?.form, { allowSurroundingPunctuation: false })
      === normalizedLemma
  ));
  const candidates = hasListedLemma
    ? listedForms
    : [{ form: entry.word, tags: ["canonical"] }, ...listedForms];

  candidates.forEach((candidate) => {
    const normalizedForm = canonicalizeUkrainianWord(candidate?.form, {
      allowSurroundingPunctuation: false,
    });
    if (!normalizedForm || (wantedWords && !wantedWords.has(normalizedForm))) return;
    if (candidate.tags?.some((tag) => ["romanization", "table-tags", "inflection-template", "error-unrecognized-form"].includes(tag))) {
      return;
    }

    const analyses = analysesByForm.get(normalizedForm) || [];
    const tags = compactTags(candidate.tags);
    const signature = JSON.stringify(tags);
    if (!analyses.some((analysis) => JSON.stringify(analysis.tags) === signature)) {
      analyses.push({ displayForm: normalizeUkrainianText(candidate.form), tags });
    }
    analysesByForm.set(normalizedForm, analyses);
  });

  if (entry.pos === "verb") {
    analysesByForm.forEach((analyses, form) => {
      analysesByForm.set(form, collapseVerbPluralGenders(analyses));
    });
  }

  analysesByForm.forEach((analyses, form) => {
    if (analyses.length > 1 && analyses.some((analysis) => analysis.tags.length)) {
      analysesByForm.set(form, analyses.filter((analysis) => analysis.tags.length));
    }
  });

  return analysesByForm;
}

function getEntrySenses(entry) {
  return (Array.isArray(entry.senses) ? entry.senses : [])
    .filter((sense) => (
      !sense?.form_of
      && !sense?.alt_of
      && !sense?.tags?.some((tag) => tag === "form-of" || tag === "alt-of")
    ))
    .map((sense) => ({
      sourceId: typeof sense.id === "string" ? sense.id : "",
      translation: typeof sense.glosses?.[0] === "string" ? sense.glosses[0].trim() : "",
      tags: compactTags(sense.tags),
    }))
    .filter((sense) => sense.sourceId && sense.translation)
    .slice(0, 12);
}

// Statements are deterministic: ids are content hashes and the formatting is
// fixed, so a statement identical to one in an already-applied migration will
// have run already, and re-emitting it only grows the file.
async function countSkippableStatements(paths) {
  const seen = new Set();
  for (const path of paths || []) {
    const contents = await readFile(path, "utf8");
    for (const line of contents.split("\n")) {
      const statement = line.trim();
      if (statement && !statement.startsWith("--")) seen.add(line);
    }
  }
  return seen;
}

async function buildDictionary(options) {
  const sourceConfig = SOURCE_CONFIGS[options.targetLanguage];
  const wantedWords = options.scope === "story" ? await loadStoryWords(options.content) : null;
  const formAliases = await collectFormAliases(options.source, wantedWords);
  const supplementalForms = new Map();
  if (options.formsSource) {
    const sourceKeys = new Set();
    await scanDictionaryEntries(options.source, (entry) => {
      if (entry?.lang_code !== SOURCE_LANGUAGE || typeof entry.word !== "string" || typeof entry.pos !== "string") {
        return;
      }
      const normalizedLemma = canonicalizeUkrainianWord(entry.word, {
        allowSurroundingPunctuation: false,
      });
      if (normalizedLemma && getEntrySenses(entry).length) {
        sourceKeys.add(`${entry.pos}\u0000${normalizedLemma}`);
      }
    });

    const supplementalAliases = await collectFormAliases(options.formsSource, wantedWords);
    await scanDictionaryEntries(options.formsSource, (entry) => {
      if (entry?.lang_code !== SOURCE_LANGUAGE || typeof entry.word !== "string" || typeof entry.pos !== "string") {
        return;
      }
      const normalizedLemma = canonicalizeUkrainianWord(entry.word, {
        allowSurroundingPunctuation: false,
      });
      const key = normalizedLemma ? `${entry.pos}\u0000${normalizedLemma}` : "";
      if (!key || !sourceKeys.has(key)) return;

      const forms = getEntryForms(entry, wantedWords);
      supplementalAliases.get(key)?.forEach((analyses, form) => {
        if (!forms.has(form)) forms.set(form, analyses);
      });
      if (!forms.size) return;

      const existing = supplementalForms.get(key) || new Map();
      forms.forEach((analyses, form) => {
        const merged = existing.get(form) || [];
        analyses.forEach((analysis) => {
          const signature = JSON.stringify(analysis.tags);
          if (!merged.some((candidate) => JSON.stringify(candidate.tags) === signature)) {
            merged.push(analysis);
          }
        });
        existing.set(form, merged);
      });
      supplementalForms.set(key, existing);
    });
  }
  const coveredWords = new Set();
  const lexemes = [];
  const sourceLines = await scanDictionaryEntries(options.source, (entry) => {
    if (entry?.lang_code !== SOURCE_LANGUAGE || typeof entry.word !== "string" || typeof entry.pos !== "string") {
      return;
    }

    const forms = getEntryForms(entry, wantedWords);
    const normalizedEntryLemma = canonicalizeUkrainianWord(entry.word, {
      allowSurroundingPunctuation: false,
    });
    const aliases = formAliases.get(`${entry.pos}\u0000${normalizedEntryLemma}`);
    aliases?.forEach((analyses, form) => {
      if (!forms.has(form)) forms.set(form, analyses);
    });
    supplementalForms.get(`${entry.pos}\u0000${normalizedEntryLemma}`)?.forEach((analyses, form) => {
      if (!forms.has(form)) forms.set(form, analyses);
    });
    if (!forms.size) return;
    const senses = getEntrySenses(entry);
    if (!senses.length) return;

    const sourceEntryId = senses.map((sense) => sense.sourceId).join("|");
    const lexemeId = hashId("lex", sourceEntryId);
    const lemma = normalizeUkrainianText(entry.word);
    const normalizedLemma = canonicalizeUkrainianWord(lemma, {
      allowSurroundingPunctuation: false,
    });
    if (!normalizedLemma) return;

    forms.forEach((_analyses, form) => coveredWords.add(form));
    lexemes.push({
      id: lexemeId,
      sourceEntryId,
      lemma,
      normalizedLemma,
      partOfSpeech: entry.pos,
      forms,
      senses,
    });
  });

  const sql = [
    "-- Generated by scripts/dictionary/build-dictionary-seed.mjs.",
    `-- Source: ${sourceConfig.sourceName}, snapshot ${options.revision}.`,
    `-- Scope: ${options.scope}.`,
    "",
    ...(options.targetLanguage === "de" ? [
      `INSERT OR IGNORE INTO dictionary_sources (id, name, url, license_name, license_url, source_kind) VALUES (${sqlString(sourceConfig.sourceId)}, ${sqlString(sourceConfig.sourceName)}, ${sqlString(sourceConfig.sourceUrl)}, ${sqlString(sourceConfig.licenseName)}, ${sqlString(sourceConfig.licenseUrl)}, 'upstream');`,
    ] : []),
    `INSERT INTO dictionary_language_pairs (source_language, target_language, enabled, source_name, source_url, source_revision, license_name, license_url) VALUES (${sqlString(SOURCE_LANGUAGE)}, ${sqlString(options.targetLanguage)}, 1, ${sqlString(sourceConfig.sourceName)}, ${sqlString(sourceConfig.sourceUrl)}, ${sqlString(options.revision)}, ${sqlString(sourceConfig.licenseName)}, ${sqlString(sourceConfig.licenseUrl)}) ON CONFLICT(source_language, target_language) DO UPDATE SET enabled = excluded.enabled, source_name = excluded.source_name, source_url = excluded.source_url, source_revision = excluded.source_revision, license_name = excluded.license_name, license_url = excluded.license_url;`,
  ];

  lexemes.forEach((lexeme) => {
    sql.push(
      options.targetLanguage === "de"
        ? `INSERT OR IGNORE INTO dictionary_lexemes (id, source_language, lemma, normalized_lemma, part_of_speech, source_entry_id, source_id) VALUES (${sqlString(lexeme.id)}, ${sqlString(SOURCE_LANGUAGE)}, ${sqlString(lexeme.lemma)}, ${sqlString(lexeme.normalizedLemma)}, ${sqlString(lexeme.partOfSpeech)}, ${sqlString(lexeme.sourceEntryId)}, ${sqlString(sourceConfig.sourceId)});`
        : `INSERT OR IGNORE INTO dictionary_lexemes (id, source_language, lemma, normalized_lemma, part_of_speech, source_entry_id) VALUES (${sqlString(lexeme.id)}, ${sqlString(SOURCE_LANGUAGE)}, ${sqlString(lexeme.lemma)}, ${sqlString(lexeme.normalizedLemma)}, ${sqlString(lexeme.partOfSpeech)}, ${sqlString(lexeme.sourceEntryId)});`
    );
    lexeme.forms.forEach((analyses, normalizedForm) => {
      analyses.forEach((analysis) => {
        sql.push(
          `INSERT OR IGNORE INTO dictionary_forms (lexeme_id, source_language, normalized_form, display_form, tags_json) VALUES (${sqlString(lexeme.id)}, ${sqlString(SOURCE_LANGUAGE)}, ${sqlString(normalizedForm)}, ${sqlString(analysis.displayForm)}, ${sqlString(JSON.stringify(analysis.tags))});`
        );
      });
    });
    lexeme.senses.forEach((sense, index) => {
      const senseId = hashId("sense", sense.sourceId);
      sql.push(
        `INSERT OR IGNORE INTO dictionary_senses (id, lexeme_id, sense_order, usage_tags_json) VALUES (${sqlString(senseId)}, ${sqlString(lexeme.id)}, ${index + 1}, ${sqlString(JSON.stringify(sense.tags))});`,
        options.targetLanguage === "de"
          ? `INSERT OR IGNORE INTO dictionary_translations (sense_id, target_language, translation, translation_order, source_id) VALUES (${sqlString(senseId)}, ${sqlString(options.targetLanguage)}, ${sqlString(sense.translation)}, 1, ${sqlString(sourceConfig.sourceId)});`
          : `INSERT OR IGNORE INTO dictionary_translations (sense_id, target_language, translation, translation_order) VALUES (${sqlString(senseId)}, ${sqlString(options.targetLanguage)}, ${sqlString(sense.translation)}, 1);`
      );
    });
  });

  // A refresh after a content rewrite re-emits every statement the earlier seed
  // already contains: rebuilding for the 2026-08-27 rewrite produced 20,987
  // statements of which 16,222 were byte-identical to 0012. They are harmless,
  // since every statement is INSERT OR IGNORE, but they made a 4.3 MB migration
  // that was 77% dead weight, and each future rewrite would add another.
  // --since drops statements an already-applied migration will have run.
  const skipped = await countSkippableStatements(options.since);
  const emitted = skipped.size
    ? sql.filter((statement) => !statement.trim() || !skipped.has(statement))
    : sql;

  emitted.push("", "PRAGMA optimize;", "");
  await writeFile(options.output, emitted.join("\n"), "utf8");

  const missingWords = wantedWords
    ? [...wantedWords].filter((word) => !coveredWords.has(word)).sort()
    : [];
  return {
    sourceLines,
    lexemes: lexemes.length,
    forms: lexemes.reduce(
      (total, lexeme) => total + [...lexeme.forms.values()].reduce((sum, forms) => sum + forms.length, 0),
      0
    ),
    senses: lexemes.reduce((total, lexeme) => total + lexeme.senses.length, 0),
    wantedWords: wantedWords?.size ?? null,
    coveredWords: coveredWords.size,
    missingWords,
    output: options.output,
  };
}

try {
  const result = await buildDictionary(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
