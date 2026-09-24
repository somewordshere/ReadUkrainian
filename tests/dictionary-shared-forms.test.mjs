// Ukrainian word forms are shared by every translation language: an entry is
// found through the English dictionary's forms of the same lemma and part of
// speech (FORMS_REFERENCE_LANGUAGE in functions/_shared/dictionary.js). Polish
// entries carry no forms at all and rely on this.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { lookupDictionaryWord } from "../functions/_shared/dictionary.js";
import { analyzeDictionaryCoverage } from "../functions/_shared/dictionary-workflow.js";
import { seedDatabase } from "../scripts/lib/seed-database.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const migration = (name) => readFileSync(join(ROOT, "migrations", name), "utf8");

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration("0011_dictionary_schema.sql"));
  sqlite.exec(migration("0013_dictionary_workflow.sql"));
  for (const language of ["en", "de", "pl"]) {
    sqlite.exec(`INSERT INTO dictionary_language_pairs (source_language, target_language, enabled, source_name, source_url, source_revision, license_name, license_url)
      VALUES ('uk', '${language}', 1, 'Test', 'https://example.com', '2026-09-24', 'CC BY-SA 4.0', 'https://example.com')`);
  }
  const entry = (id, lemma, pos, language, translation, forms = [], status = "approved") => {
    sqlite.exec(`INSERT INTO dictionary_lexemes (id, source_language, lemma, normalized_lemma, part_of_speech, source_entry_id, review_status)
      VALUES ('${id}', 'uk', '${lemma}', '${lemma}', '${pos}', '${id}', '${status}')`);
    for (const [form, tags] of forms) {
      sqlite.exec(`INSERT INTO dictionary_forms (lexeme_id, source_language, normalized_form, display_form, tags_json)
        VALUES ('${id}', 'uk', '${form}', '${form}', '${JSON.stringify(tags)}')`);
    }
    sqlite.exec(`INSERT INTO dictionary_senses (id, lexeme_id, sense_order) VALUES ('s_${id}', '${id}', 1)`);
    sqlite.exec(`INSERT INTO dictionary_translations (sense_id, target_language, translation, translation_order)
      VALUES ('s_${id}', '${language}', '${translation}', 1)`);
  };
  entry("en_have", "мати", "verb", "en", "to have", [["мати", ["infinitive"]], ["маю", ["first-person", "present", "singular"]]]);
  entry("en_mother", "мати", "noun", "en", "mother", [["мати", ["nominative", "singular"]], ["матері", ["genitive", "singular"]]]);
  entry("en_pretty", "гарний", "adj", "en", "pretty", [["гарну", ["accusative", "feminine", "singular"]]]);
  entry("en_pending", "ліс", "noun", "en", "forest", [["лісом", ["instrumental", "singular"]]], "pending");
  entry("de_forest", "ліс", "noun", "de", "Wald", [["лісу", ["genitive", "singular"]]]);
  entry("pl_have", "мати", "verb", "pl", "mieć");
  entry("pl_mother", "мати", "noun", "pl", "matka");
  entry("pl_pretty", "гарний", "adjective", "pl", "ładny");
  entry("pl_forest", "ліс", "noun", "pl", "las");
  entry("pl_pretty_second", "гарний", "adjective", "pl", "piękny");
  return { sqlite, db: seedLikeDb(sqlite) };
}

function seedLikeDb(sqlite) {
  return { prepare(sql) {
    const statement = sqlite.prepare(sql);
    let params = [];
    const query = {
      bind(...values) { params = values; return query; },
      async first() { return statement.get(...params) ?? null; },
      async all() { return { results: statement.all(...params) }; },
    };
    return query;
  } };
}

const shown = async (db, text, targetLanguage = "pl") => (await lookupDictionaryWord(db, { text, targetLanguage })).entries
  .map((entry) => `${entry.lemma}/${entry.partOfSpeech}: ${entry.translations.map((item) => item.text).join(", ")}`);

test("an entry with no forms of its own is found through the English forms of its lemma and part of speech", async () => {
  const { sqlite, db } = database();
  try {
    assert.deepEqual(await shown(db, "маю"), ["мати/verb: mieć"]);
    assert.deepEqual(await shown(db, "матері"), ["мати/noun: matka"]);
    assert.deepEqual(await shown(db, "мати"), ["мати/noun: matka", "мати/verb: mieć"]);
    const [entry] = (await lookupDictionaryWord(db, { text: "маю", targetLanguage: "pl" })).entries;
    assert.deepEqual(entry.forms.map((form) => form.grammar), [{ number: "singular", tense: "present", person: "first-person" }]);
  } finally {
    sqlite.close();
  }
});

test("'adj' and 'adjective' are one part of speech, reported spelled out", async () => {
  const { sqlite, db } = database();
  try {
    // Two Polish entries for the same lemma merge, in the order they were added.
    assert.deepEqual(await shown(db, "гарну"), ["гарний/adjective: ładny, piękny"]);
    assert.deepEqual(await shown(db, "гарну", "en"), ["гарний/adjective: pretty"]);
  } finally {
    sqlite.close();
  }
});

test("only approved English entries share their forms; other languages' forms stay their own", async () => {
  const { sqlite, db } = database();
  try {
    assert.deepEqual(await shown(db, "лісом"), [], "a pending English entry shares nothing");
    assert.deepEqual(await shown(db, "лісу"), [], "German forms do not reach Polish");
    assert.deepEqual(await shown(db, "лісу", "de"), ["ліс/noun: Wald"]);
  } finally {
    sqlite.close();
  }
});

test("coverage counts a word exactly when a lookup shows it", async () => {
  const { sqlite, db } = database();
  try {
    const coverage = await analyzeDictionaryCoverage(db, ["Маю гарну матір, лісу, лісом."], { targetLanguage: "pl" });
    assert.deepEqual(coverage.missing.map((item) => item.word), ["лісом", "лісу", "матір"]);
    for (const word of ["маю", "гарну"]) assert.ok((await shown(db, word)).length, word);
  } finally {
    sqlite.close();
  }
});

test("the Polish build keeps story lemmas only, files them as English does and cleans glosses", async () => {
  const directory = mkdtempSync(join(tmpdir(), "readukrainian-polish-"));
  try {
    const entry = (word, pos, gloss) => JSON.stringify({ word, pos, lang: "język ukraiński", lang_code: "uk", senses: [{ glosses: [gloss] }] });
    writeFileSync(join(directory, "pl.jsonl"), [
      entry("я", "character", "minuskuła trzydziestej trzeciej litery alfabetu ukraińskiego"),
      entry("я", "pron", "ja"),
      entry("цей", "pron", "ten"),
      entry("це", "pron", "to; zob. цей"),
      entry("на", "prep", "…wyrażający cel: na"),
      entry("читати", "verb", "czytać"),
      entry("аба", "noun", "aba (tkanina)"),
      entry("кіт", "noun", "kot"),
    ].join("\n"));
    writeFileSync(join(directory, "content.json"), JSON.stringify([
      { level: "A1", paragraphs: ["Я читаю цього. Це на. Аба."] },
    ]));
    const output = join(directory, "pl.sql");
    const report = JSON.parse(execFileSync(process.execPath, [
      join(ROOT, "scripts/dictionary/build-dictionary-seed.mjs"),
      "--source", join(directory, "pl.jsonl"), "--content", join(directory, "content.json"),
      "--revision", "2026-09-20", "--target", "pl", "--output", output,
    ], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    const sql = readFileSync(output, "utf8");

    assert.deepEqual(report.refiled, ["«цей» pron as determiner"]);
    assert.equal(report.forms, 0);
    assert.doesNotMatch(sql, /INTO dictionary_forms/u);
    assert.doesNotMatch(sql, /minuskuła|zob\.|кіт|аба/u, "letters, cross-references, unreached and noun-for-name entries are left out");
    assert.match(sql, /'цей', 'цей', 'determiner'/u);
    assert.match(sql, /'na \(wyrażający cel\)'/u);

    const { sqlite, db } = seedDatabase({ before: "0035" });
    try {
      sqlite.exec(sql);
      assert.deepEqual(await shown(db, "читаю"), ["читати/verb: czytać"]);
      assert.deepEqual(await shown(db, "цього"), ["цей/determiner: ten"]);
      assert.deepEqual(await shown(db, "це"), ["це/pronoun: to", "цей/determiner: ten"]);
      assert.deepEqual(await shown(db, "я"), ["я/pronoun: ja"]);
    } finally {
      sqlite.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
