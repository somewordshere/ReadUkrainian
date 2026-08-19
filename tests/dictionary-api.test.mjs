import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { lookupDictionaryWord } from "../functions/_shared/dictionary.js";
import {
  canonicalizeUkrainianWord,
  extractUkrainianWords,
} from "../functions/_shared/ukrainian-word.js";
import { onRequestPost } from "../functions/api/dictionary/lookup.js";

function createDictionaryDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE dictionary_language_pairs (
      source_language TEXT NOT NULL,
      target_language TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_revision TEXT NOT NULL,
      license_name TEXT NOT NULL,
      license_url TEXT NOT NULL,
      PRIMARY KEY (source_language, target_language)
    );
    CREATE TABLE dictionary_lexemes (
      id TEXT PRIMARY KEY NOT NULL,
      source_language TEXT NOT NULL,
      lemma TEXT NOT NULL,
      normalized_lemma TEXT NOT NULL,
      part_of_speech TEXT NOT NULL,
      source_id TEXT NOT NULL DEFAULT 'kaikki-wiktionary',
      review_status TEXT NOT NULL DEFAULT 'approved'
    );
    CREATE TABLE dictionary_forms (
      lexeme_id TEXT NOT NULL,
      source_language TEXT NOT NULL,
      normalized_form TEXT NOT NULL,
      display_form TEXT NOT NULL,
      tags_json TEXT NOT NULL
    );
    CREATE TABLE dictionary_senses (
      id TEXT PRIMARY KEY NOT NULL,
      lexeme_id TEXT NOT NULL,
      sense_order INTEGER NOT NULL,
      usage_tags_json TEXT NOT NULL
    );
    CREATE TABLE dictionary_translations (
      sense_id TEXT NOT NULL,
      target_language TEXT NOT NULL,
      translation TEXT NOT NULL,
      translation_order INTEGER NOT NULL,
      source_id TEXT NOT NULL DEFAULT 'kaikki-wiktionary',
      review_status TEXT NOT NULL DEFAULT 'approved'
    );
    CREATE TABLE dictionary_sources (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      url TEXT,
      license_name TEXT,
      license_url TEXT
    );
    CREATE TABLE story_dictionary_preferences (
      story_id INTEGER NOT NULL,
      normalized_form TEXT NOT NULL,
      target_language TEXT NOT NULL,
      sense_id TEXT NOT NULL
    );
    INSERT INTO dictionary_language_pairs VALUES (
      'uk', 'en', 1, 'English Wiktionary via Kaikki.org',
      'https://kaikki.org/dictionary/Ukrainian/', '2026-08-05',
      'CC BY-SA 4.0 / GFDL',
      'https://en.wiktionary.org/wiki/Wiktionary:Copyrights'
    );
    INSERT INTO dictionary_language_pairs VALUES (
      'uk', 'de', 1, 'German Wiktionary via Kaikki.org',
      'https://kaikki.org/dewiktionary/Ukrainisch/', '2026-08-04',
      'CC BY-SA 4.0 / GFDL',
      'https://de.wiktionary.org/wiki/Wiktionary:Lizenzbestimmungen'
    );
    INSERT INTO dictionary_sources VALUES (
      'kaikki-wiktionary', 'English Wiktionary via Kaikki.org',
      'https://kaikki.org/dictionary/Ukrainian/',
      'CC BY-SA 4.0 / GFDL',
      'https://en.wiktionary.org/wiki/Wiktionary:Copyrights'
    );
    INSERT INTO dictionary_sources VALUES (
      'kaikki-dewiktionary', 'German Wiktionary via Kaikki.org',
      'https://kaikki.org/dewiktionary/Ukrainisch/',
      'CC BY-SA 4.0 / GFDL',
      'https://de.wiktionary.org/wiki/Wiktionary:Lizenzbestimmungen'
    );
    INSERT INTO dictionary_lexemes VALUES (
      'lex-have', 'uk', 'мати', 'мати', 'verb', 'kaikki-wiktionary', 'approved'
    );
    INSERT INTO dictionary_forms VALUES (
      'lex-have', 'uk', 'мали', 'мали',
      '["gender-not-distinguished","past","plural"]'
    );
    INSERT INTO dictionary_senses VALUES ('sense-have', 'lex-have', 1, '[]');
    INSERT INTO dictionary_senses VALUES ('sense-obliged', 'lex-have', 2, '[]');
    INSERT INTO dictionary_translations VALUES (
      'sense-have', 'en', 'to have', 1, 'kaikki-wiktionary', 'approved'
    );
    INSERT INTO dictionary_translations VALUES (
      'sense-obliged', 'en', 'to have to; to be obliged (to do something)', 1,
      'kaikki-wiktionary', 'approved'
    );
    INSERT INTO dictionary_translations VALUES (
      'sense-have', 'de', 'haben', 1, 'kaikki-dewiktionary', 'approved'
    );
  `);

  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let parameters = [];
      return {
        bind(...values) {
          parameters = values;
          return this;
        },
        async first() {
          return statement.get(...parameters);
        },
        async all() {
          return { results: statement.all(...parameters) };
        },
        async run() {
          statement.run(...parameters);
          return { success: true };
        },
      };
    },
  };
}

function createContext({
  db = createDictionaryDb(),
  origin = "https://readukrainianapp.com",
  contentType = "application/json",
  payload = { text: "мали", targetLanguage: "en" },
} = {}) {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (contentType !== null) headers.set("content-type", contentType);

  return {
    request: new Request("https://readukrainianapp.com/api/dictionary/lookup", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }),
    env: { DB: db },
  };
}

test("normalizes Ukrainian apostrophes, stress marks, punctuation, and story tokens", () => {
  assert.equal(canonicalizeUkrainianWord(" «МА\u0301ЛИ!» "), "мали");
  assert.equal(canonicalizeUkrainianWord("пів’яблука"), "пів'яблука");
  assert.equal(canonicalizeUkrainianWord("добрий день"), null);
  assert.deepEqual(extractUkrainianWords("Ми мали онлайн-урок."), ["ми", "мали", "онлайн-урок"]);
});

test("looks up an exact form with lemma, tense, number, gender, and translations", async () => {
  const result = await lookupDictionaryWord(createDictionaryDb(), {
    text: "«мали»",
    sourceLanguage: "uk",
    targetLanguage: "en",
  });

  assert.equal(result.supported, true);
  assert.equal(result.normalizedWord, "мали");
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].lemma, "мати");
  assert.deepEqual(result.entries[0].forms[0].grammar, {
    number: "plural",
    gender: "gender-not-distinguished",
    tense: "past",
  });
  assert.deepEqual(
    result.entries[0].translations.map(({ text }) => text),
    ["to have", "to have to; to be obliged (to do something)"]
  );
});

test("returns only the selected word result through the same-origin API", async () => {
  const response = await onRequestPost(createContext({
    payload: { text: "«ма\u0301ли»", targetLanguage: "EN" },
  }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body.query, {
    text: "мали",
    sourceLanguage: "uk",
    targetLanguage: "en",
  });
  assert.equal(body.entries[0].lemma, "мати");
  assert.equal(body.attribution.sourceRevision, "2026-08-05");
});

test("a story-specific preference orders the intended one-word meaning first", async () => {
  const db = createDictionaryDb();
  await db.prepare(`
    INSERT INTO story_dictionary_preferences (
      story_id, normalized_form, target_language, sense_id
    ) VALUES (42, 'мали', 'en', 'sense-obliged')
  `).run();
  const response = await onRequestPost(createContext({
    db,
    payload: { text: "мали", targetLanguage: "en", storyId: 42 },
  }));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.entries[0].translations[0].text, "to have to; to be obliged (to do something)");
  assert.equal(body.entries[0].translations[0].preferred, true);
});

test("returns an empty entry list for a valid word that is not in the server dictionary", async () => {
  const response = await onRequestPost(createContext({
    payload: { text: "марійка", targetLanguage: "en" },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).entries, []);
});

test("rejects phrases, extra fields, cross-origin requests, and wrong content types", async () => {
  const phrase = await onRequestPost(createContext({
    payload: { text: "добрий день", targetLanguage: "en" },
  }));
  const extra = await onRequestPost(createContext({
    payload: { text: "мали", targetLanguage: "en", sourceLanguage: "uk" },
  }));
  const crossOrigin = await onRequestPost(createContext({ origin: "https://example.com" }));
  const wrongType = await onRequestPost(createContext({ contentType: "text/plain" }));

  assert.equal(phrase.status, 422);
  assert.equal(extra.status, 400);
  assert.equal(crossOrigin.status, 403);
  assert.equal(wrongType.status, 415);
});

test("returns German when the installed target language is selected", async () => {
  const response = await onRequestPost(createContext({
    payload: { text: "мали", targetLanguage: "de" },
  }));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.query.targetLanguage, "de");
  assert.equal(body.entries[0].translations[0].text, "haben");
});

test("keeps future target languages explicit until their server data is installed", async () => {
  const response = await onRequestPost(createContext({
    payload: { text: "мали", targetLanguage: "fr" },
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "This dictionary language pair is not available.",
  });
});

test("returns a non-cacheable service error when D1 is unavailable", async () => {
  const response = await onRequestPost(createContext({
    db: {
      prepare() {
        throw new Error("D1 offline");
      },
    },
  }));

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "The dictionary is temporarily unavailable.",
  });
});
