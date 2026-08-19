#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import {
  canonicalizeUkrainianWord,
  normalizeUkrainianText,
} from "../../functions/_shared/ukrainian-word.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const DEFAULT_OUTPUT = resolve(PROJECT_ROOT, "migrations/0016_dictionary_linguisto_uk_de_seed.sql");
const DEFAULT_LEXEME_SEEDS = Object.freeze([
  resolve(PROJECT_ROOT, "migrations/0015_dictionary_uk_de_seed.sql"),
  resolve(PROJECT_ROOT, "migrations/0012_dictionary_uk_en_seed.sql"),
  resolve(PROJECT_ROOT, "migrations/0014_dictionary_curated_seed.sql"),
]);
const SOURCE_ID = "linguisto-de-uk";
const SOURCE_NAME = "Linguisto German–Ukrainian dictionary";
const SOURCE_URL = "https://sourceforge.net/projects/linguisto/";
const LICENSE_NAME = "Creative Commons Attribution";
const LICENSE_URL = "https://sourceforge.net/projects/linguisto/";
const MAX_TRANSLATIONS_PER_LEXEME = 12;
const PART_OF_SPEECH_ALIASES = Object.freeze({
  adj: "adjective",
  adv: "adverb",
  conj: "conjunction",
  intj: "interjection",
  num: "numeral",
  prep: "preposition",
  pron: "pronoun",
});

const POS_MARKERS = Object.freeze([
  ["proper-noun", ["власн", "іменник"]],
  ["noun", ["іменник"]],
  ["adjective", ["прикметник"]],
  ["adverb", ["прислівник"]],
  ["verb", ["дієслово"]],
  ["pronoun", ["займенник"]],
  ["numeral", ["числівник"]],
  ["preposition", ["прийменник"]],
  ["conjunction", ["сполучник"]],
  ["particle", ["частка"]],
  ["interjection", ["вигук"]],
]);

function usage() {
  return `Build a conservative Ukrainian → German supplement from Linguisto XDXF.

Usage:
  node scripts/dictionary/build-linguisto-seed.mjs --source PATH --revision YYYY-MM-DD [options]

Options:
  --source PATH          Linguisto German–Ukrainian XDXF file (required).
  --revision DATE        Linguisto release date in YYYY-MM-DD format (required).
  --lexeme-seed PATH     Installed dictionary seed to match; repeatable.
                         Defaults to German Kaikki, English Kaikki, then curated.
  --output PATH          Generated SQL file (default: migration 0016).
  --help                 Show this message.

Only exact, single-word Ukrainian equivalents with a matching part of speech and
one unambiguous installed lexeme are approved. Phrases and homonyms are skipped.
`;
}

function parseArgs(argv) {
  const options = {
    source: "",
    revision: "",
    lexemeSeeds: [],
    output: DEFAULT_OUTPUT,
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
      case "--lexeme-seed":
        options.lexemeSeeds.push(resolve(nextValue()));
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
  if (!options.lexemeSeeds.length) options.lexemeSeeds = [...DEFAULT_LEXEME_SEEDS];
  return options;
}

function hashId(prefix, value) {
  return `${prefix}_${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 24)}`;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function decodeXmlText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/gu, "")
    .replace(/&#x([0-9a-f]+);/giu, (_match, hexadecimal) => String.fromCodePoint(Number.parseInt(hexadecimal, 16)))
    .replace(/&#([0-9]+);/gu, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/\s+/gu, " ")
    .trim();
}

function inferPartOfSpeech(article) {
  const grammarValues = [...article.matchAll(/<gr(?:\s[^>]*)?>([\s\S]*?)<\/gr>/giu)]
    .map((match) => normalizeUkrainianText(decodeXmlText(match[1])));
  const matches = new Set();

  grammarValues.forEach((grammar) => {
    for (const [partOfSpeech, markers] of POS_MARKERS) {
      if (markers.every((marker) => grammar.includes(marker))) {
        matches.add(partOfSpeech);
        break;
      }
    }
  });

  return matches.size === 1 ? [...matches][0] : null;
}

function normalizePartOfSpeech(value) {
  return PART_OF_SPEECH_ALIASES[value] || value;
}

function extractHeadwords(article) {
  return [...new Set(
    [...article.matchAll(/<k(?:\s[^>]*)?>([\s\S]*?)<\/k>/giu)]
      .map((match) => decodeXmlText(match[1]))
      .filter(Boolean)
  )];
}

function extractUkrainianEquivalents(article) {
  const equivalents = new Set();

  for (const match of article.matchAll(/<dtrn(?:\s[^>]*)?>([\s\S]*?)<\/dtrn>/giu)) {
    const translation = decodeXmlText(match[1])
      .replace(/\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\}/gu, " ");
    translation.split(/[;,/]/u).forEach((candidate) => {
      const normalized = canonicalizeUkrainianWord(candidate, {
        allowSurroundingPunctuation: true,
      });
      if (normalized) equivalents.add(normalized);
    });
  }

  return equivalents;
}

function extractFrequencyRank(article) {
  const value = article.match(/<def\s+[^>]*freq="(\d+)"[^>]*>/iu)?.[1];
  const rank = Number(value);
  return Number.isSafeInteger(rank) && rank > 0 ? rank : Number.MAX_SAFE_INTEGER;
}

function collectLinguistoCandidates(source) {
  const candidates = new Map();
  let articles = 0;
  let skippedWithoutOnePartOfSpeech = 0;
  let skippedWithoutHeadword = 0;

  for (const match of source.matchAll(/<ar(?:\s[^>]*)?>([\s\S]*?)<\/ar>/giu)) {
    articles += 1;
    const article = match[1];
    const partOfSpeech = inferPartOfSpeech(article);
    if (!partOfSpeech) {
      skippedWithoutOnePartOfSpeech += 1;
      continue;
    }
    const headwords = extractHeadwords(article);
    if (!headwords.length) {
      skippedWithoutHeadword += 1;
      continue;
    }
    const frequencyRank = extractFrequencyRank(article);

    extractUkrainianEquivalents(article).forEach((lemma) => {
      const key = `${partOfSpeech}\u0000${lemma}`;
      const translations = candidates.get(key) || new Map();
      headwords.forEach((headword) => {
        translations.set(headword, Math.min(translations.get(headword) || Number.MAX_SAFE_INTEGER, frequencyRank));
      });
      candidates.set(key, translations);
    });
  }

  return {
    articles,
    candidates,
    skippedWithoutOnePartOfSpeech,
    skippedWithoutHeadword,
  };
}

function parseSqlValues(line) {
  const valuesStart = line.indexOf("VALUES (");
  if (valuesStart < 0) return [];
  const valuesText = line.slice(valuesStart + 8, line.lastIndexOf(");"));
  const values = [];
  const pattern = /'((?:''|[^'])*)'|(-?\d+)/gu;
  for (const match of valuesText.matchAll(pattern)) {
    values.push(match[1] === undefined ? Number(match[2]) : match[1].replaceAll("''", "'"));
  }
  return values;
}

function parseLexemeSeed(seed, seedIndex) {
  const lexemesByKey = new Map();
  const senseOrderByLexeme = new Map();

  seed.split(/\r?\n/u).forEach((line) => {
    if (line.startsWith("INSERT OR IGNORE INTO dictionary_lexemes ")) {
      const values = parseSqlValues(line);
      if (values.length < 5 || values[1] !== "uk") return;
      const lexeme = {
        id: values[0],
        lemma: values[2],
        normalizedLemma: values[3],
        partOfSpeech: normalizePartOfSpeech(values[4]),
        seedIndex,
      };
      const key = `${lexeme.partOfSpeech}\u0000${lexeme.normalizedLemma}`;
      const matches = lexemesByKey.get(key) || [];
      matches.push(lexeme);
      lexemesByKey.set(key, matches);
      return;
    }

    if (line.startsWith("INSERT OR IGNORE INTO dictionary_senses ")) {
      const values = parseSqlValues(line);
      if (values.length < 3) return;
      const order = Number(values[2]);
      senseOrderByLexeme.set(values[1], Math.max(senseOrderByLexeme.get(values[1]) || 0, order));
    }
  });

  return { lexemesByKey, senseOrderByLexeme };
}

function chooseUnambiguousLexeme(key, indexes) {
  for (const index of indexes) {
    const matches = index.lexemesByKey.get(key) || [];
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return null;
  }
  return null;
}

async function buildLinguistoSeed(options) {
  const [source, ...seedFiles] = await Promise.all([
    readFile(options.source, "utf8"),
    ...options.lexemeSeeds.map((path) => readFile(path, "utf8")),
  ]);
  const extracted = collectLinguistoCandidates(source);
  const seedIndexes = seedFiles.map(parseLexemeSeed);
  const nextSenseOrder = new Map();
  seedIndexes.forEach((index) => {
    index.senseOrderByLexeme.forEach((order, lexemeId) => {
      nextSenseOrder.set(lexemeId, Math.max(nextSenseOrder.get(lexemeId) || 0, order));
    });
  });

  const matchedLexemes = new Map();
  let skippedAmbiguousOrMissing = 0;
  extracted.candidates.forEach((translations, key) => {
    const lexeme = chooseUnambiguousLexeme(key, seedIndexes);
    if (!lexeme) {
      skippedAmbiguousOrMissing += 1;
      return;
    }
    const entry = matchedLexemes.get(lexeme.id) || { lexeme, translations: new Map() };
    translations.forEach((rank, translation) => {
      entry.translations.set(
        translation,
        Math.min(entry.translations.get(translation) || Number.MAX_SAFE_INTEGER, rank)
      );
    });
    matchedLexemes.set(lexeme.id, entry);
  });

  const sql = [
    "-- Generated by scripts/dictionary/build-linguisto-seed.mjs.",
    `-- Source: ${SOURCE_NAME}, release ${options.revision}.`,
    "-- Policy: exact single-word Ukrainian equivalents; matching POS; one installed lexeme.",
    "",
    `INSERT OR IGNORE INTO dictionary_sources (id, name, url, license_name, license_url, source_kind) VALUES (${sqlString(SOURCE_ID)}, ${sqlString(`${SOURCE_NAME} (${options.revision})`)}, ${sqlString(SOURCE_URL)}, ${sqlString(LICENSE_NAME)}, ${sqlString(LICENSE_URL)}, 'upstream');`,
  ];

  let translationsWritten = 0;
  [...matchedLexemes.values()]
    .sort((left, right) => left.lexeme.id.localeCompare(right.lexeme.id))
    .forEach(({ lexeme, translations }) => {
      [...translations]
        .sort(([leftTranslation, leftRank], [rightTranslation, rightRank]) => (
          leftRank - rightRank || leftTranslation.localeCompare(rightTranslation, "de")
        ))
        .slice(0, MAX_TRANSLATIONS_PER_LEXEME)
        .forEach(([translation]) => {
          const order = (nextSenseOrder.get(lexeme.id) || 0) + 1;
          nextSenseOrder.set(lexeme.id, order);
          const senseId = hashId("linguisto_sense", `${lexeme.id}\u0000${translation}`);
          sql.push(
            `INSERT OR IGNORE INTO dictionary_senses (id, lexeme_id, sense_order, usage_tags_json) VALUES (${sqlString(senseId)}, ${sqlString(lexeme.id)}, ${order}, '[]');`,
            `INSERT OR IGNORE INTO dictionary_translations (sense_id, target_language, translation, translation_order, source_id, review_status) VALUES (${sqlString(senseId)}, 'de', ${sqlString(translation)}, 1, ${sqlString(SOURCE_ID)}, 'approved');`
          );
          translationsWritten += 1;
        });
    });

  sql.push("", "PRAGMA optimize;", "");
  await writeFile(options.output, sql.join("\n"), "utf8");

  return {
    sourceArticles: extracted.articles,
    candidateLemmaPartsOfSpeech: extracted.candidates.size,
    matchedLexemes: matchedLexemes.size,
    translations: translationsWritten,
    skippedWithoutOnePartOfSpeech: extracted.skippedWithoutOnePartOfSpeech,
    skippedWithoutHeadword: extracted.skippedWithoutHeadword,
    skippedAmbiguousOrMissing,
    output: options.output,
  };
}

try {
  const result = await buildLinguistoSeed(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
