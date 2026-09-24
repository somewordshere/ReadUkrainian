// Every dictionary bug found so far, checked against the real dictionary (all
// migrations) the way a learner looks the word up. Add a case here whenever a
// new one is found, next to the fix.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { lookupDictionaryWord } from "../functions/_shared/dictionary.js";
import { loadStoryWordFrequency, mostFrequentWords } from "../scripts/lib/dictionary-guards.mjs";
import { seedDatabase } from "../scripts/lib/seed-database.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const migration = (name) => readFileSync(join(ROOT, "migrations", name), "utf8");

async function shown(db, text, targetLanguage) {
  return (await lookupDictionaryWord(db, { text, targetLanguage })).entries;
}
const lemmas = (entries) => entries.map((entry) => entry.normalizedLemma);

test("2026-09-23: pronouns show only their own entry (Wiktionary's shared pronoun table)", async () => {
  const { sqlite, db } = seedDatabase();
  try {
    for (const language of ["en", "de"]) {
      for (const [word, own, others] of [
        ["я", "я", ["ти", "ми", "він", "вона", "вони"]],
        ["мене", "я", ["ти", "ми"]],
        ["ми", "ми", ["я", "ти", "вони"]],
        ["вона", "вона", ["я", "ти", "він"]],
      ]) {
        const found = lemmas(await shown(db, word, language));
        assert.ok(found.includes(own), `${language}: «${word}» shows «${own}»`);
        for (const other of others) assert.ok(!found.includes(other), `${language}: «${word}» must not show «${other}»`);
      }
    }
  } finally {
    sqlite.close();
  }
});

// Migration 0031 and scripts/dictionary/form-exclusions.mjs.
const MISLEADING = [
  { form: "по", lemma: "порошенко", pos: "name", languages: ["en", "de"] },
  { form: "мене", lemma: "мен", pos: "name", languages: ["en"] },
  { form: "мені", lemma: "мен", pos: "name", languages: ["en"] },
  { form: "мені", lemma: "мена", pos: "name", languages: ["en"] },
  { form: "серед", lemma: "середа", pos: "noun", languages: ["en", "de"] },
];

test("2026-09-23: misleading real forms are gone (по → Порошенко, мене → Maine, серед → Mittwoch)", async () => {
  const before = seedDatabase({ before: "0031" });
  const after = seedDatabase();
  try {
    for (const { form, lemma, languages } of MISLEADING) {
      for (const language of languages) {
        assert.ok(lemmas(await shown(before.db, form, language)).includes(lemma), `before 0031 ${language}: «${form}» showed «${lemma}»`);
        assert.ok(!lemmas(await shown(after.db, form, language)).includes(lemma), `${language}: «${form}» must not show «${lemma}»`);
      }
    }
    // The prepositions and pronouns themselves are untouched.
    assert.ok(lemmas(await shown(after.db, "серед", "en")).includes("серед"));
    assert.ok(lemmas(await shown(after.db, "по", "en")).includes("по"));
    assert.ok(lemmas(await shown(after.db, "мене", "en")).includes("я"));
    // Only the listed forms went (the stories never use «Мен» itself, so it had no other).
    const formsOf = (sqlite, lemma) => sqlite.prepare(`SELECT DISTINCT f.normalized_form AS form FROM dictionary_forms f
      JOIN dictionary_lexemes l ON l.id = f.lexeme_id WHERE l.normalized_lemma = ?`).all(lemma).map((row) => row.form).sort();
    assert.deepEqual(formsOf(after.sqlite, "мен"), formsOf(before.sqlite, "мен").filter((form) => !["мене", "мені"].includes(form)));
    // Reapplying the repair is harmless.
    after.sqlite.exec(migration("0031_remove_misleading_dictionary_forms.sql"));
  } finally {
    before.sqlite.close();
    after.sqlite.close();
  }
});

test("2026-09-23: a future update cannot bring the misleading forms back", () => {
  const directory = mkdtempSync(join(tmpdir(), "readukrainian-regressions-"));
  const sqlite = new DatabaseSync(":memory:");
  try {
    const source = join(directory, "source.jsonl");
    const output = join(directory, "output.sql");
    const entry = (word, pos, forms) => ({
      word, pos, lang_code: "uk",
      forms: forms.map((form) => ({ form, tags: ["singular"] })),
      senses: [{ id: `fixture-${word}`, glosses: [`definition of ${word}`] }],
    });
    writeFileSync(source, [
      entry("порошенко", "name", ["по"]),
      entry("мен", "name", ["мен", "мене", "мені"]),
      entry("мена", "name", ["мена", "мені"]),
      entry("середа", "noun", ["середа", "серед", "середи"]),
    ].map((item) => JSON.stringify(item)).join("\n"));
    execFileSync(process.execPath, [
      join(ROOT, "scripts/dictionary/build-dictionary-seed.mjs"),
      "--source", source, "--revision", "2026-09-23", "--target", "de", "--scope", "all", "--output", output,
    ]);
    sqlite.exec(migration("0011_dictionary_schema.sql"));
    sqlite.exec(migration("0013_dictionary_workflow.sql"));
    sqlite.exec(readFileSync(output, "utf8"));
    const formsOf = (lemma) => sqlite.prepare(`SELECT DISTINCT f.normalized_form AS form FROM dictionary_forms f
      JOIN dictionary_lexemes l ON l.id = f.lexeme_id WHERE l.normalized_lemma = ?`).all(lemma).map((row) => row.form).sort();
    assert.deepEqual(formsOf("порошенко"), ["порошенко"]);
    assert.deepEqual(formsOf("мен"), ["мен"]);
    assert.deepEqual(formsOf("мена"), ["мена"]);
    assert.deepEqual(formsOf("середа"), ["середа", "середи"]);
  } finally {
    sqlite.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("2026-09-23: after the German update each story word shows every meaning once", async () => {
  const { sqlite, db } = seedDatabase();
  try {
    for (const language of ["en", "de"]) {
      for (const word of mostFrequentWords(loadStoryWordFrequency(), 500)) {
        const entries = await shown(db, word, language);
        const keys = entries.map((entry) => `${entry.normalizedLemma}|${entry.partOfSpeech}`);
        assert.equal(new Set(keys).size, keys.length, `${language}: «${word}» shows an entry twice`);
        for (const entry of entries) {
          const texts = entry.translations.map((translation) => translation.text);
          assert.equal(new Set(texts).size, texts.length, `${language}: «${word}» repeats a translation of «${entry.lemma}»`);
        }
      }
    }
  } finally {
    sqlite.close();
  }
});

test("2026-09-23: German «у» keeps «в» however many English-only entries «у» has", async () => {
  const { sqlite, db } = seedDatabase();
  try {
    // What the English 2026-09-02 update does to «у», exaggerated.
    for (let index = 1; index <= 20; index += 1) {
      sqlite.exec(`INSERT INTO dictionary_lexemes (id, source_language, lemma, normalized_lemma, part_of_speech, source_entry_id)
        VALUES ('regression-у-${index}', 'uk', 'а${index}', 'а${index}', 'noun', 'regression-у-${index}')`);
      sqlite.exec(`INSERT INTO dictionary_forms (lexeme_id, source_language, normalized_form, display_form, tags_json)
        VALUES ('regression-у-${index}', 'uk', 'у', 'у', '[]')`);
      sqlite.exec(`INSERT INTO dictionary_senses (id, lexeme_id, sense_order) VALUES ('regression-у-sense-${index}', 'regression-у-${index}', 1)`);
      sqlite.exec(`INSERT INTO dictionary_translations (sense_id, target_language, translation, translation_order)
        VALUES ('regression-у-sense-${index}', 'en', 'filler', 1)`);
    }
    assert.ok(lemmas(await shown(db, "у", "de")).includes("в"));
  } finally {
    sqlite.close();
  }
});

test("2026-09-24: a letter of the alphabet comes after every word (tapping «я» shows \"I\" first)", async () => {
  // The ordering put the 'character' entry first because it sorts before
  // "pronoun", so «я», «у», «в», «і», «а»… opened on "The thirty-third letter".
  const { sqlite, db } = seedDatabase();
  try {
    assert.deepEqual((await shown(db, "я", "en")).map((entry) => entry.partOfSpeech), ["pronoun", "character"]);
    assert.deepEqual(lemmas(await shown(db, "у", "de")), ["в", "у"]);
    for (const language of ["en", "de"]) {
      for (const word of loadStoryWordFrequency().keys()) {
        const kinds = (await shown(db, word, language)).map((entry) => entry.partOfSpeech);
        const firstLetter = kinds.indexOf("character");
        if (firstLetter < 0) continue;
        assert.ok(kinds.slice(firstLetter).every((kind) => kind === "character"), `${language}: «${word}» shows a letter before a word: ${kinds.join(", ")}`);
      }
    }
  } finally {
    sqlite.close();
  }
});

test("2026-09-23: preparing the same dictionary source twice replaces its branch instead of failing", () => {
  // The second "Prepare update" for one Kaikki revision failed at git push because
  // the first run's branch existed, built on an older main.
  const workflow = readFileSync(join(ROOT, ".github/workflows/dictionary-update.yml"), "utf8");
  assert.match(workflow, /git push --force origin "\$branch"/);
  assert.doesNotMatch(workflow, /git push origin "\$branch"/);
});
