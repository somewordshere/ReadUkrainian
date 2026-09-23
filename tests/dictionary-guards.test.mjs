import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkCanaries,
  checkCanaryDiff,
  checkFormCaps,
  checkFormCrossings,
  checkNewTags,
  collectLemmas,
  crossingKey,
  databaseLookup,
  formTags,
} from "../scripts/lib/dictionary-guards.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const migration = (name) => readFileSync(join(ROOT, "migrations", name), "utf8");

// A tiny German dictionary: я, ти and мама with their own forms.
function dictionary() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration("0011_dictionary_schema.sql"));
  sqlite.exec(migration("0013_dictionary_workflow.sql"));
  sqlite.exec(`INSERT INTO dictionary_language_pairs (source_language, target_language, enabled, source_name, source_url, source_revision, license_name, license_url)
    VALUES ('uk', 'de', 1, 'Test', 'https://example.com', '2026-09-23', 'CC BY-SA 4.0', 'https://example.com')`);
  const lexeme = (id, lemma, pos, forms, translation) => {
    sqlite.exec(`INSERT INTO dictionary_lexemes (id, source_language, lemma, normalized_lemma, part_of_speech, source_entry_id)
      VALUES ('${id}', 'uk', '${lemma}', '${lemma}', '${pos}', '${id}')`);
    for (const form of forms) {
      sqlite.exec(`INSERT INTO dictionary_forms (lexeme_id, source_language, normalized_form, display_form, tags_json)
        VALUES ('${id}', 'uk', '${form}', '${form}', '["nominative"]')`);
    }
    sqlite.exec(`INSERT INTO dictionary_senses (id, lexeme_id, sense_order) VALUES ('s_${id}', '${id}', 1)`);
    sqlite.exec(`INSERT INTO dictionary_translations (sense_id, target_language, translation, translation_order)
      VALUES ('s_${id}', 'de', '${translation}', 1)`);
  };
  lexeme("lex_ja", "я", "pron", ["я", "мене"], "ich");
  lexeme("lex_ty", "ти", "pron", ["ти", "тебе"], "du");
  lexeme("lex_mama", "мама", "noun", ["мама", "мами"], "Mama");
  const db = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    let parameters = [];
    const query = {
      bind(...values) { parameters = values; return query; },
      async first() { return statement.get(...parameters) ?? null; },
      async all() { return { results: statement.all(...parameters) }; },
    };
    return query;
  } };
  return { sqlite, lookup: databaseLookup(db) };
}

// Today's bug in miniature: я and мене filed under ти, with a tag never seen before.
const PRONOUN_TABLE = `
  INSERT INTO dictionary_forms (lexeme_id, source_language, normalized_form, display_form, tags_json)
  VALUES ('lex_ty', 'uk', 'я', 'я', '["first-person","personal"]'),
         ('lex_ty', 'uk', 'мене', 'мене', '["first-person","personal"]');`;

test("the canary diff names a common word that gains another word's entry", async () => {
  const { sqlite, lookup } = dictionary();
  try {
    const before = await collectLemmas(lookup, ["я", "мене", "мама"], ["de"]);
    sqlite.exec(PRONOUN_TABLE);
    const failures = checkCanaryDiff(before, await collectLemmas(lookup, ["я", "мене", "мама"], ["de"]), {
      frequency: new Map([["я", 457]]),
    });
    assert.equal(failures.length, 2);
    assert.match(failures[0], /«я» \(457 uses in stories\) gains the lemma «ти»/);
    assert.match(failures[1], /«мене» gains the lemma «ти»/);
    assert.deepEqual(checkCanaryDiff(before, before), []);
  } finally {
    sqlite.close();
  }
});

test("canaries check expected and forbidden lemmas", async () => {
  const { sqlite, lookup } = dictionary();
  try {
    const canaries = [
      { word: "я", expect: { de: ["я"] }, forbid: ["ти"] },
      { word: "мама", expect: { de: ["мама"] }, forbid: ["озимина"] },
    ];
    assert.deepEqual(await checkCanaries(lookup, canaries, { languages: ["de"] }), []);
    sqlite.exec(PRONOUN_TABLE);
    sqlite.exec("DELETE FROM dictionary_forms WHERE lexeme_id = 'lex_mama' AND normalized_form = 'мама'");
    const failures = await checkCanaries(lookup, canaries, { languages: ["de"] });
    assert.equal(failures.length, 2);
    assert.match(failures[0], /«я» shows «ти», which it must never show/);
    assert.match(failures[1], /«мама» no longer shows «мама» \(shows nothing\)/);
  } finally {
    sqlite.close();
  }
});

test("a form that is another entry of the same part of speech needs review", () => {
  const { sqlite } = dictionary();
  try {
    assert.deepEqual(checkFormCrossings(sqlite, new Set(), { languages: ["de"] }), []);
    sqlite.exec(PRONOUN_TABLE);
    const failures = checkFormCrossings(sqlite, new Set(), { languages: ["de"] });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /«я» is filed as a form of «ти» \(pron\)/);
    const approved = new Set([crossingKey({ language: "de", pos: "pron", form: "я", lemma: "ти" })]);
    assert.deepEqual(checkFormCrossings(sqlite, approved, { languages: ["de"] }), []);
  } finally {
    sqlite.close();
  }
});

test("an entry with more forms than its part of speech allows fails", () => {
  const { sqlite } = dictionary();
  try {
    const caps = { pron: 3, noun: 20, default: 12 };
    assert.deepEqual(checkFormCaps(sqlite, caps, { languages: ["de"] }), []);
    sqlite.exec(PRONOUN_TABLE);
    const failures = checkFormCaps(sqlite, caps, { languages: ["de"] });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /«ти» \(pron\) has 4 word forms; the limit for pron is 3/);
  } finally {
    sqlite.close();
  }
});

test("form tags the dictionary has never used stop an update", () => {
  const { sqlite } = dictionary();
  try {
    const before = formTags(sqlite);
    sqlite.exec(PRONOUN_TABLE);
    const failures = checkNewTags(before, formTags(sqlite));
    assert.equal(failures.length, 1);
    assert.match(failures[0], /never used: first-person, personal/);
    assert.deepEqual(checkNewTags(new Set([...before, "first-person", "personal"]), formTags(sqlite)), []);
  } finally {
    sqlite.close();
  }
});

test("the update validation rejects a candidate that files я under another pronoun", () => {
  const directory = mkdtempSync(join(tmpdir(), "readukrainian-guards-"));
  try {
    const candidate = join(directory, "candidate.sql");
    // Additive, like a real update: link «я» to the German entry for «ми».
    writeFileSync(candidate, `INSERT OR IGNORE INTO dictionary_forms (lexeme_id, source_language, normalized_form, display_form, tags_json)
      SELECT lexeme.id, 'uk', 'я', 'я', '["first-person","nominative","singular"]'
      FROM dictionary_lexemes AS lexeme
      JOIN dictionary_senses AS sense ON sense.lexeme_id = lexeme.id
      JOIN dictionary_translations AS translation ON translation.sense_id = sense.id
      WHERE lexeme.normalized_lemma = 'ми' AND lexeme.part_of_speech = 'pron' AND translation.target_language = 'de';\n`);
    const result = spawnSync(process.execPath, [
      join(ROOT, "scripts/dictionary/validate-rebuild.mjs"),
      "--de", candidate, "--output", join(directory, "report.json"),
    ], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Dictionary update guards/);
    assert.match(result.stderr, /«я» \(\d+ uses in stories\) gains the lemma «ми»/);
    assert.match(result.stderr, /«я» \(\d+ uses in stories\) shows «ми», which it must never show/);
    assert.match(result.stderr, /«я» \(\d+ uses in stories\) is filed as a form of «ми» \(pron\)/);
    const report = JSON.parse(readFileSync(join(directory, "report.json"), "utf8"));
    assert.ok(report.guards.failures.length >= 3, "the report is kept for the workflow run");
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the lookup shows a word once even when an update added it again", async () => {
  const { sqlite, lookup } = dictionary();
  try {
    // A newer source gives the same word a new entry id; updates only add rows.
    sqlite.exec(`INSERT INTO dictionary_lexemes (id, source_language, lemma, normalized_lemma, part_of_speech, source_entry_id)
      VALUES ('lex_ja_new', 'uk', 'я', 'я', 'pron', 'lex_ja_new')`);
    sqlite.exec(`INSERT INTO dictionary_forms (lexeme_id, source_language, normalized_form, display_form, tags_json)
      VALUES ('lex_ja_new', 'uk', 'я', 'я', '["nominative"]')`);
    sqlite.exec("INSERT INTO dictionary_senses (id, lexeme_id, sense_order) VALUES ('s_ja_new', 'lex_ja_new', 1), ('s_ja_new2', 'lex_ja_new', 2)");
    sqlite.exec(`INSERT INTO dictionary_translations (sense_id, target_language, translation, translation_order)
      VALUES ('s_ja_new', 'de', 'ich', 1), ('s_ja_new2', 'de', 'ich selbst', 1)`);
    assert.deepEqual(await lookup("я", "de"), ["я"]);
    const { lookupDictionaryWord } = await import("../functions/_shared/dictionary.js");
    const db = { prepare(sql) {
      const statement = sqlite.prepare(sql);
      let parameters = [];
      const query = {
        bind(...values) { parameters = values; return query; },
        async first() { return statement.get(...parameters) ?? null; },
        async all() { return { results: statement.all(...parameters) }; },
      };
      return query;
    } };
    const result = await lookupDictionaryWord(db, { text: "я", targetLanguage: "de" });
    assert.equal(result.entries.length, 1);
    assert.deepEqual(result.entries[0].translations.map((translation) => translation.text), ["ich", "ich selbst"]);
  } finally {
    sqlite.close();
  }
});

test("other languages' entries cannot push a word's entry out of the lookup", async () => {
  const { sqlite, lookup } = dictionary();
  try {
    // Thirteen English-only entries that also list «мене» and sort before «я».
    for (let index = 1; index <= 13; index += 1) {
      const id = `lex_en_${index}`;
      sqlite.exec(`INSERT INTO dictionary_lexemes (id, source_language, lemma, normalized_lemma, part_of_speech, source_entry_id)
        VALUES ('${id}', 'uk', 'а${index}', 'а${index}', 'noun', '${id}')`);
      sqlite.exec(`INSERT INTO dictionary_forms (lexeme_id, source_language, normalized_form, display_form, tags_json)
        VALUES ('${id}', 'uk', 'мене', 'мене', '["genitive"]')`);
      sqlite.exec(`INSERT INTO dictionary_senses (id, lexeme_id, sense_order) VALUES ('s_${id}', '${id}', 1)`);
      sqlite.exec(`INSERT INTO dictionary_translations (sense_id, target_language, translation, translation_order)
        VALUES ('s_${id}', 'en', 'filler ${index}', 1)`);
    }
    assert.deepEqual(await lookup("мене", "de"), ["я"]);
  } finally {
    sqlite.close();
  }
});
