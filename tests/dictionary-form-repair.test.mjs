import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { lookupDictionaryWord } from "../functions/_shared/dictionary.js";
import { analyzeDictionaryCoverage } from "../functions/_shared/dictionary-workflow.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPAIR = "0022_remove_incorrect_dictionary_forms.sql";
const migration = (name) => readFileSync(join(ROOT, "migrations", name), "utf8");

// Independently recorded normalized forms from the three upstream inflection
// tables, including forms outside the current story vocabulary. Good forms and
// ordinary stem alternations are included so exclusions cannot become a purge.
const CASES = [
  { word: "озимина", pos: "noun", correct: "мама", good: ["озимини"],
    bad: ["мама", "мами", "мам", "мамів", "мамі", "мамам", "маму", "мамою", "мамами", "мамах", "мамо"] },
  { word: "рясний", pos: "adj", correct: "червоний", good: ["рясніший", "рясного"],
    bad: ["червоний", "червоне", "червона", "червоні", "червоного", "червоної", "червоних", "червоному", "червоній", "червоним", "червону", "червоною", "червоними", "червонім"] },
  { word: "лісопарк", pos: "noun", correct: "парк", good: ["лісопарку", "лісопарки"],
    bad: ["парк", "парки", "парку", "парків", "паркові", "паркам", "парком", "парками", "парках"] },
];

function d1(sqlite) {
  return { prepare(sql) {
    const statement = sqlite.prepare(sql);
    let parameters = [];
    const wrapper = {
      bind(...values) { parameters = values; return wrapper; },
      async first() { return statement.get(...parameters); },
      async all() { return { results: statement.all(...parameters) }; },
    };
    return wrapper;
  } };
}

function fixtureEntry(word, pos, forms) {
  return {
    word, pos, lang_code: "uk",
    forms: forms.map((form) => ({ form, tags: ["nominative", "singular"] })),
    senses: [{ id: `fixture-${word}-${pos}`, glosses: [`definition of ${word}`] }],
  };
}

for (const target of ["en", "de"]) {
  for (const route of ["direct", "form_of", "alt_of", "supplement-direct", "supplement-form_of", "supplement-alt_of"]) {
    test(`${target} build removes corrupt forms from ${route} while keeping valid entries`, () => {
      const directory = mkdtempSync(join(tmpdir(), "readukrainian-form-repair-"));
      const sourcePath = join(directory, "source.jsonl");
      const supplementPath = join(directory, "supplement.jsonl");
      const outputPath = join(directory, "output.sql");
      const sqlite = new DatabaseSync(":memory:");
      try {
        sqlite.exec(migration("0011_dictionary_schema.sql"));
        sqlite.exec(migration("0013_dictionary_workflow.sql"));
        const source = [];
        const supplement = [];
        for (const item of CASES) {
          const entry = fixtureEntry(item.word, item.pos, item.good);
          source.push(entry, fixtureEntry(item.correct, item.pos, item.bad));
          const destination = route.startsWith("supplement-") ? supplement : source;
          if (route.endsWith("direct")) {
            if (destination === source) entry.forms.push(...fixtureEntry("", "", item.bad).forms);
            else destination.push(fixtureEntry(item.word, item.pos, item.bad));
          } else {
            const kind = route.endsWith("form_of") ? "form_of" : "alt_of";
            for (const form of item.bad) {
              destination.push({
                word: form, pos: item.pos, lang_code: "uk",
                senses: [{ [kind]: [{ word: item.word }], tags: ["nominative", "singular"] }],
              });
            }
          }
        }
        source.push(
          fixtureEntry("схід", "noun", ["сходи", "сходів", "сході"]),
          fixtureEntry("хтіти", "verb", ["хочу", "хочеш", "хоче"]),
          fixtureEntry("стіл", "noun", ["столу"]),
          fixtureEntry("бути", "verb", ["є"]),
        );
        writeFileSync(sourcePath, source.map((entry) => JSON.stringify(entry)).join("\n"));
        writeFileSync(supplementPath, supplement.map((entry) => JSON.stringify(entry)).join("\n"));
        execFileSync(process.execPath, [
          join(ROOT, "scripts/dictionary/build-dictionary-seed.mjs"),
          "--source", sourcePath, "--revision", "2026-09-06", "--target", target,
          "--scope", "all", "--output", outputPath,
          ...(supplement.length ? ["--forms-source", supplementPath] : []),
        ], { encoding: "utf8" });
        sqlite.exec(readFileSync(outputPath, "utf8"));
        const formsFor = (word) => sqlite.prepare(`
          SELECT DISTINCT f.normalized_form FROM dictionary_forms f
          JOIN dictionary_lexemes l ON l.id = f.lexeme_id WHERE l.normalized_lemma = ?
        `).all(word).map((row) => row.normalized_form);
        for (const item of CASES) {
          assert.deepEqual(formsFor(item.word).sort(), [item.word, ...item.good].sort());
          for (const form of item.bad) assert.ok(formsFor(item.correct).includes(form), `${item.correct}: ${form}`);
          assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM dictionary_translations t
            JOIN dictionary_senses s ON s.id = t.sense_id JOIN dictionary_lexemes l ON l.id = s.lexeme_id
            WHERE l.normalized_lemma = ? AND t.target_language = ?`).get(item.word, target).n, 1);
        }
        for (const [word, form] of [["схід", "сходи"], ["хтіти", "хочу"], ["стіл", "столу"], ["бути", "є"]]) {
          assert.ok(formsFor(word).includes(form));
        }
        // A future incremental rebuild must emit the same safe associations.
        // Reapplying its INSERT OR IGNORE statements is harmless.
        sqlite.exec(readFileSync(outputPath, "utf8"));
      } finally {
        sqlite.close();
        // Only remove the unique directory created by this test, within temp.
        assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
}

test("migration removes only bad associations, preserves lookup coverage and is repeatable", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    for (const name of readdirSync(join(ROOT, "migrations")).filter((name) => name.endsWith(".sql") && name < REPAIR).sort()) {
      sqlite.exec(migration(name));
    }
    const adapter = d1(sqlite);
    const paragraphs = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/content-082.json"), "utf8"))
      .filter((story) => story.active !== false && story.level !== "B1").flatMap((story) => story.paragraphs);
    const coverageBefore = await analyzeDictionaryCoverage(adapter, paragraphs);
    const excludedIds = new Map();
    for (const item of CASES) {
      const { id } = sqlite.prepare("SELECT id FROM dictionary_lexemes WHERE lemma = ? AND source_id = 'kaikki-wiktionary'").get(item.word);
      excludedIds.set(id, new Set(item.bad));
      // Preserve correct forms even when upstream has both valid and bad rows.
      for (const form of [item.word, ...item.good]) {
        sqlite.prepare("INSERT OR IGNORE INTO dictionary_forms VALUES (?, 'uk', ?, ?, '[]')").run(id, form, form);
      }
      const before = await lookupDictionaryWord(adapter, { text: item.correct, targetLanguage: "en" });
      assert.ok(before.entries.some((entry) => entry.lemma === item.word));
    }
    const sense = sqlite.prepare(`SELECT s.id FROM dictionary_senses s JOIN dictionary_lexemes l
      ON l.id = s.lexeme_id WHERE l.lemma = 'рясний' LIMIT 1`).get();
    sqlite.prepare(`INSERT INTO story_dictionary_preferences
      (story_id, normalized_form, target_language, sense_id, selected_by_email, selected_at)
      VALUES (1, 'рясний', 'en', ?, 'reviewer@example.com', '2026-09-06')`).run(sense.id);
    const tables = ["dictionary_lexemes", "dictionary_senses", "dictionary_translations", "story_dictionary_preferences"];
    const snapshot = () => tables.map((table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const beforeTables = snapshot();
    const beforeForms = sqlite.prepare("SELECT * FROM dictionary_forms ORDER BY rowid").all();
    const expectedForms = beforeForms.filter((row) => !excludedIds.get(row.lexeme_id)?.has(row.normalized_form));
    assert.ok(expectedForms.length < beforeForms.length);
    sqlite.exec(migration(REPAIR));
    assert.deepEqual(snapshot(), beforeTables);
    assert.deepEqual(sqlite.prepare("SELECT * FROM dictionary_forms ORDER BY rowid").all(), expectedForms);
    for (const item of CASES) {
      const after = await lookupDictionaryWord(adapter, { text: item.correct, targetLanguage: "en" });
      assert.ok(!after.entries.some((entry) => entry.lemma === item.word));
      assert.ok(after.entries.some((entry) => entry.lemma === item.correct));
      const preserved = await lookupDictionaryWord(adapter, { text: item.word, targetLanguage: "en" });
      assert.ok(preserved.entries.some((entry) => entry.lemma === item.word));
    }
    const coverageAfter = await analyzeDictionaryCoverage(adapter, paragraphs);
    assert.deepEqual(coverageAfter, coverageBefore);
    assert.equal(coverageAfter.coveragePercent, 100);
    assert.equal(coverageAfter.totalUniqueWords, 4085);
    sqlite.exec(migration(REPAIR));
    assert.deepEqual(snapshot(), beforeTables);
    assert.deepEqual(sqlite.prepare("SELECT * FROM dictionary_forms ORDER BY rowid").all(), expectedForms);
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    sqlite.close();
  }
});
